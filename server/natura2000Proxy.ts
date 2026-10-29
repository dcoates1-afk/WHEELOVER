import type { IncomingMessage, ServerResponse } from 'node:http';

const ENDPOINT = 'https://ows.emodnet-humanactivities.eu/wfs';
const CACHE_MS = 60 * 60 * 1000;
const cache = new Map<string, { at: number; payload: unknown }>();
type Bounds = [number, number, number, number];

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
    const [south, west, north, east] = bounds;
    const params = new URLSearchParams({
      service: 'WFS',
      version: '2.0.0',
      request: 'GetFeature',
      typeNames: 'emodnet:natura2000areas',
      count: '20',
      outputFormat: 'application/json',
      bbox: `${west},${south},${east},${north},EPSG:4326`,
    });
    try {
      const response = await fetch(`${ENDPOINT}?${params}`, { signal: AbortSignal.timeout(12_000) });
      if (!response.ok) {
        sendJson(res, 502, { error: `Natura 2000 source unavailable (HTTP ${response.status})` });
        return;
      }
      const payload = await response.json() as { type?: unknown; features?: unknown };
      if (payload.type !== 'FeatureCollection' || !Array.isArray(payload.features)) {
        sendJson(res, 502, { error: 'Natura 2000 source returned an invalid feature collection' });
        return;
      }
      cache.set(key, { at: Date.now(), payload });
      sendJson(res, 200, payload);
    } catch {
      sendJson(res, 502, { error: 'Natura 2000 source could not be reached' });
    }
  };
}
