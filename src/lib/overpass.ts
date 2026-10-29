import { distanceMeters, normalizeElement } from '../../shared/navaid-core.mjs';
import type { Navaid } from './navaidTypes';
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
  properties: Record<string, string>;
  sourceUrl: string;
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

type RawChartElement = {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  geometry?: { lat: number; lon: number }[];
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

const WATER_CROSSING_TOLERANCE_METERS = 100;

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

export function bridgeCrossesWater(bridge: RawChartElement, waters: RawChartElement[]): boolean {
  const bridgeLine = bridge.geometry ?? [];
  if (bridgeLine.length < 2) return false;
  return waters.some((water) => {
    const waterTags = water.tags ?? {};
    const waterway = waterTags.waterway?.toLowerCase();
    const isTidalWater = waterTags.tidal?.toLowerCase() === 'yes' ||
      waterTags['tidal:range'] !== undefined ||
      waterTags.water?.toLowerCase() === 'tidal' ||
      waterway === 'tidal_channel';
    if (!isTidalWater) return false;
    const waterLine = water.geometry ?? [];
    if (waterLine.length < 2) return false;
    const waterArea = waterTags.natural === 'water' || waterway === 'riverbank';
    if (waterArea && waterLine.length >= 3) {
      const ring = waterLine.map(({ lat, lon }) => [lon, lat]);
      if (bridgeLine.some((point) => pointInRing(point.lon, point.lat, ring))) return true;
      if (bridgeLine.some((point, index) => index > 0 && waterLine.some((waterPoint, waterIndex) =>
        waterIndex > 0 && segmentsIntersect(
          bridgeLine[index - 1], point,
          waterLine[waterIndex - 1], waterPoint,
        ),
      ))) return true;
    }
    return bridgeLine.some((bridgePoint, index) =>
      index > 0 && waterLine.some((waterPoint, waterIndex) =>
        waterIndex > 0 && segmentsWithinTolerance(bridgeLine[index - 1], bridgePoint, waterLine[waterIndex - 1], waterPoint),
      ),
    );
  });
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
    if (navaid) navaids.push(navaid);
  }

  memory.set(key, { navaids, at: Date.now() });
  return { navaids, cached: Boolean(payload.meta?.cached), fetchedAt: Date.now() };
}

export async function queryChartFeatures(
  bounds: Bounds,
  options: { signal?: AbortSignal; force?: boolean } = {},
): Promise<LiveChartFeaturesResult> {
  const key = keyFor(bounds);
  const cached = chartFeatureMemory.get(key);
  if (!options.force && cached && Date.now() - cached.at < CHART_FEATURE_CACHE_MS) {
    return { features: cached.features, cached: true, fetchedAt: cached.at };
  }
  const [south, west, north, east] = bounds;
  const response = await fetch(
    `/api/overpass?kind=chart-features&bbox=${south},${west},${north},${east}`,
    { signal: options.signal },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Bridge and protected-area data unavailable (HTTP ${response.status})`);
  }
  const payload = (await response.json()) as {
    elements?: RawChartElement[];
    meta?: { cached?: boolean };
  };
  const features: ChartFeature[] = [];
  const elements = payload.elements ?? [];
  const waterWays = elements.filter((element) => {
    const tags = element.tags ?? {};
    const waterway = tags.waterway?.toLowerCase();
    return tags.tidal?.toLowerCase() === 'yes' || tags['tidal:range'] !== undefined ||
      tags.water?.toLowerCase() === 'tidal' || waterway === 'tidal_channel';
  });
  const bridges: ChartFeature[] = [];
  for (const element of payload.elements ?? []) {
    const tags = element.tags ?? {};
    const bridge = (tags['seamark:type'] === 'bridge' || Boolean(tags.bridge && tags.bridge !== 'no')) &&
      (element.type === 'way' || element.type === 'relation') && bridgeCrossesWater(element, waterWays);
    const protectedArea = tags.boundary === 'protected_area' || tags.boundary === 'national_park' || tags.leisure === 'nature_reserve' || Boolean(tags.protect_class);
    if (!bridge && !protectedArea) continue;
    const coordinates = element.geometry?.map(({ lat, lon }) => [lat, lon] as [number, number]) ?? [];
    const centre = element.center ?? (element.lat !== undefined && element.lon !== undefined ? { lat: element.lat, lon: element.lon } : null);
    const point = centre ?? (coordinates.length ? {
      lat: coordinates.reduce((sum, [lat]) => sum + lat, 0) / coordinates.length,
      lon: coordinates.reduce((sum, [, lon]) => sum + lon, 0) / coordinates.length,
    } : null);
    if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lon)) continue;
    const type = bridge ? 'bridge' : 'protected_area';
    const sourceKind = element.type === 'relation' ? 'relation' : element.type === 'way' ? 'way' : 'node';
    const baseName = tags.name ?? tags['seamark:name'] ?? (bridge ? 'Bridge' : 'Protected area');
    const id = `osm:${element.type ?? 'node'}/${element.id ?? `${point.lat}/${point.lon}`}`;

    const detailKeys = bridge
      ? ['seamark:bridge:category', 'seamark:bridge:clearance_height', 'seamark:bridge:clearance_height_closed', 'seamark:bridge:clearance_height_open', 'seamark:bridge:clearance_width', 'bridge:movable', 'operator', 'opening_hours', 'description', 'note', 'source']
      : ['protect_class', 'protection_title', 'designation', 'operator', 'start_date', 'access', 'seamark:information', 'description', 'note', 'source'];
    const properties = Object.fromEntries(detailKeys.filter((key) => tags[key]).map((key) => [key, tags[key]]));
    const feature: ChartFeature = {
      id,
      type,
      ...(bridge ? { waterCrossing: true } : {}),
      name: baseName,
      lat: point.lat,
      lon: point.lon,
      path: coordinates,
      paths: coordinates.length > 1 ? [coordinates] : [],
      properties,
      sourceUrl: `https://www.openstreetmap.org/${sourceKind}/${element.id}`,
    };
    if (bridge) bridges.push(feature);
    else features.push(feature);
  }

  // OSM may split a named bridge into multiple ways and/or map both generic
  // bridge and seamark records. Coalesce nearby parts so the chart shows one
  // clickable label for that physical crossing.
  const bridgeGroups: ChartFeature[] = [];
  for (const bridge of bridges) {
    const nameKey = bridge.name.trim().toLocaleLowerCase();
    const existing = bridgeGroups.find((candidate) => {
      const candidateName = candidate.name.trim().toLocaleLowerCase();
      const sameNamedBridge = nameKey !== 'bridge' && candidateName === nameKey;
      const sameUnnamedCrossing = nameKey === 'bridge' && candidateName === 'bridge';
      if (!sameNamedBridge && !sameUnnamedCrossing) return false;
      const centreDistance = distanceMeters(candidate.lat, candidate.lon, bridge.lat, bridge.lon);
      if (sameUnnamedCrossing && centreDistance > 100) return false;
      const nearCentres = centreDistance <= (sameNamedBridge ? 300 : 100);
      const nearSegments = candidate.path.some(([lat, lon]) => bridge.path.some(([otherLat, otherLon]) =>
        distanceMeters(lat, lon, otherLat, otherLon) <= (sameNamedBridge ? 35 : 8),
      ));
      return nearCentres || nearSegments;
    });
    if (!existing) {
      bridgeGroups.push(bridge);
      continue;
    }
    existing.path.push(...bridge.path);
    const points = existing.path;
    existing.lat = points.reduce((sum, [lat]) => sum + lat, 0) / points.length;
    existing.lon = points.reduce((sum, [, lon]) => sum + lon, 0) / points.length;
    existing.paths = [existing.path];
    existing.properties = { ...existing.properties, ...bridge.properties };
    if (bridge.sourceUrl < existing.sourceUrl) {
      existing.sourceUrl = bridge.sourceUrl;
      existing.id = bridge.id;
    }
  }
  features.push(...bridgeGroups);
  const fetchedAt = Date.now();
  chartFeatureMemory.set(key, { features, at: fetchedAt });
  return { features, cached: Boolean(payload.meta?.cached), fetchedAt };
}

export function clearOverpassMemory(): void {
  memory.clear();
  chartFeatureMemory.clear();
}
