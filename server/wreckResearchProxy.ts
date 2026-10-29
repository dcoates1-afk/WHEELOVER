import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

const ENDPOINT = 'https://ows.emodnet-humanactivities.eu/wfs';
const CACHE_MS = 6 * 60 * 60 * 1000;
const MAX_RECORDS = 100;
const cache = new Map<string, { at: number; payload: unknown }>();

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=900');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
}

export function createWreckResearchHandler() {
  return async function wreckResearchHandler(req: IncomingMessage, res: ServerResponse) {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    const latParam = url.searchParams.get('lat');
    const lonParam = url.searchParams.get('lon');
    const lat = latParam === null || latParam.trim() === '' ? Number.NaN : Number(latParam);
    const lon = lonParam === null || lonParam.trim() === '' ? Number.NaN : Number(lonParam);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      sendJson(res, 400, { error: 'A valid lat and lon are required' });
      return;
    }

    const key = createHash('sha1').update(`${lat.toFixed(2)},${lon.toFixed(2)}`).digest('hex');
    const cached = cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_MS) {
      sendJson(res, 200, cached.payload);
      return;
    }

    // Search a small local area for candidate historical records. These are
    // candidate associations only: many EMODnet positions are site centroids.
    const radius = 0.03;
    const params = new URLSearchParams({
      service: 'WFS',
      version: '2.0.0',
      request: 'GetFeature',
      typeNames: 'emodnet:heritageshipwrecks',
      count: String(MAX_RECORDS),
      outputFormat: 'application/json',
      bbox: `${Math.max(-180, lon - radius)},${Math.max(-90, lat - radius)},${Math.min(180, lon + radius)},${Math.min(90, lat + radius)},EPSG:4326`,
    });
    try {
      const response = await fetch(`${ENDPOINT}?${params}`, { signal: AbortSignal.timeout(12_000) });
      if (!response.ok) {
        sendJson(res, 502, { error: `Heritage source unavailable (HTTP ${response.status})` });
        return;
      }
      const payload = (await response.json()) as { type?: unknown; features?: unknown };
      if (payload.type !== 'FeatureCollection' || !Array.isArray(payload.features)) {
        sendJson(res, 502, { error: 'Heritage source returned an invalid feature collection' });
        return;
      }
      cache.set(key, { at: Date.now(), payload });
      sendJson(res, 200, payload);
    } catch {
      sendJson(res, 502, { error: 'Heritage source could not be reached' });
    }
  };
}
