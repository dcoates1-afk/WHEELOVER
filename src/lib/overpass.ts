import { distanceMeters, normalizeElement } from '../../shared/navaid-core.mjs';
import { elementPaths, ringsAndLines, stitchPaths } from '../../shared/marine-area-core.mjs';
import { classifyMarineArea, type MarineAreaGroup } from './marineAreas';
import type { Navaid } from './navaidTypes';
import { markDetailsFromTags, type MarkDetailEntry } from './markDetails';
import type { Bounds } from './navaidDb';

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
 * let road bridges beside a river read as water crossings.)
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
  return segmentsIntersect(a, b, c, d) ||
    pointToSegmentMeters(a, c, d) <= WATER_CROSSING_TOLERANCE_METERS ||
    pointToSegmentMeters(b, c, d) <= WATER_CROSSING_TOLERANCE_METERS ||
    pointToSegmentMeters(c, a, b) <= WATER_CROSSING_TOLERANCE_METERS ||
    pointToSegmentMeters(d, a, b) <= WATER_CROSSING_TOLERANCE_METERS;
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
 * centreline: the Itchen above Cobden Bridge, the Gorge, the reaches behind half
 * the world's harbours. Their tidal limit is not tagged, so a reach is treated
 * as tidal when it lies within this distance of water that is unambiguously
 * tidal — the sea, an estuary, a harbour basin or a bay. Twelve kilometres
 * covers the mapped tidal reach of rivers like the Itchen and the Gorge while
 * leaving genuinely inland rivers, lakes and canals alone.
 */
export const TIDAL_REACH_DEGREES = 0.11;

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
 */
function isTidalSeed(tags: Record<string, string>): boolean {
  if (tags.leisure?.toLowerCase() === 'marina') return false;
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
  bounds: Area;
  /** Tidal by its own tags, so it can make a nearby river reach tidal too. */
  seed: boolean;
  /** The water body's name, for the bridge card. */
  name: string | null;
}

function prepareWater(water: RawChartElement): PreparedWater | null {
  const tags = water.tags ?? {};
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
 */
function bridgeMeetsWater(bridgePaths: [number, number][][], bridgeBounds: Area, waters: PreparedWater[]): string | null {
  const reach = padArea(bridgeBounds, WATER_CROSSING_TOLERANCE_DEGREES);
  // Bounds of water that is tidal on its own terms, padded by the tidal reach,
  // so each river reach can be accepted or skipped without walking every water
  // body's geometry.
  const tidalReach = waters
    .filter((water) => water.seed)
    .map((water) => padArea(water.bounds, TIDAL_REACH_DEGREES));
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
    if (!water.seed && !tidalReach.some((area) => areasOverlap(water.bounds, area))) continue;
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
        const ring = line.map(({ lat, lon }) => [lon, lat]);
        let crossesArea = false;
        for (const path of bridgePaths) {
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
            if (!segmentsWithinTolerance(start, end, from, to)) continue;
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
  return bridgeMeetsWater(bridgePaths, boundsOfPaths(bridgePaths), prepared) !== null;
}

function keyFor(bounds: Bounds): string {
  return bounds.map((value) => value.toFixed(3)).join(',');
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

export async function queryChartFeaturePart(
  bounds: Bounds,
  part: ChartFeaturePart,
  options: { signal?: AbortSignal; force?: boolean } = {},
): Promise<LiveChartFeaturesResult> {
  const key = `${part}:${keyFor(bounds)}`;
  const cached = chartFeatureMemory.get(key);
  if (!options.force && cached && Date.now() - cached.at < CHART_FEATURE_CACHE_MS) {
    return { features: cached.features, cached: true, fetchedAt: cached.at };
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
    try {
      response = await fetch(url, { signal: options.signal });
      if (response.ok) break;
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      lastError = new Error(body.error ?? `Bridge and protected-area data unavailable (HTTP ${response.status})`);
      response = undefined;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Bridge and protected-area data unavailable');
      response = undefined;
    }
    if (attempt < 2 && !options.signal?.aborted) {
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  if (!response) {
    throw lastError ?? new Error('Bridge and protected-area data unavailable');
  }
  const payload = (await response.json()) as {
    elements?: RawChartElement[];
    meta?: { cached?: boolean };
  };
  const elements = payload.elements ?? [];
  const { bridges, areas } = chartFeaturesFromElements(elements);
  // Each half only produces its own kind, and the callers merge the two lists.
  const features: ChartFeature[] = [...areas, ...bridges];
  const fetchedAt = Date.now();
  chartFeatureMemory.set(key, { features, at: fetchedAt });
  return { features, cached: Boolean(payload.meta?.cached), fetchedAt };
}

/**
 * The features a chart-feature reply can actually be drawn as: bridges that
 * cross tidal water, and designated marine areas. Shared with the server's
 * coverage line so the disclaimer page counts what the chart draws.
 */
export function chartFeaturesFromElements(elements: RawChartElement[]): {
  bridges: ChartFeature[];
  areas: ChartFeature[];
} {
  const waterWays = elements
    .map(prepareWater)
    .filter((water): water is PreparedWater => water !== null);
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
      ? bridgeMeetsWater(bridgePaths, boundsOfPaths(bridgePaths), waterWays)
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
  return { bridges: coalesceBridges(bridges), areas };
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
