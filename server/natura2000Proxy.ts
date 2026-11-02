import type { IncomingMessage, ServerResponse } from 'node:http';

const ENDPOINT = 'https://ows.emodnet-humanactivities.eu/wfs';
const CACHE_MS = 60 * 60 * 1000;
const cache = new Map<string, { at: number; payload: unknown }>();
type Bounds = [number, number, number, number];

// EMODnet splits conservation sites over two layers. The Natura 2000 layer
// carries the EU directives and dates but no longer holds UK sites, so the
// wider marine-protected-area layer is queried alongside it: a Solent-scale
// view returns nothing from the first layer and the nine Solent sites from the
// second. Both are merged into one collection for the chart.
const LAYERS = [
  { name: 'emodnet:natura2000areas', label: 'Natura 2000 site', count: 20 },
  { name: 'emodnet:marineprotectedareas', label: 'Marine protected area', count: 30 },
] as const;

type SourceFeature = {
  id?: string;
  type?: string;
  geometry?: unknown;
  properties?: Record<string, unknown>;
};

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=900');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
}

function parseBounds(value: string | null): Bounds | null {
  if (!value) return null;
  const bounds = value.split(',').map(Number);
  if (bounds.length !== 4 || bounds.some((part) => !Number.isFinite(part))) return null;
  const [south, west, north, east] = bounds;
  if (south < -90 || north > 90 || west < -180 || east > 180 || south >= north || west >= east) return null;
  if (north - south > 2 || east - west > 2) return null;
  return [south, west, north, east];
}

/** Site names arrive HTML-escaped in the protected-area layer. */
function siteName(properties: Record<string, unknown>): string {
  const raw = properties.sitename ?? properties.name ?? properties.orig_name ?? '';
  return String(raw)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function collectionFeatures(features: unknown): SourceFeature[] | null {
  if (!Array.isArray(features)) return null;
  return features.filter((feature): feature is SourceFeature => Boolean(feature) && typeof feature === 'object');
}

type Position = number[];

/** Chart-scale boundary outline: five decimals is about a metre. */
function roundPoint(point: Position): Position {
  return [Math.round(point[0] * 1e5) / 1e5, Math.round(point[1] * 1e5) / 1e5];
}

/**
 * Ramer–Douglas–Peucker, run with an explicit stack so a long ring cannot
 * overflow the call stack. The protected-area layer ships surveys with
 * hundreds of thousands of points, which is far finer than this overlay draws.
 */
function simplifyRing(points: Position[], tolerance: number): Position[] {
  if (points.length <= 4) return points;
  const squaredTolerance = tolerance * tolerance;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop() as [number, number];
    const [x1, y1] = points[first];
    const [x2, y2] = points[last];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const denominator = dx * dx + dy * dy;
    let farthest = -1;
    let farthestDistance = 0;
    for (let index = first + 1; index < last; index += 1) {
      const [x, y] = points[index];
      const along = denominator === 0 ? 0 : Math.min(1, Math.max(0, ((x - x1) * dx + (y - y1) * dy) / denominator));
      const offsetX = x1 + along * dx - x;
      const offsetY = y1 + along * dy - y;
      const distance = offsetX * offsetX + offsetY * offsetY;
      if (distance > farthestDistance) {
        farthestDistance = distance;
        farthest = index;
      }
    }
    if (farthest > 0 && farthestDistance > squaredTolerance) {
      keep[farthest] = 1;
      stack.push([first, farthest], [farthest, last]);
    }
  }
  const simplified: Position[] = [];
  for (let index = 0; index < points.length; index += 1) {
    if (keep[index]) simplified.push(points[index]);
  }
  return simplified;
}

function simplifyGeometry(geometry: unknown, tolerance: number): unknown {
  const shaped = geometry as { type?: string; coordinates?: unknown } | null;
  if (!shaped || !Array.isArray(shaped.coordinates)) return geometry;
  const ring = (value: unknown) =>
    simplifyRing((Array.isArray(value) ? value : []) as Position[], tolerance).map(roundPoint);
  const rings = (value: unknown) => (Array.isArray(value) ? value.map(ring) : value);
  if (shaped.type === 'Polygon') return { ...shaped, coordinates: rings(shaped.coordinates) };
  if (shaped.type === 'MultiPolygon') {
    return { ...shaped, coordinates: (shaped.coordinates as unknown[]).map(rings) };
  }
  return geometry;
}

async function fetchLayer(layer: typeof LAYERS[number], bounds: Bounds): Promise<SourceFeature[]> {
  const [south, west, north, east] = bounds;
  const params = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: layer.name,
    count: String(layer.count),
    outputFormat: 'application/json',
    bbox: `${west},${south},${east},${north},EPSG:4326`,
  });
  const response = await fetch(`${ENDPOINT}?${params}`, { signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`${layer.name} unavailable (HTTP ${response.status})`);
  const payload = await response.json() as { type?: unknown; features?: unknown };
  if (payload.type !== 'FeatureCollection') throw new Error(`${layer.name} returned an invalid feature collection`);
  const features = collectionFeatures(payload.features);
  if (!features) throw new Error(`${layer.name} returned an invalid feature collection`);
  // A 0.3° Solent box carries 12 MB of survey-grade outlines; the chart only
  // needs the shoreline silhouette, so simplify to roughly the drawn scale.
  const tolerance = Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1]) / 1500;
  return features.map((feature) => ({
    ...feature,
    geometry: simplifyGeometry(feature.geometry, tolerance),
    properties: { ...(feature.properties ?? {}), designation_layer: layer.label },
  }));
}

export function createNatura2000Handler() {
  return async function natura2000Handler(req: IncomingMessage, res: ServerResponse) {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    const bounds = parseBounds(url.searchParams.get('bbox'));
    if (!bounds) {
      sendJson(res, 400, { error: 'bbox=south,west,north,east is required (max 2° per side)' });
      return;
    }
    const key = bounds.map((value) => value.toFixed(3)).join(',');
    const cached = cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_MS) {
      sendJson(res, 200, cached.payload);
      return;
    }
    const results = await Promise.allSettled(LAYERS.map((layer) => fetchLayer(layer, bounds)));
    const merged: SourceFeature[] = [];
    const seen = new Set<string>();
    for (const result of results) {
      if (result.status !== 'fulfilled') continue;
      for (const feature of result.value) {
        // The same site appears in both layers; the Natura record is kept
        // because it carries the directive and notification dates.
        const name = siteName(feature.properties ?? {}).toLowerCase();
        const identity = name || String(feature.id ?? '');
        if (seen.has(identity)) continue;
        seen.add(identity);
        merged.push(feature);
      }
    }
    if (merged.length === 0 && results.every((result) => result.status === 'rejected')) {
      sendJson(res, 502, { error: 'Conservation-site sources could not be reached' });
      return;
    }
    const payload = { type: 'FeatureCollection', features: merged };
    cache.set(key, { at: Date.now(), payload });
    sendJson(res, 200, payload);
  };
}
