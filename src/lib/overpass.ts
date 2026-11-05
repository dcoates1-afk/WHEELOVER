import { distanceMeters, normalizeElement } from '../../shared/navaid-core.mjs';
import { elementPaths, ringsAndLines, stitchPaths } from '../../shared/marine-area-core.mjs';
import { classifyMarineArea, type MarineAreaGroup } from './marineAreas';
import type { Navaid } from './navaidTypes';
import { markDetailsFromTags, type MarkDetailEntry } from './markDetails';
import type { Bounds } from './navaidDb';
import { readChartFeatureCell, storedCellStatus, writeChartFeatureCell } from './chartFeatureStore';

export interface LiveQueryResult {
  navaids: Navaid[];
  cached: boolean;
  fetchedAt: number;
}

export interface ChartFeature {
  id: string;
  type: 'bridge' | 'protected_area';
  /** OSM way/relation features which explicitly indicate water crossing. */
  waterCrossing?: boolean;
  name: string;
  lat: number;
  lon: number;
  path: [number, number][];
  paths: [number, number][][];
  /** Closed outlines, filled on the chart; open members stay as lines. */
  rings?: [number, number][][];
  lines?: [number, number][][];
  /** Which marine-area toggle owns the feature. */
  areaGroup?: MarineAreaGroup;
  /** What the site is called by its designation, e.g. "Special Area of Conservation". */
  areaLabel?: string;
  properties: Record<string, string>;
  sourceUrl: string;
  /** Every mapped record folded into this crossing, so the card can link them all. */
  sourceUrls?: string[];
}

export interface LiveChartFeaturesResult {
  features: ChartFeature[];
  cached: boolean;
  fetchedAt: number;
}

const memory = new Map<string, { navaids: Navaid[]; at: number }>();
const TTL_MS = 5 * 60 * 1000;
const CHART_FEATURE_CACHE_MS = 10 * 60 * 1000;
/**
 * Bump this whenever the bridge/area matching rules change (span rule, tidal
 * reach, ...). The device cache outlives deploys, so without a version in the
 * key a device keeps serving cells drawn under older rules for up to thirty
 * days. Cells stored under older keys simply stop matching and age out.
 */
export const CHART_FEATURE_FILTER_VERSION = 5;
const chartFeatureMemory = new Map<string, { features: ChartFeature[]; at: number }>();

export type RawChartElement = {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  geometry?: { lat: number; lon: number }[];
  /** A relation arrives as member ways with their own geometry. */
  members?: { geometry?: { lat: number; lon: number }[] }[];
  tags?: Record<string, string>;
};

function pointInRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[previous];
    if ((y1 > lat) !== (y2 > lat) && lon < ((x2 - x1) * (lat - y1)) / (y2 - y1) + x1) inside = !inside;
  }
  return inside;
}

/**
 * How far a bridge may sit from mapped water and still count as crossing it.
 * Ten metres covers mapping imprecision; anything further is a bridge over
 * land, not over water, and must not be drawn. (It used to be 100 m, which
 * let road bridges beside a river read as water crossings.) The tolerance
 * does not apply to light bridges over areas: those must cut the boundary
 * twice, not merely pass near it.
 */
const WATER_CROSSING_TOLERANCE_METERS = 10;
/** The tolerance in degrees, padded so a pruned pair is never a real crossing. */
const WATER_CROSSING_TOLERANCE_DEGREES = 0.01;

/** Order the popup reads best in: what it is, then who runs it, then the rest. */
const PROPERTY_ORDER = [
  'name', 'seamark:name', 'designation', 'protection_title', 'protect_class', 'protection_class',
  'boundary', 'leisure', 'natural', 'military', 'seamark:type', 'operator', 'owner', 'access',
  'start_date', 'opening_hours', 'area', 'description', 'seamark:information', 'note',
  'website', 'wikidata', 'wikipedia', 'source',
];
const PROPERTY_VALUE_MAX = 400;

/**
 * Every mapped tag worth showing in a feature popup, ordered so a reader sees
 * the designation and operator before the incidental tags.
 */
export function chartFeatureProperties(tags: Record<string, string>): Record<string, string> {
  const entries = Object.entries(tags).filter(([, value]) =>
    typeof value === 'string' && value.trim() !== '' && value.length <= PROPERTY_VALUE_MAX,
  );
  const rank = (key: string) => {
    const index = PROPERTY_ORDER.indexOf(key);
    return index === -1 ? PROPERTY_ORDER.length : index;
  };
  entries.sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
  return Object.fromEntries(entries);
}

function segmentsIntersect(a: { lat: number; lon: number }, b: { lat: number; lon: number }, c: { lat: number; lon: number }, d: { lat: number; lon: number }): boolean {
  const cross = (p: typeof a, q: typeof a, r: typeof a) =>
    (q.lon - p.lon) * (r.lat - p.lat) - (q.lat - p.lat) * (r.lon - p.lon);
  const onSegment = (p: typeof a, q: typeof a, r: typeof a) =>
    Math.min(p.lon, r.lon) - 1e-8 <= q.lon && q.lon <= Math.max(p.lon, r.lon) + 1e-8 &&
    Math.min(p.lat, r.lat) - 1e-8 <= q.lat && q.lat <= Math.max(p.lat, r.lat) + 1e-8;
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  return (abC * abD < 0 && cdA * cdB < 0) ||
    (Math.abs(abC) <= 1e-8 && onSegment(a, c, b)) ||
    (Math.abs(abD) <= 1e-8 && onSegment(a, d, b)) ||
    (Math.abs(cdA) <= 1e-8 && onSegment(c, a, d)) ||
    (Math.abs(cdB) <= 1e-8 && onSegment(c, b, d));
}

function pointToSegmentMeters(point: { lat: number; lon: number }, start: { lat: number; lon: number }, end: { lat: number; lon: number }): number {
  const meanLat = ((point.lat + start.lat + end.lat) / 3) * Math.PI / 180;
  const project = ({ lat, lon }: { lat: number; lon: number }) => ({
    x: lon * 111_320 * Math.cos(meanLat),
    y: lat * 110_574,
  });
  const p = project(point);
  const a = project(start);
  const b = project(end);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function segmentsWithinTolerance(
  a: { lat: number; lon: number }, b: { lat: number; lon: number },
  c: { lat: number; lon: number }, d: { lat: number; lon: number },
): boolean {
  return segmentsIntersect(a, b, c, d) || segmentsNear(a, b, c, d);
}

/** Whether two segments come within the given metres of each other. */
function segmentsWithinMeters(
  a: Point, b: Point, c: Point, d: Point, meters: number,
): boolean {
  if (segmentsIntersect(a, b, c, d)) return true;
  return pointToSegmentMeters(a, c, d) <= meters ||
    pointToSegmentMeters(b, c, d) <= meters ||
    pointToSegmentMeters(c, a, b) <= meters ||
    pointToSegmentMeters(d, a, b) <= meters;
}
function segmentsNear(
  a: { lat: number; lon: number }, b: { lat: number; lon: number },
  c: { lat: number; lon: number }, d: { lat: number; lon: number },
): boolean {
  return pointToSegmentMeters(a, c, d) <= WATER_CROSSING_TOLERANCE_METERS ||
    pointToSegmentMeters(b, c, d) <= WATER_CROSSING_TOLERANCE_METERS ||
    pointToSegmentMeters(c, a, b) <= WATER_CROSSING_TOLERANCE_METERS ||
    pointToSegmentMeters(d, a, b) <= WATER_CROSSING_TOLERANCE_METERS;
}

/**
 * Highway values that carry people, not vehicles. Their bridge-tagged ways are
 * often just path segments on structures — boardwalks, piers, marina fingers,
 * steps down to a dock — rather than crossings, so they must prove a real span
 * (see bridgeMeetsWater). Road, rail and untagged bridges keep the lenient rule:
 * missing one is a hazard, while a walkway fragment is clutter.
 */
const LIGHT_HIGHWAY_VALUES = new Set(['footway', 'cycleway', 'path', 'bridleway', 'steps']);

function isLightBridge(tags: Record<string, string> | undefined): boolean {
  return LIGHT_HIGHWAY_VALUES.has(tags?.highway?.toLowerCase() ?? '');
}

/**
 * Bridges that must prove a real span. Light highways (above) are often just
 * path segments on structures, and any bridge element with no carrying way at
 * all — a man_made=bridge outline, a conveyor, a pipeline — is a bare
 * structure ring, not a crossing: both get the strict span test instead of
 * the lenient touching rule. A named outline that genuinely spans still
 * passes (the MacDonald Bridge way itself carries no highway tag), while a
 * ring that merely overlaps a bay does not. Road, rail and other carrying
 * bridges keep the lenient rule: missing one is a hazard, while a walkway
 * fragment or a bare ring is clutter.
 */
/**
 * A bridge that must prove a span. Light bridges (footways, paths, steps,
 * cycleways, boardwalks) get the strict span test, as does any bridge
 * element with no carrying way that is a structure rather than a crossing:
 * a man_made=bridge outline, a conveyor, a pipeline, or a seamark bridge
 * with no bridge tag. A plain bridge=yes way (no man_made, carrying
 * something the mapper did not tag) keeps the lenient rule — it is a
 * crossing, not a structure outline — so a road bridge mapped a few metres
 * short of the water, or lying inside a harbour basin, still counts.
 */
function isStrictBridge(tags: Record<string, string> | undefined): boolean {
  if (isLightBridge(tags)) return true;
  const highway = tags?.highway?.toLowerCase();
  const railway = tags?.railway?.toLowerCase();
  if (highway || railway) return false;
  if (tags?.man_made !== undefined) return true;
  return tags?.bridge === undefined;
}

/** Length of one segment in metres, equirectangular at the segment's latitude. */
function segmentLengthMeters(a: Point, b: Point): number {
  const meanLat = ((a.lat + b.lat) / 2) * Math.PI / 180;
  return Math.hypot((b.lon - a.lon) * 111_320 * Math.cos(meanLat), (b.lat - a.lat) * 110_574);
}

/**
 * The point where two segments cross, with `t` along the first segment, or
 * null when they do not cross cleanly. A path running along the boundary
 * (collinear overlap) is not a crossing: it traces the edge rather than
 * cutting it, so it registers no cut.
 */
function segmentIntersectionPoint(
  a: Point, b: Point, c: Point, d: Point,
): { lat: number; lon: number; t: number } | null {
  const denom = (a.lon - b.lon) * (c.lat - d.lat) - (a.lat - b.lat) * (c.lon - d.lon);
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((a.lon - c.lon) * (c.lat - d.lat) - (a.lat - c.lat) * (c.lon - d.lon)) / denom;
  const u = -((a.lon - b.lon) * (a.lat - c.lat) - (a.lat - b.lat) * (a.lon - c.lon)) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { lat: a.lat + t * (b.lat - a.lat), lon: a.lon + t * (b.lon - a.lon), t };
}

/**
 * How far inside a water area a path must get for its crossing to count as a
 * span. Ten metres is the mapping-imprecision scale (the crossing tolerance):
 * a shoreline walkway weaves in and out within metres of the mapped boundary,
 * while a real span crosses open water.
 */
const MIN_SPAN_PENETRATION_METERS = 10;

/**
 * How wide a steep crossing must be to count as a span. A walkway can cross
 * a sliver of mapped water steeply — a seven-metre strip where the polygon
 * edge juts across the path — and that is indistinguishable from mapping
 * wobble at the same scale, so below ten metres even a square crossing does
 * not count. Wider than that, a steep bank-to-bank crossing is a bridge
 * however narrow the water.
 */
const MIN_SPAN_WIDTH_METERS = 10;

/**
 * How far the water must continue past a crossing along the channel for the
 * crossing to count as a channel span rather than a chord across a polygon
 * tip. Twenty metres is twice the penetration threshold: a lobe whose nose
 * sits within that of the crossing is a dead end, not a channel a boat
 * follows, while a real channel — however narrow — runs on past the bridge.
 */
const MIN_CHANNEL_CONTINUATION_METERS = 20;

/** One place a bridge path crosses a water area's boundary, with its angle to the boundary. */
interface AreaCut { at: number; lat: number; lon: number; angle: number }

/**
 * Cut points where a path crosses an area boundary, with the angle between
 * the path and the boundary there, plus the path's cumulative distances.
 * One boundary encounter can register twice (a path vertex sitting on the
 * ring, or a crossing at a ring vertex): cuts within a metre of each other
 * along the path are the same encounter, keeping the steepest reading.
 */
function cutsAlongPath(path: [number, number][], area: Point[]): { cuts: AreaCut[]; cumulative: number[] } {
  const cuts: AreaCut[] = [];
  const cumulative: number[] = [0];
  for (let index = 1; index < path.length; index += 1) {
    const start = { lat: path[index - 1][0], lon: path[index - 1][1] };
    const end = { lat: path[index][0], lon: path[index][1] };
    const segLen = segmentLengthMeters(start, end);
    for (let waterIndex = 1; waterIndex < area.length; waterIndex += 1) {
      const hit = segmentIntersectionPoint(start, end, area[waterIndex - 1], area[waterIndex]);
      if (hit) {
        const meanLat = hit.lat * Math.PI / 180;
        const ux = (end.lon - start.lon) * 111_320 * Math.cos(meanLat);
        const uy = (end.lat - start.lat) * 110_574;
        const vx = (area[waterIndex].lon - area[waterIndex - 1].lon) * 111_320 * Math.cos(meanLat);
        const vy = (area[waterIndex].lat - area[waterIndex - 1].lat) * 110_574;
        const ul = Math.hypot(ux, uy);
        const vl = Math.hypot(vx, vy);
        const cos = ul === 0 || vl === 0 ? 1 : Math.abs((ux * vx + uy * vy) / (ul * vl));
        cuts.push({ at: cumulative[index - 1] + hit.t * segLen, lat: hit.lat, lon: hit.lon, angle: Math.acos(Math.min(1, cos)) * 180 / Math.PI });
      }
    }
    cumulative.push(cumulative[index - 1] + segLen);
  }
  cuts.sort((a, b) => a.at - b.at);
  const deduped: AreaCut[] = [];
  for (const cut of cuts) {
    const last = deduped[deduped.length - 1];
    if (last !== undefined && cut.at - last.at <= 1) last.angle = Math.max(last.angle, cut.angle);
    else deduped.push({ ...cut });
  }
  return { cuts: deduped, cumulative };
}

/** The point on a path at a cumulative distance along it, interpolated within its segment. */
function pointAtDistance(path: [number, number][], cumulative: number[], target: number): Point {
  if (target <= 0) return { lat: path[0][0], lon: path[0][1] };
  for (let index = 1; index < path.length; index += 1) {
    if (target <= cumulative[index]) {
      const segLen = cumulative[index] - cumulative[index - 1];
      const t = segLen === 0 ? 0 : (target - cumulative[index - 1]) / segLen;
      return {
        lat: path[index - 1][0] + t * (path[index][0] - path[index - 1][0]),
        lon: path[index - 1][1] + t * (path[index][1] - path[index - 1][1]),
      };
    }
  }
  const last = path[path.length - 1];
  return { lat: last[0], lon: last[1] };
}

/**
 * Distance from a point inside a water area to the area boundary along a ray,
 * in metres. The ray direction is a unit vector in local metres (x east,
 * y north) around the origin.
 */
function rayToBoundaryMeters(origin: Point, dirX: number, dirY: number, area: Point[]): number {
  const cosLat = Math.cos(origin.lat * Math.PI / 180);
  const toXY = (p: Point) => ({ x: (p.lon - origin.lon) * 111_320 * cosLat, y: (p.lat - origin.lat) * 110_574 });
  let best = Number.POSITIVE_INFINITY;
  for (let index = 1; index < area.length; index += 1) {
    const a = toXY(area[index - 1]);
    const b = toXY(area[index]);
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const denom = dirX * ey - dirY * ex;
    if (Math.abs(denom) < 1e-12) continue;
    // Ray o + t*d meets segment a + u*e: t = cross(a, e) / cross(d, e),
    // u = cross(a, d) / cross(d, e), with the origin at (0, 0).
    const t = (a.x * ey - a.y * ex) / denom;
    const u = (a.x * dirY - a.y * dirX) / denom;
    if (t > 0.001 && u >= 0 && u <= 1) best = Math.min(best, t);
  }
  return best;
}

/**
 * How far the water continues past a run along the channel, in metres: from
 * a point on the run, the shorter of the two distances to the area boundary
 * perpendicular to the run (along the channel). A channel runs on both ways;
 * a polygon tip ends at its nose a few metres past the crossing.
 */
/**
 * How far the water continues past a point, perpendicular to a run. The
 * shorter of the two rays either side of the run chord: a wide water body
 * the run spans extends a long way on both sides, while a polygon tip ends
 * a short way on one side.
 */
function channelContinuationPerpendicularMeters(origin: Point, from: AreaCut, to: AreaCut, area: Point[]): number {
  const cosLat = Math.cos(origin.lat * Math.PI / 180);
  const dx = (to.lon - from.lon) * 111_320 * cosLat;
  const dy = (to.lat - from.lat) * 110_574;
  const len = Math.hypot(dx, dy);
  if (len === 0) return 0;
  const perpX = -dy / len;
  const perpY = dx / len;
  return Math.min(
    rayToBoundaryMeters(origin, perpX, perpY, area),
    rayToBoundaryMeters(origin, -perpX, -perpY, area),
  );
}

/**
 * How far the water continues past a point, along the channel. Rays are cast
 * in twelve directions (every 15 degrees) and the best axis is taken: the
 * direction in which the water extends farthest on BOTH sides. A real
 * channel extends a long way upstream and downstream, so its best axis is
 * long; a polygon tip ends a short way on one side no matter which axis is
 * chosen, so its best axis is short. Casting only perpendicular to the
 * run would miss a skewed crossing of a narrow channel: the perpendicular
 * is off the channel axis and exits the strip quickly, while the channel
 * itself runs on.
 */
function channelContinuationMeters(origin: Point, area: Point[]): number {
  let best = 0;
  for (let k = 0; k < 12; k++) {
    const theta = (k * Math.PI) / 12;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    const fwd = rayToBoundaryMeters(origin, cosT, sinT, area);
    const back = rayToBoundaryMeters(origin, -cosT, -sinT, area);
    best = Math.max(best, Math.min(fwd, back));
  }
  return best;
}

/**
 * Whether a run across a water area is a channel crossing rather than a chord
 * across a polygon tip. Either the water extends a long way perpendicular to
 * the run on both sides — a wide water body the run spans, like a bay — or
 * it continues along a channel axis for at least twice the run's own length
 * (and at least twenty metres) — a narrow channel that runs on past the
 * crossing. A tip fails both: its water ends a short way on one side
 * perpendicular to the chord, and its best-axis continuation is only as wide
 * as the chord that cuts it off. Measured on Dartmouth Cove, a tip chord
 * continues ~22–25 m along its best axis against a ~20 m chord (ratio
 * ~1.1) and ~14–15 m perpendicular, while a skewed footbridge over a 15 m
 * channel continues ~111 m along its axis against a 30 m run (ratio ~3.7).
 */
function runIsChannelCrossing(origin: Point, from: AreaCut, to: AreaCut, runLength: number, area: Point[]): boolean {
  if (channelContinuationPerpendicularMeters(origin, from, to, area) >= MIN_CHANNEL_CONTINUATION_METERS) return true;
  return channelContinuationMeters(origin, area) >= Math.max(MIN_CHANNEL_CONTINUATION_METERS, 2 * runLength);
}

/**
 * Whether a bridge path genuinely spans a water area: it must enter the area
 * and come out again on a run that is a real crossing, not a shoreline
 * weave. Cutting the boundary twice is not enough on its own — a walkway
 * along a wobbly shoreline cuts it twice (or twenty times) without ever
 * leaving the water's edge, and the old cut-count rule drew every such
 * walkway as a bridge. A run counts as a crossing when it gets properly
 * inside — ten metres from the boundary, the mapping-imprecision scale, and
 * a quarter of the run's own length, so a long boardwalk weaving in and out
 * of a harbour cannot pass on a shallow dip — or when it cuts the boundary
 * steeply at either end across a run at least ten metres wide, the way a
 * bridge meets its banks, rather than grazing along them the way a shoreline
 * path does or nicking a sliver of mapped water, and the water continues
 * past the run along the channel rather than ending at a polygon tip.
 * A path that lies inside the area (a walkway along the shore, a boardwalk
 * over the water's edge) or enters it and ends there (a finger out to the
 * floats) does not span, however much water it touches. A bridge to an
 * island inside one polygon cuts the boundary only once and is not counted;
 * road bridges to islands are unaffected.
 */
function pathSpansArea(path: [number, number][], area: Point[]): boolean {
  if (path.length < 2 || area.length < 2) return false;
  const { cuts: deduped, cumulative } = cutsAlongPath(path, area);
  if (deduped.length < 2) return false;
  // Inside-runs between consecutive cuts alternate with outside-runs. Only a
  // complete inside-run counts: the run from the path start to the first cut
  // and the run from the last cut to the path end are unbounded on one side
  // (a finger, or a bridge starting on an island) and never count.
  const ring = area.map(({ lat, lon }) => [lon, lat]);
  const startInside = pointInRing(path[0][1], path[0][0], ring);
  for (let run = 1; run < deduped.length; run += 1) {
    const inside = startInside ? run % 2 === 0 : run % 2 === 1;
    if (!inside) continue;
    const from = deduped[run - 1];
    const to = deduped[run];
    const runLength = to.at - from.at;
    // A point on the path halfway through the run: the run's own middle,
    // inside the area by construction, from which the channel is measured.
    const midPoint = pointAtDistance(path, cumulative, (from.at + to.at) / 2);
    // A steep cut at either end proves a crossing only when the run is a
    // channel too narrow for the penetration test: a bridge meets its
    // banks squarely even over a channel too narrow for ten metres of
    // penetration, while a shoreline weave also crosses the boundary
    // steeply — but its run is wide and hugs the edge, so a wide run must
    // prove itself by penetration instead. The channel width across the
    // path is the run chord times the sine of the shallower cut, and a
    // run narrower than twice the penetration threshold cannot reach ten
    // metres of penetration at its middle by construction. And the water
    // must continue past the run along the channel: a chord across a
    // polygon tip cuts steeply at both ends too, but the tip ends at its
    // nose a few metres past the crossing.
    const runWidth = segmentLengthMeters({ lat: from.lat, lon: from.lon }, { lat: to.lat, lon: to.lon });
    const perpWidth = runWidth * Math.sin(Math.min(from.angle, to.angle) * Math.PI / 180);
    if (Math.max(from.angle, to.angle) >= 30 &&
      runWidth >= MIN_SPAN_WIDTH_METERS &&
      perpWidth < 2 * MIN_SPAN_PENETRATION_METERS &&
      runIsChannelCrossing(midPoint, from, to, to.at - from.at, area)) return true;
    // Otherwise the run must get properly inside. Sample the run's vertices
    // and segment midpoints: the deepest point of the run is its
    // penetration, and a midpoint catches a two-point bridge whose only
    // vertex inside is none at all. Penetration alone is not enough for a
    // long run: a boardwalk weaving along a harbour edge dips thirty metres
    // inside over a two-hundred-metre run without ever crossing it, so the
    // penetration must also be a quarter of the run's own length.
    const samples: Point[] = [];
    for (let index = 1; index < path.length; index += 1) {
      const start = { lat: path[index - 1][0], lon: path[index - 1][1] };
      const end = { lat: path[index][0], lon: path[index][1] };
      const midAt = cumulative[index - 1] + (cumulative[index] - cumulative[index - 1]) / 2;
      if (cumulative[index - 1] > from.at && cumulative[index - 1] < to.at) samples.push(start);
      if (midAt > from.at && midAt < to.at) samples.push({ lat: (start.lat + end.lat) / 2, lon: (start.lon + end.lon) / 2 });
      if (cumulative[index] > from.at && cumulative[index] < to.at) samples.push(end);
    }
    let maxPenetration = 0;
    // The run counts by penetration only when the deepest point gets
    // properly inside relative to the run itself (see the doc comment).
    const requiredPenetration = Math.max(MIN_SPAN_PENETRATION_METERS, runLength / 4);
    for (const sample of samples) {
      // Penetration is the distance to the nearest boundary segment. Ring
      // segments outside a threshold box around the sample cannot be the
      // nearest: the box is the required penetration, so a segment outside
      // it is further than the threshold and cannot change the verdict —
      // but the scan must run to the end, because stopping at the first
      // segment inside the box would read a far segment as the nearest
      // while a nearer one sits later in the ring.
      let nearest = Number.POSITIVE_INFINITY;
      for (let waterIndex = 1; waterIndex < area.length; waterIndex += 1) {
        const a = area[waterIndex - 1];
        const b = area[waterIndex];
        const latTol = requiredPenetration / 110_574;
        const lonTol = requiredPenetration / (111_320 * Math.cos(sample.lat * Math.PI / 180));
        if (Math.min(a.lat, b.lat) > sample.lat + latTol || Math.max(a.lat, b.lat) < sample.lat - latTol ||
          Math.min(a.lon, b.lon) > sample.lon + lonTol || Math.max(a.lon, b.lon) < sample.lon - lonTol) continue;
        nearest = Math.min(nearest, pointToSegmentMeters(sample, a, b));
      }
      maxPenetration = Math.max(maxPenetration, nearest);
    }
    if (maxPenetration >= requiredPenetration) return true;
  }
  return false;
}

/**
 * Whether two segments cross rather than run alongside each other: an exact
 * intersection, or a near miss at a crossing angle (mapping offset on a real
 * crossing), but never a parallel path within tolerance of the water line.
 */
function segmentsCrossTransversely(
  a: { lat: number; lon: number }, b: { lat: number; lon: number },
  c: { lat: number; lon: number }, d: { lat: number; lon: number },
): boolean {
  if (segmentsIntersect(a, b, c, d)) return true;
  if (!segmentsNear(a, b, c, d)) return false;
  const meanLat = ((a.lat + b.lat + c.lat + d.lat) / 4) * Math.PI / 180;
  const project = ({ lat, lon }: { lat: number; lon: number }) => ({
    x: lon * 111_320 * Math.cos(meanLat),
    y: lat * 110_574,
  });
  const pa = project(a);
  const pb = project(b);
  const pc = project(c);
  const pd = project(d);
  const ux = pb.x - pa.x;
  const uy = pb.y - pa.y;
  const vx = pd.x - pc.x;
  const vy = pd.y - pc.y;
  const ul = Math.hypot(ux, uy);
  const vl = Math.hypot(vx, vy);
  if (ul === 0 || vl === 0) return false;
  const cos = Math.abs((ux * vx + uy * vy) / (ul * vl));
  return Math.acos(Math.min(1, cos)) * 180 / Math.PI >= 30;
}

/**
 * Tidal-water types beyond the explicit `tidal` tags.
 *
 * Most tidal water in OpenStreetMap is not tagged as tidal at all: an estuary,
 * a harbour basin or the sea itself is mapped by what it is, and a river's
 * tidal reach is just `waterway=river`. Taking only `tidal=yes` dropped every
 * bridge over those, so the mapped sea, estuary, harbour and dock shapes count
 * as tidal here. An inland river, canal or lake still does not.
 */
const TIDAL_WATER_VALUES = {
  water: new Set(['sea', 'tidal', 'estuary', 'lagoon', 'harbour', 'harbor', 'dock', 'basin', 'cove', 'bay']),
  natural: new Set(['bay', 'strait', 'cove', 'fjord']),
  waterway: new Set(['tidal_channel', 'dock']),
  'seamark:type': new Set(['harbour', 'harbour_basin', 'bay', 'estuary', 'dock', 'sea_area']),
};

export function isTidalWater(tags: Record<string, string> | undefined): boolean {
  if (!tags) return false;
  // An explicit `tidal=no` beats every inference below: a mapper who marked
  // a reach non-tidal has said more than its type ever can.
  if (tags.tidal?.toLowerCase() === 'no') return false;
  if (tags.tidal?.toLowerCase() === 'yes') return true;
  if (tags['tidal:range'] !== undefined) return true;
  if (tags.harbour !== undefined && tags.harbour !== 'no') return true;
  for (const [key, values] of Object.entries(TIDAL_WATER_VALUES)) {
    const value = tags[key]?.toLowerCase();
    if (value && values.has(value)) return true;
  }
  return false;
}

/**
 * How far up a river the tide is taken to reach, when nothing in the map says.
 *
 * A tidal river is usually mapped as nothing more than `water=river` or a river
 * centreline, so a reach is treated as tidal when a boat following the water
 * from the crossing can reach water that is unambiguously tidal — the sea, an
 * estuary, a harbour basin or a bay — within this distance measured ALONG the
 * waterway, not as the crow flies. Two kilometres covers the mouth reaches of
 * untagged rivers, where a boat from the sea can actually be. The old
 * straight-line rule kept whole creek chains: the Colquitz valley is so
 * compact that every crossing up the creek sits within two kilometres of
 * Portage Inlet in a straight line, however far the winding creek actually
 * runs. The distance is measured path to path, in metres, never box to box:
 * a big sea polygon's bounding box covers whole inland valleys (Haro
 * Strait's box covers the entire Colquitz valley), so a box test let every
 * reach inside the box read as tidal no matter how far the actual water was.
 */
export const TIDAL_REACH_METERS = 2000;

/**
 * River water, whose tidal reach has to be inferred from position.
 *
 * Canals are deliberately absent: they are cut off from the tide by their locks,
 * and every canal basin near a harbour would otherwise make a city's canal
 * bridges read as tidal crossings.
 */
const RIVER_WATER_VALUES: Record<string, Set<string>> = {
  water: new Set(['river']),
  waterway: new Set(['river', 'riverbank']),
};

export function isRiverWater(tags: Record<string, string> | undefined): boolean {
  if (!tags) return false;
  for (const [key, values] of Object.entries(RIVER_WATER_VALUES)) {
    const value = tags[key]?.toLowerCase();
    if (value && values.has(value)) return true;
  }
  return false;
}

/**
 * Water that can make a nearby river reach tidal.
 *
 * A marina basin is tagged as harbour water but says nothing about the tide: a
 * mooring pool on the Thames at Henley is not evidence that Henley Bridge sits
 * in tidal water. Only open water — sea, bay, strait, estuary, harbour basin,
 * dock, or a body tagged tidal — is allowed to carry the inference upstream.
 * An intermittent body is not a seed either: a pond that dries up (the
 * intermittent basin beside the Colquitz counted as tidal water for a dozen
 * creek bridges) says nothing about the tide.
 */
function isTidalSeed(tags: Record<string, string>): boolean {
  if (tags.leisure?.toLowerCase() === 'marina') return false;
  if (tags.intermittent?.toLowerCase() === 'yes') return false;
  return isTidalWater(tags);
}

type Point = { lat: number; lon: number };

/** Roads, outlines and multipolygons all arrive as one or more lines. */
function bridgeLines(bridge: RawChartElement): [number, number][][] {
  const geometry = elementPaths(bridge);
  if (geometry.length > 0) return geometry;
  return bridge.geometry ? [bridge.geometry.map(({ lat, lon }) => [lat, lon])] : [];
}

function waterPoint(line: Point[]): Point[] {
  return line;
}

type Area = [number, number, number, number];

function boundsOfPaths(paths: [number, number][][]): Area {
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const path of paths) {
    for (const [lat, lon] of path) {
      if (lat < south) south = lat;
      if (lat > north) north = lat;
      if (lon < west) west = lon;
      if (lon > east) east = lon;
    }
  }
  return [south, west, north, east];
}

function padArea([south, west, north, east]: Area, pad: number): Area {
  return [south - pad, west - pad, north + pad, east + pad];
}

function areasOverlap([south, west, north, east]: Area, [otherSouth, otherWest, otherNorth, otherEast]: Area): boolean {
  return south <= otherNorth && north >= otherSouth && west <= otherEast && east >= otherWest;
}

/**
 * A tidal water body with its joined lines and extent, prepared once.
 *
 * Stitching every water shape for every bridge, and testing every one of its
 * segments against every bridge segment, is quadratic enough to spend tens of
 * seconds on a coastal view. Preparing the water once and skipping shapes and
 * segments whose extent cannot reach the bridge gives the same answer for a
 * fraction of the work.
 */
interface PreparedWater {
  paths: [number, number][][];
  /** A mapped water surface rather than a centreline. */
  surface: boolean;
  /**
   * An area water even when its geometry arrives fragmented: a multipolygon
   * relation is an area by type, so its unjoined member lines are pieces of
   * shoreline, not centrelines — a strict bridge crossing one only meets
   * the shore, which the span rule on the rings has already failed.
   */
  areaLike: boolean;
  bounds: Area;
  /** Tidal by its own tags, so it can make a nearby river reach tidal too. */
  seed: boolean;
  /** The water body's name, for the bridge card. */
  name: string | null;
}

function prepareWater(water: RawChartElement): PreparedWater | null {
  const tags = water.tags ?? {};
  // A reach the mapper marked `tidal=no` is never a tidal candidate, even
  // within reach of tidal water — this is what keeps the Itchen's upper
  // bridges, and every river like it, off the chart.
  if (tags.tidal?.toLowerCase() === 'no') return null;
  const tidal = isTidalWater(tags);
  const seed = isTidalSeed(tags);
  // A marina is water a bridge can cross, but it cannot make the river it sits
  // on tidal. River reaches are kept as candidates: `bridgeMeetsWater` only
  // accepts the ones within tidal reach of a seed, which is how a tidal river
  // that carries no tidal tag at all still shows its bridges.
  if (!tidal && !isRiverWater(tags)) return null;
  const paths = stitchPaths(elementPaths(water));
  if (paths.length === 0) return null;
  const name = tags['seamark:name'] ?? tags.name;
  return {
    paths,
    surface: tags.natural === 'water' || tags.waterway?.toLowerCase() === 'riverbank',
    areaLike: tags.natural === 'water' || tags.waterway?.toLowerCase() === 'riverbank' || tags.type === 'multipolygon',
    bounds: boundsOfPaths(paths),
    seed,
    name: typeof name === 'string' && name.trim() !== '' ? name.trim() : null,
  };
}

/**
 * Whether a bridge's lines meet any prepared water body.
 *
 * `bridgeBounds` must be the bridge's own extent; it prunes both whole water
 * bodies and individual water segments, and the padding is generous against the
 * 100 m tolerance so a crossing near the bridge's edge is still found.
 *
 * A strict bridge — a light bridge (footway, cycleway, path, bridleway,
 * steps), or any bridge element with no carrying way at all — must prove a
 * real span: over an area it has to cut the boundary at least twice, and over
 * a line it has to cross it, not run alongside it — so marina walkways,
 * boardwalks, fingers out to the floats and bare structure rings do not
 * count, however much water they touch. Other bridges keep the lenient rule,
 * where touching water or passing within tolerance of it counts — except
 * that a path entering and exiting an area counts only when the run is a
 * channel crossing, not a chord across a polygon tip.
 */
/** Waterway points with their along-water distance to the tide, indexed by ~1 km grid cell. */
type DistanceGrid = Map<string, { lat: number; lon: number; dist: number }[]>;

/** Index an along-water distances map by grid cell, so one water body can find the points near it. */
function buildDistanceGrid(distances: Map<string, number>): DistanceGrid {
  const grid: DistanceGrid = new Map();
  for (const [key, dist] of distances) {
    const [latText, lonText] = key.split(',');
    const lat = Number(latText);
    const lon = Number(lonText);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const cell = `${Math.floor(lat / 0.01)},${Math.floor(lon / 0.01)}`;
    const list = grid.get(cell) ?? [];
    list.push({ lat, lon, dist });
    grid.set(cell, list);
  }
  return grid;
}

/**
 * Whether a non-tidal water body lies within tidal reach of tidal water.
 *
 * One test for areas and centrelines, measured along the water, not as the
 * crow flies. A body counts as tidal when it touches or overlaps a tidal
 * polygon — a point of it inside a tidal ring, or a boundary segment within
 * 25 m of a tidal segment, which is how a river polygon whose centreline
 * stops short of the sea still counts (the mapping-gap fallback) — or when
 * a waterway point inside it connects to tidal water through the mapped
 * network within 2000 m along the water (the distance grid built from the
 * along-water walk). A straight-line 2000 m test used to let a dammed reach
 * count — its polygon sits near the harbour while its water never reaches
 * it — so the straight line survives only inside the 25 m touch test,
 * never as a reach on its own. Segment pairs far apart are pruned by their
 * bounding boxes first, so a strait with a thousand segments costs
 * comparisons, not distances.
 */
function waterWithinTidalReach(
  water: PreparedWater,
  seeds: PreparedWater[],
  distanceGrid?: DistanceGrid,
): boolean {
  for (const seed of seeds) {
    for (const seedLine of seed.paths) {
      const seedPoints = seedLine.map(([lat, lon]) => ({ lat, lon }));
      const first = seedPoints[0];
      const last = seedPoints[seedPoints.length - 1];
      const closedRing = seedPoints.length >= 4 && first !== undefined && last !== undefined &&
        Math.abs(first.lat - last.lat) < 1e-9 && Math.abs(first.lon - last.lon) < 1e-9;
      if (seed.surface || closedRing) {
        const ring = seedPoints.map(({ lat, lon }) => [lon, lat]);
        const [seedSouth, seedWest, seedNorth, seedEast] = boundsOfPaths([seedLine]);
        for (const waterLine of water.paths) {
          for (const [lat, lon] of waterLine) {
            if (lat < seedSouth || lat > seedNorth || lon < seedWest || lon > seedEast) continue;
            if (pointInRing(lon, lat, ring)) return true;
          }
        }
      }
      for (const waterLine of water.paths) {
        for (let waterIndex = 1; waterIndex < waterLine.length; waterIndex += 1) {
          const a = { lat: waterLine[waterIndex - 1][0], lon: waterLine[waterIndex - 1][1] };
          const b = { lat: waterLine[waterIndex][0], lon: waterLine[waterIndex][1] };
          for (let seedIndex = 1; seedIndex < seedLine.length; seedIndex += 1) {
            const c = { lat: seedLine[seedIndex - 1][0], lon: seedLine[seedIndex - 1][1] };
            const d = { lat: seedLine[seedIndex][0], lon: seedLine[seedIndex][1] };
            // Prune in degrees at the pair's mean latitude; the prune is
            // wider than the touch tolerance, so it never drops a real near miss.
            const meanLat = ((a.lat + b.lat + c.lat + d.lat) / 4) * Math.PI / 180;
            const latTol = ALONG_WATER_TERMINAL_METERS / 110_574;
            const lonTol = ALONG_WATER_TERMINAL_METERS / (111_320 * Math.cos(meanLat));
            if (Math.min(c.lat, d.lat) > Math.max(a.lat, b.lat) + latTol ||
              Math.max(c.lat, d.lat) < Math.min(a.lat, b.lat) - latTol ||
              Math.min(c.lon, d.lon) > Math.max(a.lon, b.lon) + lonTol ||
              Math.max(c.lon, d.lon) < Math.min(a.lon, b.lon) - lonTol) continue;
            if (segmentsWithinMeters(a, b, c, d, ALONG_WATER_TERMINAL_METERS)) return true;
          }
        }
      }
    }
  }
  // Connect through the mapped waterway network within tidal reach: a
  // waterway point inside the body (or on its edge, a centreline node on
  // the bank) whose along-water distance to the tide is within reach.
  // The grid cells are ~1 km, so the range is widened by one cell each way
  // to catch a point just outside the body's bounds.
  if (distanceGrid) {
    const [south, west, north, east] = water.bounds;
    const rings = water.paths
      .filter((path) => path.length >= 4 && isClosedPath(path))
      .map((path) => path.map(([lat, lon]) => [lon, lat]));
    const cell = (value: number) => Math.floor(value / 0.01);
    for (let la = cell(south) - 1; la <= cell(north) + 1; la++) {
      for (let lo = cell(west) - 1; lo <= cell(east) + 1; lo++) {
        for (const node of distanceGrid.get(`${la},${lo}`) ?? []) {
          if (node.dist > TIDAL_REACH_METERS) continue;
          if (rings.some((ring) => pointInRing(node.lon, node.lat, ring))) return true;
          for (const line of water.paths) {
            for (let index = 1; index < line.length; index += 1) {
              if (pointToSegmentMeters(
                node,
                { lat: line[index - 1][0], lon: line[index - 1][1] },
                { lat: line[index][0], lon: line[index][1] },
              ) <= ALONG_WATER_TERMINAL_METERS) return true;
            }
          }
        }
      }
    }
  }
  return false;
}

/** A graph node is a waterway point, rounded to ~0.1 m: shared OSM nodes have identical coordinates, so they share a key. */
function nodeKey(lat: number, lon: number): string {
  return `${lat.toFixed(6)},${lon.toFixed(6)}`;
}

/** Whether a stitched path closes back on its start: a ring, not a line. */
function isClosedPath(path: [number, number][]): boolean {
  return path.length >= 4 &&
    Math.abs(path[0][0] - path[path.length - 1][0]) < 1e-9 &&
    Math.abs(path[0][1] - path[path.length - 1][1]) < 1e-9;
}

/**
 * How close a waterway point must come to mapped tidal water to count as
 * connected to it. Twenty-five metres covers the mapping offset between a
 * centreline end and the shoreline it meets (two mapped features, each with
 * its own imprecision); anything wider would let a river running alongside a
 * bay borrow the bay's tide without ever meeting it.
 */
const ALONG_WATER_TERMINAL_METERS = 25;

/** Rings too large for a point-in-ring test on every node: their interiors are
 * reached through boundary proximity instead, which is where a river mouth
 * actually meets them. */
const MAX_RING_SEGMENTS_FOR_INSIDE_TEST = 1000;

function segmentWithinAlongWaterReach(
  bridgeStart: Point, bridgeEnd: Point, from: Point, to: Point, distances: Map<string, number>,
): boolean {
  // The crossing point's own along-water distance, interpolated along the
  // water segment: either endpoint's distance plus the run from the crossing
  // to that endpoint. Endpoint-only lookup would let one long segment
  // straddle the reach — a bridge at its far end reading the near end's
  // distance — so the crossing point itself is what gets measured. A
  // near-miss match (tolerance, no exact intersection) reads from the nearer
  // endpoint, the only crossing the mapping supports.
  const hit = segmentIntersectionPoint(bridgeStart, bridgeEnd, from, to);
  const crossing = hit !== null
    ? { lat: hit.lat, lon: hit.lon }
    : (pointToSegmentMeters(from, bridgeStart, bridgeEnd) <= pointToSegmentMeters(to, bridgeStart, bridgeEnd) ? from : to);
  const distA = distances.get(nodeKey(from.lat, from.lon));
  const distB = distances.get(nodeKey(to.lat, to.lon));
  const viaA = distA === undefined ? Number.POSITIVE_INFINITY : distA + segmentLengthMeters(crossing, from);
  const viaB = distB === undefined ? Number.POSITIVE_INFINITY : distB + segmentLengthMeters(crossing, to);
  return Math.min(viaA, viaB) <= TIDAL_REACH_METERS;
}

/**
 * Along-water distance from every waterway point to the nearest tidal water,
 * walking the mapped network: river centrelines chained at shared nodes,
 * water areas crossed in a straight line (water is open inside a polygon),
 * and a centreline end that touches tidal water or falls inside it. Only
 * distances within the tidal reach are kept — the walk stops once every
 * unsettled point is further than a boat could be from the tide, so a whole
 * inland network costs no more than its tidal fringe.
 */
export function alongWaterDistances(waters: PreparedWater[]): Map<string, number> {
  const adjacency = new Map<string, { key: string; meters: number }[]>();
  const nodeCoords = new Map<string, Point>();
  const addEdge = (a: Point, b: Point, meters: number) => {
    const ka = nodeKey(a.lat, a.lon);
    const kb = nodeKey(b.lat, b.lon);
    if (ka === kb || !(meters > 0)) return;
    nodeCoords.set(ka, a);
    nodeCoords.set(kb, b);
    const fa = adjacency.get(ka) ?? [];
    fa.push({ key: kb, meters });
    adjacency.set(ka, fa);
    const fb = adjacency.get(kb) ?? [];
    fb.push({ key: ka, meters });
    adjacency.set(kb, fb);
  };
  const seedSegments: { a: Point; b: Point }[] = [];
  const seedRings: Point[][] = [];
  const areaRings: Point[][] = [];
  for (const water of waters) {
    for (const path of water.paths) {
      if (path.length < 2) continue;
      const points = path.map(([lat, lon]) => ({ lat, lon }));
      if (isClosedPath(path)) {
        if (water.seed) {
          seedRings.push(points);
          for (let i = 1; i < points.length; i++) seedSegments.push({ a: points[i - 1], b: points[i] });
        } else {
          areaRings.push(points);
        }
        continue;
      }
      for (let i = 1; i < points.length; i++) {
        addEdge(points[i - 1], points[i], segmentLengthMeters(points[i - 1], points[i]));
        if (water.seed) seedSegments.push({ a: points[i - 1], b: points[i] });
      }
    }
  }
  // A water area joins the network wherever a centreline enters it: every
  // line point inside the area (or near its edge) connects to every other
  // across open water, at the straight-line distance between them.
  for (const ring of areaRings) {
    const ringCoords = ring.map(({ lat, lon }) => [lon, lat]);
    const [south, west, north, east] = boundsOfPaths([ring.map(({ lat, lon }) => [lat, lon] as [number, number])]);
    const inside: Point[] = [];
    const testInside = ring.length <= MAX_RING_SEGMENTS_FOR_INSIDE_TEST;
    for (const point of nodeCoords.values()) {
      if (point.lat < south || point.lat > north || point.lon < west || point.lon > east) continue;
      if (testInside && pointInRing(point.lon, point.lat, ringCoords)) {
        inside.push(point);
        continue;
      }
      for (let i = 1; i < ring.length; i++) {
        if (pointToSegmentMeters(point, ring[i - 1], ring[i]) <= ALONG_WATER_TERMINAL_METERS) {
          inside.push(point);
          break;
        }
      }
    }
    for (let i = 0; i < inside.length; i++) {
      for (let j = i + 1; j < inside.length; j++) {
        addEdge(inside[i], inside[j], segmentLengthMeters(inside[i], inside[j]));
      }
    }
  }
  // Terminals: waterway points touching tidal water, or inside a tidal area.
  // Seed segments are indexed by grid cell so the proximity test stays cheap
  // no matter how many thousand segments a strait boundary holds.
  const seedGrid = new Map<string, { a: Point; b: Point }[]>();
  for (const seg of seedSegments) {
    const sLat = Math.floor(Math.min(seg.a.lat, seg.b.lat) / 0.01);
    const nLat = Math.floor(Math.max(seg.a.lat, seg.b.lat) / 0.01);
    const wLon = Math.floor(Math.min(seg.a.lon, seg.b.lon) / 0.01);
    const eLon = Math.floor(Math.max(seg.a.lon, seg.b.lon) / 0.01);
    for (let la = sLat; la <= nLat; la++) {
      for (let lo = wLon; lo <= eLon; lo++) {
        const k = `${la},${lo}`;
        const list = seedGrid.get(k) ?? [];
        list.push(seg);
        seedGrid.set(k, list);
      }
    }
  }
  const isTerminal = (point: Point): boolean => {
    const la = Math.floor(point.lat / 0.01);
    const lo = Math.floor(point.lon / 0.01);
    for (let dla = -1; dla <= 1; dla++) {
      for (let dlo = -1; dlo <= 1; dlo++) {
        for (const seg of seedGrid.get(`${la + dla},${lo + dlo}`) ?? []) {
          if (pointToSegmentMeters(point, seg.a, seg.b) <= ALONG_WATER_TERMINAL_METERS) return true;
        }
      }
    }
    for (const ring of seedRings) {
      if (ring.length > MAX_RING_SEGMENTS_FOR_INSIDE_TEST) continue;
      const [south, west, north, east] = boundsOfPaths([ring.map(({ lat, lon }) => [lat, lon] as [number, number])]);
      if (point.lat < south || point.lat > north || point.lon < west || point.lon > east) continue;
      if (pointInRing(point.lon, point.lat, ring.map(({ lat, lon }) => [lon, lat]))) return true;
    }
    return false;
  };
  const distances = new Map<string, number>();
  const heap: { key: string; dist: number }[] = [];
  const push = (key: string, dist: number) => {
    heap.push({ key, dist });
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent].dist <= heap[i].dist) break;
      [heap[parent], heap[i]] = [heap[i], heap[parent]];
      i = parent;
    }
  };
  const pop = (): { key: string; dist: number } | undefined => {
    if (heap.length === 0) return undefined;
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0 && last !== undefined) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let smallest = i;
        if (left < heap.length && heap[left].dist < heap[smallest].dist) smallest = left;
        if (right < heap.length && heap[right].dist < heap[smallest].dist) smallest = right;
        if (smallest === i) break;
        [heap[i], heap[smallest]] = [heap[smallest], heap[i]];
        i = smallest;
      }
    }
    return top;
  };
  for (const [key, point] of nodeCoords) {
    if (isTerminal(point)) {
      distances.set(key, 0);
      push(key, 0);
    }
  }
  while (heap.length > 0) {
    const current = pop();
    if (current === undefined || current.dist !== distances.get(current.key)) continue;
    if (current.dist > TIDAL_REACH_METERS) break;
    for (const edge of adjacency.get(current.key) ?? []) {
      const next = current.dist + edge.meters;
      if (next > TIDAL_REACH_METERS) continue;
      if (next < (distances.get(edge.key) ?? Number.POSITIVE_INFINITY)) {
        distances.set(edge.key, next);
        push(edge.key, next);
      }
    }
  }
  return distances;
}

function bridgeMeetsWater(bridgePaths: [number, number][][], bridgeBounds: Area, waters: PreparedWater[], strict: boolean, alongWater?: Map<string, number>): string | null {
  const reach = padArea(bridgeBounds, WATER_CROSSING_TOLERANCE_DEGREES);
  const seeds = waters.filter((water) => water.seed);
  // Along-water distances are built once per view, not once per bridge: the
  // graph walk is the expensive part, and every bridge in the view shares it.
  const distances = alongWater ?? alongWaterDistances(waters);
  // The distance grid is built once per view with the walk above, so the
  // tidal-reach test for an area can find the waterway points near it
  // without re-indexing the whole network for every bridge.
  const distanceGrid = buildDistanceGrid(distances);
  // A bridge can meet several bodies at once — the river, an unnamed dock beside
  // it, and a marina basin alongside. The card should say "River Itchen", so an
  // unnamed match is only a fallback and open tidal water beats a marina.
  let unnamedMatch: string | null = null;
  let namedMatch: string | null = null;
  // Settles a match: open tidal water ends the search at once, a named marina or
  // river is remembered in case nothing better is found.
  const recordMatch = (water: PreparedWater): string | null => {
    if (!water.name) {
      if (unnamedMatch === null) unnamedMatch = '';
      return null;
    }
    if (water.seed) return water.name;
    namedMatch ??= water.name;
    return null;
  };
  for (const water of waters) {
    if (!areasOverlap(reach, water.bounds)) continue;
    // A water body mapped as an area (a bay, a riverbank polygon) keeps the
    // whole-element reach test: an area has no centreline to walk. A river
    // centreline is judged per matched segment below, along the waterway —
    // the whole-element test let one segment near the sea make a whole river
    // tidal, bridges kilometres upstream included.
    const waterHasArea = water.paths.some((path) => water.areaLike || isClosedPath(path));
    if (!water.seed && waterHasArea && !waterWithinTidalReach(water, seeds, distanceGrid)) continue;
    // Once a named body has matched, only open tidal water can improve on it.
    if (namedMatch !== null && !water.seed) continue;
    // Once any crossing is found, an unnamed body can add nothing.
    if (unnamedMatch !== null && !water.name) continue;
    for (const rawLine of water.paths) {
      if (rawLine.length < 2) continue;
      let lineMatched = false;
      const first = rawLine[0];
      const last = rawLine[rawLine.length - 1];
      const closedRing = rawLine.length >= 4 && Math.abs(first[0] - last[0]) < 1e-9 && Math.abs(first[1] - last[1]) < 1e-9;
      const waterArea = water.surface || closedRing;
      const line: Point[] = waterPoint(rawLine.map(([lat, lon]) => ({ lat, lon })));
      if (waterArea && line.length >= 3) {
        if (strict) {
          // A light bridge over an area counts only when it spans it. No
          // tolerance fallback: a walkway within 10 m of the water's edge, or
          // lying inside the area, is not a crossing.
          const spans = bridgePaths.some((path) => pathSpansArea(path, line));
          if (spans) {
            lineMatched = true;
            const settled = recordMatch(water);
            if (settled) return settled;
          }
          continue;
        }
        const ring = line.map(({ lat, lon }) => [lon, lat]);
        let crossesArea = false;
        for (const path of bridgePaths) {
          const { cuts, cumulative } = cutsAlongPath(path, line);
          if (cuts.length >= 2) {
            // The path enters and exits the area: only a channel crossing
            // counts, not a chord across a polygon tip. A rail nicking the
            // tip of a cove, or a road hugging a bay's edge, is not a bridge
            // over that water, however lenient the rule for a carrying
            // bridge — the water must continue past the run along the
            // channel. A path with fewer cuts keeps the lenient rule below.
            const startInside = pointInRing(path[0][1], path[0][0], ring);
            for (let run = 1; run < cuts.length; run += 1) {
              const inside = startInside ? run % 2 === 0 : run % 2 === 1;
              if (!inside) continue;
              const from = cuts[run - 1];
              const to = cuts[run];
              const midPoint = pointAtDistance(path, cumulative, (from.at + to.at) / 2);
              if (runIsChannelCrossing(midPoint, from, to, to.at - from.at, line)) {
                crossesArea = true;
                break;
              }
            }
            if (crossesArea) break;
            continue;
          }
          // Fewer than two cuts: the path lies inside the area, or enters
          // it and ends there (a bridge to an island, a pier) — the lenient
          // rule counts any point inside, and a segment that merely touches
          // the boundary counts as a crossing, as before.
          if (path.some(([lat, lon]) => pointInRing(lon, lat, ring))) {
            crossesArea = true;
            break;
          }
          for (let index = 1; index < path.length && !crossesArea; index += 1) {
            const start = { lat: path[index - 1][0], lon: path[index - 1][1] };
            const end = { lat: path[index][0], lon: path[index][1] };
            for (let waterIndex = 1; waterIndex < line.length; waterIndex += 1) {
              if (segmentsIntersect(start, end, line[waterIndex - 1], line[waterIndex])) {
                crossesArea = true;
                break;
              }
            }
          }
          if (crossesArea) break;
        }
        if (crossesArea) {
          lineMatched = true;
          const settled = recordMatch(water);
          if (settled) return settled;
        }
      }
      if (lineMatched) continue;
      // A light bridge must not cross on a fragment: an open line of a water
      // that also has closed rings, or of a multipolygon area, is a piece of
      // shoreline, not a centreline — a multipolygon's unjoined member — and
      // crossing it transversely only proves the walkway meets the shore,
      // which the span rule on the rings has already failed. Road bridges
      // keep the lenient rule: missing one is a hazard, while a walkway
      // fragment is clutter.
      if (strict && !waterArea && (water.areaLike || water.paths.some(isClosedPath))) continue;
      // An area's boundary ring is not a centreline: when a bridge path
      // enters and exits the area, the area branch above has already ruled
      // on the run — channel crossing or tip chord — and touching the ring
      // within tolerance must not overrule it. The tolerance below is only
      // for a path that does not enter and exit the area: a bridge mapped a
      // few metres short of the water, or ending inside it.
      if (waterArea && bridgePaths.some((path) => cutsAlongPath(path, line).cuts.length >= 2)) continue;
      for (const path of bridgePaths) {
        for (let index = 1; index < path.length; index += 1) {
          const start = { lat: path[index - 1][0], lon: path[index - 1][1] };
          const end = { lat: path[index][0], lon: path[index][1] };
          for (let waterIndex = 1; waterIndex < line.length; waterIndex += 1) {
            const from = line[waterIndex - 1];
            const to = line[waterIndex];
            // A segment that cannot reach the bridge's extent cannot meet it.
            if (
              Math.min(from.lat, to.lat) > reach[2] || Math.max(from.lat, to.lat) < reach[0] ||
              Math.min(from.lon, to.lon) > reach[3] || Math.max(from.lon, to.lon) < reach[1]
            ) continue;
            if (strict ? !segmentsCrossTransversely(start, end, from, to) : !segmentsWithinTolerance(start, end, from, to)) continue;
            // A non-seed centreline counts only where the water at the
            // crossing is within along-water reach of the tide. Judging the
            // whole line would let one mouth segment carry bridges far
            // upstream; judging the crossing keeps the mouth and drops the
            // headwaters.
            if (!water.seed && !waterArea && !segmentWithinAlongWaterReach(start, end, from, to, distances)) continue;
            lineMatched = true;
          }
          if (lineMatched) break;
        }
        if (lineMatched) break;
      }
      if (!lineMatched) continue;
      const settled = recordMatch(water);
      if (settled) return settled;
      break;
    }
  }
  return namedMatch ?? unnamedMatch;
}

/**
 * Whether a bridge crosses water the tide reaches.
 *
 * A bridge is often a multipolygon relation, and a sea, estuary or harbour is
 * almost always one, so both sides are read from every line the element holds
 * rather than from a single `geometry` array (which a relation does not have).
 * Water shapes count as areas even when they are not tagged `natural=water`:
 * a mapped bay, harbour basin or sea is still water a boat can float on.
 */
export function bridgeCrossesWater(bridge: RawChartElement, waters: RawChartElement[]): boolean {
  const bridgePaths = bridgeLines(bridge);
  if (bridgePaths.length === 0) return false;
  const prepared = waters.map(prepareWater).filter((water): water is PreparedWater => water !== null);
  return bridgeMeetsWater(bridgePaths, boundsOfPaths(bridgePaths), prepared, isStrictBridge(bridge.tags)) !== null;
}

function keyFor(bounds: Bounds): string {
  return bounds.map((value) => value.toFixed(3)).join(',');
}

/**
 * The proxy fetches bridge/area data in fixed 0.05° cells (see
 * server/overpassProxy.ts CHART_FEATURE_CELL_DEGREES), so the device cache
 * key uses the same snapped cell: panning inside one cell reuses the answer
 * instead of missing the cache on every small move.
 */
const CHART_FEATURE_CELL_DEGREES = 0.05;
function snapCellBounds([south, west, north, east]: Bounds): Bounds {
  const step = CHART_FEATURE_CELL_DEGREES;
  const down = (value: number) => Math.round(Math.floor(value / step) * step * 1000) / 1000;
  const up = (value: number) => Math.round(Math.ceil(value / step) * step * 1000) / 1000;
  return [down(south), down(west), up(north), up(east)];
}

/**
 * Query marks for an arbitrary viewport. The proxy hedges across Overpass
 * mirrors and caches on disk, so this is only used outside the built regions.
 */
export async function queryNavaids(
  bounds: Bounds,
  options: { signal?: AbortSignal; force?: boolean } = {},
): Promise<LiveQueryResult> {
  const key = keyFor(bounds);
  const cached = memory.get(key);
  if (!options.force && cached && Date.now() - cached.at < TTL_MS) {
    return { navaids: cached.navaids, cached: true, fetchedAt: cached.at };
  }

  const [south, west, north, east] = bounds;
  const response = await fetch(`/api/overpass?bbox=${south},${west},${north},${east}`, {
    signal: options.signal,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Chart data unavailable (HTTP ${response.status})`);
  }

  const payload = (await response.json()) as {
    elements?: unknown[];
    meta?: { cached?: boolean; downloadedAt?: number };
  };
  const navaids: Navaid[] = [];
  for (const element of payload.elements ?? []) {
    const navaid = normalizeElement(element, null, 'osm') as Navaid | null;
    if (!navaid) continue;
    // A live query carries the full tag set, so the mark gets the charted
    // detail the built archive drops even where no index entry exists.
    const detail: MarkDetailEntry | null = markDetailsFromTags((element as RawChartElement).tags);
    navaids.push(detail ? { ...navaid, ...detail } : navaid);
  }

  memory.set(key, { navaids, at: Date.now() });
  return { navaids, cached: Boolean(payload.meta?.cached), fetchedAt: Date.now() };
}

/**
 * Which half of the bridge/area overlay a request fetches.
 *
 * The two halves are asked for separately because they are different sizes: a
 * combined query waited for both, so a bridge did not draw until the protected
 * area shapes had arrived (measured 7.8 s against 3.3–3.9 s for either half).
 */
export type ChartFeaturePart = 'bridges' | 'areas';

/**
 * The device-cache key for one fetched cell. The filter version is part of
 * the key, so a rule change (see CHART_FEATURE_FILTER_VERSION) makes old
 * cells miss instead of serving bridges drawn under older rules.
 */
export function chartFeatureCacheKey(part: ChartFeaturePart, bounds: Bounds): string {
  return `${part}:v${CHART_FEATURE_FILTER_VERSION}:${keyFor(snapCellBounds(bounds))}`;
}

export async function queryChartFeaturePart(
  bounds: Bounds,
  part: ChartFeaturePart,
  options: { signal?: AbortSignal; force?: boolean } = {},
): Promise<LiveChartFeaturesResult> {
  const key = chartFeatureCacheKey(part, bounds);
  const cached = chartFeatureMemory.get(key);
  if (!options.force && cached && Date.now() - cached.at < CHART_FEATURE_CACHE_MS) {
    return { features: cached.features, cached: true, fetchedAt: cached.at };
  }
  if (!options.force) {
    // The device cache outlives the server's: a redeploy wipes the proxy's
    // disk cache, but a view already visited still loads from this browser.
    const stored = await readChartFeatureCell(key);
    if (stored) {
      const status = storedCellStatus(stored.at);
      if (status === 'fresh') {
        chartFeatureMemory.set(key, { features: stored.features, at: stored.at });
        return { features: stored.features, cached: true, fetchedAt: stored.at };
      }
      if (status === 'stale') {
        chartFeatureMemory.set(key, { features: stored.features, at: stored.at });
        // Serve the stale answer now and refresh quietly: the next view
        // change picks up the fresh answer from the memory cache.
        void queryChartFeaturePart(bounds, part, { signal: options.signal, force: true }).catch(() => {});
        return { features: stored.features, cached: true, fetchedAt: stored.at };
      }
    }
  }
  const [south, west, north, east] = bounds;
  // The Overpass mirrors are flaky: a single failed fetch used to leave the
  // view with no bridges at all and no retry, which reads as bridges missing
  // worldwide. Retry a failed part a couple of times before giving up, so a
  // momentary mirror outage does not empty the chart.
  const url = `/api/overpass?kind=chart-features&part=${part}&bbox=${south},${west},${north},${east}`;
  let response: Response | undefined;
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (options.signal?.aborted) break;
    const attemptStarted = Date.now();
    try {
      response = await fetch(url, { signal: options.signal });
      if (response.ok) break;
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      lastError = new Error(body.error ?? `Bridge and protected-area data unavailable (HTTP ${response.status})`);
      // The status rides on the error so a background retry can tell a
      // rate limit or hard denial (stop) from a mirror outage (retry).
      (lastError as { status?: number }).status = response.status;
      response = undefined;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Bridge and protected-area data unavailable');
      response = undefined;
    }
    if (attempt < 2 && !options.signal?.aborted) {
      // A failure that itself took a long time means the mirrors are
      // saturated, not momentarily blinking: retrying immediately only adds
      // another slow wait, and the next view change tries again anyway.
      if (Date.now() - attemptStarted > 20_000) break;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  if (!response) {
    throw lastError ?? new Error('Bridge and protected-area data unavailable');
  }
  const payload = (await response.json()) as {
    elements?: RawChartElement[];
    features?: ChartFeature[];
    meta?: { cached?: boolean };
  };
  // The proxy now sends the drawn features directly: the raw reply is mostly
  // water geometry the card never shows, so shipping it doubled the wait.
  // A reply that still carries elements is computed the same way as before.
  // Each half only produces its own kind, and the callers merge the two lists.
  const features: ChartFeature[] = Array.isArray(payload.features)
    ? payload.features
    : (() => {
      const { bridges, areas } = chartFeaturesFromElements(payload.elements ?? []);
      return [...areas, ...bridges];
    })();
  const fetchedAt = Date.now();
  chartFeatureMemory.set(key, { features, at: fetchedAt });
  void writeChartFeatureCell(key, features, fetchedAt);
  return { features, cached: Boolean(payload.meta?.cached), fetchedAt };
}

/**
 * Backoff between background retry rounds for a chart-feature part that
 * exhausted its foreground attempts. Minutes apart in total, so a
 * saturated mirror gets room to recover instead of another immediate hit.
 */
export const CHART_FEATURE_BACKGROUND_RETRY_DELAYS_MS = [30_000, 60_000, 120_000];

/**
 * True when a chart-feature failure is worth retrying in the background:
 * mirror outages, proxy 5xx and network blips are transient, but a 429
 * (rate limit) or 403 (hard denial) means retrying would only add load
 * against a refusal, so those stop at once. Aborts stop too.
 */
function isRetryableChartFeatureError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return false;
  const status = (error as { status?: number } | null)?.status;
  return status !== 429 && status !== 403;
}

/**
 * Fetch one chart-feature part, then keep retrying quietly in the
 * background when the foreground attempts exhaust. The returned promise
 * stays pending across background rounds and resolves the moment a round
 * succeeds, so a caller that draws on resolution (the App overlay effect)
 * fills the overlay in without the user panning or reloading; it rejects
 * only when a round fails non-retryably or the delays run out. The rounds
 * reuse queryChartFeaturePart unchanged, so memory/device cache semantics
 * (fresh 6 h, stale-serve + quiet refresh) are exactly as before, and a
 * caller-supplied signal stops the chain at once.
 */
export function queryChartFeaturePartWithBackgroundRetry(
  bounds: Bounds,
  part: ChartFeaturePart,
  options: {
    signal?: AbortSignal;
    force?: boolean;
    backgroundDelaysMs?: number[];
  } = {},
): Promise<LiveChartFeaturesResult> {
  const delays = options.backgroundDelaysMs ?? CHART_FEATURE_BACKGROUND_RETRY_DELAYS_MS;
  return new Promise<LiveChartFeaturesResult>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    let round = 0;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      fn();
    };
    const onAbort = () => settle(() => reject(new DOMException('The operation was aborted', 'AbortError')));
    if (options.signal) {
      if (options.signal.aborted) {
        onAbort();
        return;
      }
      options.signal.addEventListener('abort', onAbort, { once: true });
    }
    const attemptRound = () => {
      if (options.signal?.aborted) {
        onAbort();
        return;
      }
      queryChartFeaturePart(bounds, part, { signal: options.signal, force: options.force })
        .then((result) => settle(() => resolve(result)))
        .catch((error) => {
          if (settled) return;
          if (!isRetryableChartFeatureError(error) || options.signal?.aborted || round >= delays.length) {
            settle(() => reject(error));
            return;
          }
          const delay = delays[round];
          round += 1;
          timer = setTimeout(attemptRound, delay);
        });
    };
    attemptRound();
  });
}

/**
 * The features a chart-feature reply can actually be drawn as: bridges that
 * span tidal water, and designated marine areas. A light bridge (footway,
 * cycleway, path, bridleway) must genuinely span the water — cutting an area's
 * boundary twice, or crossing a centreline — while other bridges keep the
 * lenient touching rule. Shared with the server's coverage line so the
 * disclaimer page counts what the chart draws.
 */
export function chartFeaturesFromElements(elements: RawChartElement[]): {
  bridges: ChartFeature[];
  areas: ChartFeature[];
} {
  const waterWays = elements
    .map(prepareWater)
    .filter((water): water is PreparedWater => water !== null);
  const alongWater = alongWaterDistances(waterWays);
  const bridges: ChartFeature[] = [];
  const areas: ChartFeature[] = [];
  for (const element of elements) {
    const tags = element.tags ?? {};
    const wayLike = element.type === 'way' || element.type === 'relation';
    const bridgePaths = wayLike &&
      (tags['seamark:type'] === 'bridge' || Boolean(tags.bridge && tags.bridge !== 'no') || tags['man_made'] === 'bridge')
      ? bridgeLines(element)
      : [];
    const crossedWater = bridgePaths.length > 0
      ? bridgeMeetsWater(bridgePaths, boundsOfPaths(bridgePaths), waterWays, isStrictBridge(tags), alongWater)
      : null;
    const bridge = crossedWater !== null;
    const area = classifyMarineArea(tags);
    if (!bridge && !area) continue;
    const paths = elementPaths(element);
    if (paths.length === 0) continue;
    const coordinates = paths.flat();
    const lats = coordinates.map(([lat]) => lat);
    const lons = coordinates.map(([, lon]) => lon);
    const point = element.center ?? (element.lat !== undefined && element.lon !== undefined
      ? { lat: element.lat, lon: element.lon }
      : { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lon: (Math.min(...lons) + Math.max(...lons)) / 2 });
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) continue;
    const sourceKind = element.type === 'relation' ? 'relation' : 'way';
    const baseName = tags.name ?? tags['bridge:name'] ?? tags['seamark:name'] ??
      (bridge ? 'Bridge' : area?.label ?? 'Marine area');
    const id = `osm:${element.type ?? 'node'}/${element.id ?? `${point.lat}/${point.lon}`}`;
    // Every mapped tag the object carries, so the popup can show the designation,
    // operator, access, dates and any restriction wording the source records.
    const properties = chartFeatureProperties(tags);
    // The body of water the crossing was matched against, so the card can say
    // what the bridge crosses rather than only what carries it.
    if (bridge && crossedWater) properties['water crossed'] = crossedWater;
    const { rings, lines } = ringsAndLines(paths);
    const feature: ChartFeature = {
      id,
      type: bridge ? 'bridge' : 'protected_area',
      ...(bridge ? { waterCrossing: true } : {}),
      name: baseName,
      lat: point.lat,
      lon: point.lon,
      path: coordinates,
      paths,
      rings,
      lines,
      ...(area ? { areaGroup: area.group, areaLabel: area.label } : {}),
      properties,
      sourceUrl: `https://www.openstreetmap.org/${sourceKind}/${element.id}`,
    };
    if (bridge) bridges.push(feature);
    else areas.push(feature);
  }

  // OSM may split a named bridge into multiple ways and/or map both generic
  // bridge and seamark records. Coalesce nearby parts so the chart shows one
  // overlay and one card for that physical crossing.
  const merged = coalesceBridges(bridges);
  // A bare structure outline with no name, no carrying route and no seamark
  // record is not evidence of a bridge: mappers draw man_made=bridge rings
  // around piers, docks and waterfront structures, and the lenient water
  // test lets any ring overlapping a bay polygon through. Named outlines
  // and outlines folded with a carrying way still stand, as do seamark
  // bridges, which are navigation structures in their own right.
  const evidenced = merged.filter((bridge) => {
    if (bridge.name !== 'Bridge') return true;
    if (bridge.properties.highway || bridge.properties.railway) return true;
    return (bridge.properties['seamark:type'] ?? '').split(' / ').includes('bridge');
  });
  return { bridges: evidenced, areas };
}

/**
 * The name a bridge is grouped under: case, punctuation and a trailing
 * generic word do not make a different bridge, so "Northam Bridge" and
 * "northam bridge" group together. An empty key means the record is unnamed.
 */
export function bridgeNameKey(name: string): string {
  const words = name.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((word) => word !== '');
  while (words.length > 0 && words[words.length - 1] === 'bridge') words.pop();
  return words.join(' ');
}

/**
 * The smallest gap between two mapped polylines, measured point-to-segment.
 * Node-to-node distance lies about parallel ways: two carriageways of one
 * bridge can have nodes offset along the bridge by far more than the gap
 * between the carriageways themselves, so comparing nodes only split one
 * bridge into one overlay per direction, plus one per footway. Comparing
 * each line against the other's segments measures the gap that matters.
 */
function polylineGapMeters(a: [number, number][][], b: [number, number][][]): number {
  let best = Number.POSITIVE_INFINITY;
  const measure = (points: [number, number][][], segments: [number, number][][]) => {
    for (const line of points) {
      for (const [lat, lon] of line) {
        for (const segment of segments) {
          for (let i = 0; i + 1 < segment.length; i++) {
            best = Math.min(best, pointToSegmentMeters(
              { lat, lon },
              { lat: segment[i][0], lon: segment[i][1] },
              { lat: segment[i + 1][0], lon: segment[i + 1][1] },
            ));
          }
        }
      }
    }
  };
  measure(a, b);
  measure(b, a);
  if (best === Number.POSITIVE_INFINITY) {
    // Degenerate lines with no segments at all: fall back to point-to-point.
    for (const lineA of a) {
      for (const [latA, lonA] of lineA) {
        for (const lineB of b) {
          for (const [latB, lonB] of lineB) {
            best = Math.min(best, distanceMeters(latA, lonA, latB, lonB));
          }
        }
      }
    }
  }
  return best;
}

function pathsNear(a: ChartFeature, b: ChartFeature, toleranceMeters: number): boolean {
  const linesA = a.paths.length > 0 ? a.paths : [a.path];
  const linesB = b.paths.length > 0 ? b.paths : [b.path];
  return polylineGapMeters(linesA, linesB) <= toleranceMeters;
}

/**
 * Fold every record of one physical crossing into a single chart feature, so
 * the chart draws one overlay and one card per bridge. Records group when
 * their names agree (or one side is unnamed) and their geometry is near:
 * centres within 300 m or lines within 35 m for a named crossing,
 * tighter (100 m / 8 m) when neither side is named, and lines within
 * 35 m or centres within 100 m when only one side is named. Near is measured
 * line-to-line, not node-to-node, so parallel carriageways and their
 * footways fold together even when their mapped nodes do not line up. A named
 * part gives the group its name, and every distinct mapped value is kept, so no
 * part's information is silently dropped.
 */
export function coalesceBridges(bridges: ChartFeature[]): ChartFeature[] {
  // Work on copies: callers pass chart features straight out of props, and
  // grouping concatenates paths and folds tags, which must not rewrite the
  // caller's records on every redraw.
  const copies = bridges.map((bridge) => ({
    ...bridge,
    path: [...bridge.path],
    paths: [...(bridge.paths ?? [])],
    properties: { ...bridge.properties },
  }));
  const groups: ChartFeature[] = [];
  for (const bridge of copies) {
    const key = bridgeNameKey(bridge.name);
    const existing = groups.find((candidate) => {
      const candidateKey = bridgeNameKey(candidate.name);
      const bothNamed = key !== '' && candidateKey !== '';
      const oneNamed = (key === '') !== (candidateKey === '');
      if (!bothNamed && !oneNamed && !(key === '' && candidateKey === '')) return false;
      const namesAgree = bothNamed && (key === candidateKey || key.startsWith(`${candidateKey} `) || candidateKey.startsWith(`${key} `));
      if (bothNamed && !namesAgree) return false;
      const centreDistance = distanceMeters(candidate.lat, candidate.lon, bridge.lat, bridge.lon);
      if (key === '' && candidateKey === '') {
        return centreDistance <= 100 || pathsNear(candidate, bridge, 8);
      }
      if (oneNamed) {
        return centreDistance <= 100 || pathsNear(candidate, bridge, 35);
      }
      return centreDistance <= 300 || pathsNear(candidate, bridge, 35);
    });
    if (!existing) {
      groups.push(bridge);
      continue;
    }
    foldBridgeInto(existing, bridge);
  }

  // A road changes name where it crosses the bridge: Johnson Street becomes
  // Pandora Avenue to the east and Esquimalt Road to the west, and each
  // approach is tagged bridge=yes under its own street name. Name agreement
  // can never fold those, so a second pass folds groups whose lines meet and
  // which cross the same water carrying the same class of route. A footway
  // beside the road is not folded here — its carrying class differs — and a
  // group with no water or no carrying class is never folded this way, so
  // the pass cannot join unrelated crossings that merely touch.
  let folded = true;
  while (folded) {
    folded = false;
    for (let i = 0; i < groups.length && !folded; i++) {
      for (let j = i + 1; j < groups.length && !folded; j++) {
        const a = groups[i];
        const b = groups[j];
        const waterA = a.properties['water crossed'];
        const waterB = b.properties['water crossed'];
        if (!waterA || !waterB || waterA !== waterB) continue;
        const carryA = a.properties.highway ?? a.properties.railway;
        const carryB = b.properties.highway ?? b.properties.railway;
        if (!carryA || !carryB || carryA.toLowerCase() !== carryB.toLowerCase()) continue;
        if (!pathsNear(a, b, 2)) continue;
        foldBridgeInto(a, b, true);
        groups.splice(j, 1);
        folded = true;
      }
    }
  }
  // A bridge is often mapped twice: once as the structure outline
  // (man_made=bridge, a closed ring named for the bridge) and once as the
  // road that runs over it (named for the street). Worldwide, that pair is
  // the two cards: one for the bridge, one for the road leading up to it.
  // A third pass folds any group whose line runs genuinely inside an
  // outline's ring into that outline's group, so the chart shows one card
  // titled for the bridge. A group that merely touches the outline at an
  // endpoint — the approach road joining the bridge — is not folded here:
  // folding a kilometres-long approach would drag the marker off the
  // bridge, and the connected-segments pass already handles the deck.
  let contained = true;
  while (contained) {
    contained = false;
    for (let i = 0; i < groups.length && !contained; i++) {
      const outline = groups[i];
      const outlineRings = outline.rings ?? [];
      if (outlineRings.length === 0) continue;
      for (let j = 0; j < groups.length && !contained; j++) {
        if (i === j) continue;
        const other = groups[j];
        if ((other.rings ?? []).length > 0) continue;
        const waterA = outline.properties['water crossed'];
        const waterB = other.properties['water crossed'];
        if (waterA && waterB && waterA !== waterB) continue;
        const inside = outlineRings.some((ring) => {
          const xy = ring.map(([lat, lon]) => [lon, lat]);
          return other.paths.some((path) => path.some(([lat, lon]) => {
            if (!pointInRing(lon, lat, xy)) return false;
            // Genuinely inside, not a point sitting on the ring itself.
            for (let k = 1; k < ring.length; k++) {
              if (pointToSegmentMeters(
                { lat, lon },
                { lat: ring[k - 1][0], lon: ring[k - 1][1] },
                { lat: ring[k][0], lon: ring[k][1] },
              ) <= 2) return false;
            }
            return true;
          }));
        });
        if (!inside) continue;
        foldBridgeInto(outline, other);
        groups.splice(j, 1);
        contained = true;
      }
    }
  }
  return groups;
}

/**
 * Fold one bridge part into the group the chart will show: the name is kept
 * unless the group is unnamed (or, across a name change, the incoming name is
 * the bridge's own name rather than a street name), the paths accumulate, the
 * centre is recomputed, and every record's tags and source links are kept.
 */
function foldBridgeInto(existing: ChartFeature, bridge: ChartFeature, connected = false): void {
  const key = bridgeNameKey(bridge.name);
  if (bridgeNameKey(existing.name) === '' && key !== '') {
    existing.name = bridge.name;
  } else if (connected && !/\bbridge$/i.test(existing.name) && /\bbridge$/i.test(bridge.name)) {
    existing.name = bridge.name;
  }
  existing.path.push(...bridge.path);
  const points = existing.path;
  existing.lat = points.reduce((sum, [lat]) => sum + lat, 0) / points.length;
  existing.lon = points.reduce((sum, [, lon]) => sum + lon, 0) / points.length;
  existing.paths = [...existing.paths, ...(bridge.paths.length > 0 ? bridge.paths : [bridge.path])];
  mergeBridgeRecord(existing, bridge);
  const urls = [...(existing.sourceUrls ?? [existing.sourceUrl]), bridge.sourceUrl];
  existing.sourceUrls = [...new Set(urls)];
  if (bridge.sourceUrl < existing.sourceUrl) {
    existing.sourceUrl = bridge.sourceUrl;
    existing.id = bridge.id;
  }
}

/**
 * Carrying classes a parallel footway or cycle path is mapped with.
 *
 * A footpath beside a road bridge is a separate OSM way with the same name, and
 * it is the least informative record of the crossing.
 */
const MINOR_CARRYING = new Set([
  'footway', 'cycleway', 'steps', 'path', 'pedestrian', 'corridor', 'bridleway', 'service',
]);

/**
 * Fold one mapped part of a bridge into the record the chart will show.
 *
 * OSM often maps a road bridge and its footway as separate ways sharing a name,
 * and the parts are not equally informative: the footway part of Northam Bridge
 * says `highway=cycleway` and names no water, while the road part says
 * `highway=primary` and crosses the Itchen. Merging in arrival order let the
 * lesser part relabel the crossing as a cycle bridge and drop the water it
 * crosses, so the card described the footpath instead of the bridge.
 */
function mergeBridgeRecord(existing: ChartFeature, part: ChartFeature): void {
  const merged = existing.properties;
  for (const [key, value] of Object.entries(part.properties)) {
    if (typeof value !== 'string' || value.trim() === '') continue;
    const current = merged[key];
    // The water a crossing spans is the reason the feature is here; another part
    // meeting a marina basin must not rename it.
    if (key === 'water crossed' && current) continue;
    if (key === 'highway' || key === 'railway') {
      if (!current) {
        merged[key] = value;
        continue;
      }
      const valueMinor = MINOR_CARRYING.has(value.toLowerCase());
      const currentMinor = MINOR_CARRYING.has(current.toLowerCase());
      // A footway or cycleway part must not relabel the crossing, but the
      // road or rail class it runs beside does replace a lesser one.
      if (valueMinor && !currentMinor) continue;
      if (!valueMinor && currentMinor) {
        merged[key] = value;
        continue;
      }
    }
    // Every distinct value is kept, so folding parts together loses nothing
    // one part mapped: the card shows each value the records disagree on.
    if (current && current !== value && !current.split(' / ').includes(value)) {
      merged[key] = `${current} / ${value}`;
      continue;
    }
    merged[key] = value;
  }
}

export function clearOverpassMemory(): void {
  memory.clear();
  chartFeatureMemory.clear();
}
