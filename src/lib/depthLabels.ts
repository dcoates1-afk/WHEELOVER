/**
 * Numeric depth labels for the chart.
 *
 * NOAA ENC already provides charted spot soundings, but only in US waters. For
 * the rest of the world the best keyless numeric feed is the modelled seabed:
 * GEBCO's 15 arc-second global grid, refined in European waters by EMODnet's
 * roughly 115 m DTM. Both answer a point query with a JSON value, and both allow
 * a browser request.
 *
 * These are grid samples, not surveyed soundings. The overlay is labelled as
 * modelled everywhere it appears and must never be treated as chart detail.
 */

import { convertDepth } from './settings';
import type { DepthUnit } from './settings';

export interface DepthPoint {
  lat: number;
  lon: number;
}

export interface DepthSample {
  depth: number | null;
  source: 'gebco' | 'emodnet';
}

export const DEPTH_LABEL_MIN_ZOOM = 12;
/** EMODnet is fine enough to be worth the extra refinement request from here. */
export const EMODNET_MIN_ZOOM = 14;
export const DEPTH_LABEL_ATTRIBUTION = 'Depth numbers: GEBCO 2024 & EMODnet DTM (modelled)';

export const GEBCO_IDENTIFY =
  'https://di-elevation.img.arcgis.com/arcgis/rest/services/gebco/ImageServer/identify';
/** Same-origin proxy for EMODnet; the origin does not allow every browser. */
export const EMODNET_SAMPLE = '/api/depth';

/** Rough EMODnet Bathymetry coverage: European seas and the adjacent Atlantic. */
export const EMODNET_BOUNDS = { west: -42, south: 25, east: 45, north: 84 };

export function inEmodnetCoverage(lat: number, lon: number): boolean {
  return (
    lat >= EMODNET_BOUNDS.south &&
    lat <= EMODNET_BOUNDS.north &&
    lon >= EMODNET_BOUNDS.west &&
    lon <= EMODNET_BOUNDS.east
  );
}

/**
 * Chart-style depth text, in the unit chosen in Settings: one decimal in the
 * shallows, whole units deeper. The figure is bare because it sits among other
 * numbers on the chart; the tooltip and the legend carry the unit.
 */
export function formatDepth(
  depth: number | null | undefined,
  unit: DepthUnit = 'm',
): string {
  if (depth === null || depth === undefined || !Number.isFinite(depth) || depth < 0.1) return '';
  const value = Math.round(convertDepth(depth, unit) * 10) / 10;
  if (value < 10) return value.toFixed(1);
  return String(Math.round(value));
}

/**
 * Screen positions for a staggered label grid. Staggering alternate rows keeps
 * neighbouring numbers from forming conspicuous columns on the chart.
 */
export function sampleOffsets(width: number, height: number, spacing = 150, margin = 64): [number, number][] {
  const out: [number, number][] = [];
  if (width <= margin * 2 || height <= margin * 2) return out;
  let row = 0;
  for (let y = margin; y <= height - margin; y += spacing * 0.9, row += 1) {
    const shift = row % 2 === 0 ? 0 : spacing / 2;
    for (let x = margin + shift; x <= width - margin; x += spacing) out.push([x, y]);
  }
  if (out.length <= 72) return out;
  const stride = Math.ceil(out.length / 72);
  return out.filter((_, index) => index % stride === 0);
}

interface GEBCOIdentifyResult {
  value?: unknown;
  location?: { x?: unknown; y?: unknown };
}

/** Parse the ArcGIS identify response (single point or multipoint). */
export function parseGebcoIdentify(payload: unknown): Array<{ lat: number; lon: number; depth: number }> {
  const body = payload as { results?: unknown; value?: unknown; location?: GEBCOIdentifyResult['location'] };
  const entries = Array.isArray(body?.results)
    ? (body.results as GEBCOIdentifyResult[])
    : body && body.value !== undefined
      ? [body as GEBCOIdentifyResult]
      : [];
  const out: Array<{ lat: number; lon: number; depth: number }> = [];
  for (const entry of entries) {
    const lon = Number(entry?.location?.x);
    const lat = Number(entry?.location?.y);
    const value = Number(entry?.value);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(value)) continue;
    // GEBCO stores elevation: negative is below sea level. Land and nodata are
    // not depths and must not be labelled.
    if (value >= 0 || value <= -11_000) continue;
    out.push({ lat, lon, depth: Math.abs(value) });
  }
  return out;
}

/** EMODnet's `avg` is an elevation too: negative underwater, positive on land. */
export function parseEmodnetSample(payload: unknown): number | null {
  const body = payload as { avg?: unknown; smoothed?: unknown; min?: unknown };
  const raw = Number(body?.avg ?? body?.smoothed ?? body?.min);
  if (!Number.isFinite(raw) || raw >= 0) return null;
  return Math.abs(raw);
}

const cache = new Map<string, { depth: number | null; at: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function cacheKey(source: 'gebco' | 'emodnet', lat: number, lon: number): string {
  return `${source}:${lat.toFixed(4)}:${lon.toFixed(4)}`;
}

function readCache(source: 'gebco' | 'emodnet', lat: number, lon: number): number | null | undefined {
  const entry = cache.get(cacheKey(source, lat, lon));
  if (!entry) return undefined;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(cacheKey(source, lat, lon));
    return undefined;
  }
  return entry.depth;
}

function writeCache(
  source: 'gebco' | 'emodnet',
  lat: number,
  lon: number,
  depth: number | null,
): void {
  cache.set(cacheKey(source, lat, lon), { depth, at: Date.now() });
}

export function clearDepthCache(): void {
  cache.clear();
}

async function fetchGebcoChunk(
  points: DepthPoint[],
  signal: AbortSignal,
): Promise<Map<string, number | null>> {
  const geometry = {
    points: points.map((point) => [point.lon, point.lat]),
    spatialReference: { wkid: 4326 },
  };
  const url =
    `${GEBCO_IDENTIFY}?f=json&geometry=${encodeURIComponent(JSON.stringify(geometry))}` +
    '&geometryType=esriGeometryMultipoint&sr=4326&returnGeometry=false';
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`GEBCO HTTP ${response.status}`);
  const payload = (await response.json()) as unknown;
  const parsed = parseGebcoIdentify(payload);
  const byLocation = new Map<string, number>();
  for (const entry of parsed) {
    byLocation.set(`${entry.lat.toFixed(5)}:${entry.lon.toFixed(5)}`, entry.depth);
  }
  const out = new Map<string, number | null>();
  for (const point of points) {
    const key = `${point.lat.toFixed(5)}:${point.lon.toFixed(5)}`;
    out.set(key, byLocation.get(key) ?? null);
  }
  return out;
}

interface EMODnetResponse {
  samples?: Array<{ lat?: unknown; lon?: unknown; depth?: unknown }>;
}

/** One request for the whole refined grid; the proxy samples EMODnet in turn. */
async function fetchEmodnetBatch(
  points: DepthPoint[],
  signal: AbortSignal,
): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  const params = points.map((point) => `${point.lat.toFixed(5)},${point.lon.toFixed(5)}`).join(';');
  try {
    const response = await fetch(`${EMODNET_SAMPLE}?points=${encodeURIComponent(params)}`, { signal });
    if (!response.ok) return out;
    const body = (await response.json()) as EMODnetResponse;
    for (const sample of body.samples ?? []) {
      const lat = Number(sample.lat);
      const lon = Number(sample.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const raw = sample.depth;
      const depth = raw === null ? null : Number(raw);
      if (depth !== null && (!Number.isFinite(depth) || depth < 0)) continue;
      out.set(`${lat.toFixed(5)}:${lon.toFixed(5)}`, depth);
    }
  } catch {
    // Leave the GEBCO labels in place when the refinement request fails.
  }
  return out;
}

/**
 * Fetch labels for a viewport. GEBCO answers the whole grid in one batch, so
 * numbers appear immediately; inside EMODnet coverage at close zoom the same
 * points are then refined with the finer European DTM, and each refinement
 * replaces the coarse value in place.
 */
export async function fetchDepthSamples(
  points: DepthPoint[],
  zoom: number,
  signal: AbortSignal,
  onSample: (point: DepthPoint, sample: DepthSample) => void,
): Promise<void> {
  const unique = new Map<string, DepthPoint>();
  for (const point of points) unique.set(`${point.lat.toFixed(5)}:${point.lon.toFixed(5)}`, point);
  const all = [...unique.values()];
  const pending = all.filter((point) => {
    const cached = readCache('gebco', point.lat, point.lon);
    if (cached === undefined) return true;
    onSample(point, { depth: cached, source: 'gebco' });
    return false;
  });

  if (pending.length > 0 && !signal.aborted) {
    const chunks: DepthPoint[][] = [];
    for (let index = 0; index < pending.length; index += 50) chunks.push(pending.slice(index, index + 50));
    for (const chunk of chunks) {
      if (signal.aborted) return;
      try {
        const values = await fetchGebcoChunk(chunk, signal);
        for (const point of chunk) {
          if (signal.aborted) return;
          const key = `${point.lat.toFixed(5)}:${point.lon.toFixed(5)}`;
          if (!values.has(key)) continue;
          const depth = values.get(key) ?? null;
          writeCache('gebco', point.lat, point.lon, depth);
          onSample(point, { depth, source: 'gebco' });
        }
      } catch {
        // A failed GEBCO request leaves those labels blank; the chart itself is
        // unchanged, so there is nothing else to do here.
      }
    }
  }

  if (zoom < EMODNET_MIN_ZOOM || signal.aborted) return;
  // Every other label is enough to show the finer DTM without doubling the
  // number of depth samples on a busy harbour view.
  const refine = all.filter(
    (point, index) => index % 2 === 0 && inEmodnetCoverage(point.lat, point.lon),
  );
  const uncached: DepthPoint[] = [];
  for (const point of refine) {
    const cached = readCache('emodnet', point.lat, point.lon);
    if (cached !== undefined) {
      onSample(point, { depth: cached, source: 'emodnet' });
    } else {
      uncached.push(point);
    }
  }
  if (uncached.length === 0 || signal.aborted) return;
  const values = await fetchEmodnetBatch(uncached, signal);
  for (const point of uncached) {
    if (signal.aborted) return;
    const key = `${point.lat.toFixed(5)}:${point.lon.toFixed(5)}`;
    if (!values.has(key)) continue;
    const depth = values.get(key) ?? null;
    writeCache('emodnet', point.lat, point.lon, depth);
    onSample(point, { depth, source: 'emodnet' });
  }
}
