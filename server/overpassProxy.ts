/**
 * Overpass proxy.
 *
 * Public Overpass mirrors are frequently saturated, so the proxy hedges across
 * three of them, keeps a disk cache, and serves a stale answer while refreshing
 * in the background rather than making a navigator wait.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildPoiQuery as RAW_BUILD_POI_QUERY } from '../shared/poi-core.mjs';
import { chartFeaturesFromElements, type RawChartElement } from '../src/lib/overpass';

const MIRRORS = [
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

/**
 * A mirror's database can lag real time by days or months, and a lagging one is
 * often the fastest to answer. Serving its copy as live chart data would show
 * superseded marks, so a reply further behind than this is only a last resort.
 */
export const MAX_MIRROR_LAG_MS = 7 * 24 * 60 * 60 * 1000;

/** Epoch milliseconds of a reply's `osm3s.timestamp_osm_base`, or null if absent. */
export function replySourceTimestamp(payload: unknown): number | null {
  const raw = (payload as { osm3s?: { timestamp_osm_base?: unknown } } | null)?.osm3s?.timestamp_osm_base;
  if (typeof raw !== 'string') return null;
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? timestamp : null;
}

/** Whether a reply is recent enough to treat as live data. */
export function mirrorDataIsCurrent(timestamp: number | null, now = Date.now()): boolean {
  // A reply without the timestamp cannot be judged, so it keeps the old trust.
  return timestamp === null || now - timestamp <= MAX_MIRROR_LAG_MS;
}

const CACHE_DIR = resolve(process.cwd(), '.marnav-cache/overpass');
/** One small file describing the latest chart-context fetch, for the disclaimer page. */
const CHART_FEATURE_STATS_FILE = resolve(CACHE_DIR, 'chart-features-latest.json');
const FRESH_MS = 6 * 60 * 60 * 1000;
const STALE_MS = 30 * 24 * 60 * 60 * 1000;

type Bounds = [number, number, number, number];
type QueryKind = 'navaids' | 'pois' | 'chart-features';

const buildPoiQuery = RAW_BUILD_POI_QUERY as (bounds: Bounds) => string;

/**
 * What the disclaimer page is allowed to say about the live bridge/area overlay.
 * It describes the most recent fetch, not the whole planet, because the overlay
 * is queried per chart view instead of shipped as a built extract.
 */
export interface ChartFeatureStats {
  fetchedAt: number;
  sourceTimestamp: number | null;
  /** Raw mapped objects the reply held, including the water shapes used to test crossings. */
  objects: number;
  /** Bridges over tidal water and marine areas the reply can be drawn as. */
  bridges: number;
  areas: number;
  /** True when the mirror that answered was further behind than MAX_MIRROR_LAG_MS. */
  behind: boolean;
}

/** Accept only a complete, positive description of a fetch. */
export function summarizeChartFeatureStats(raw: string | null): ChartFeatureStats | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const record = parsed as Partial<ChartFeatureStats> | null;
  if (!record || typeof record !== 'object') return null;
  const objects = Number(record.objects);
  const fetchedAt = Number(record.fetchedAt);
  if (!Number.isFinite(objects) || objects <= 0 || !Number.isFinite(fetchedAt)) return null;
  const rawTimestamp = record.sourceTimestamp;
  const sourceTimestamp =
    typeof rawTimestamp === 'number' && Number.isFinite(rawTimestamp) && rawTimestamp > 0 ? rawTimestamp : null;
  const drawn = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0);
  return {
    fetchedAt,
    objects,
    bridges: drawn(record.bridges),
    areas: drawn(record.areas),
    sourceTimestamp,
    behind: record.behind === true,
  };
}

interface CacheEntry {
  fetchedAt: number;
  source: string;
  /** Data timestamp the mirror itself reported, when it reports one. */
  sourceTimestamp?: number | null;
  payload: unknown;
}

const inflight = new Map<string, Promise<CacheEntry>>();

export function buildChartFeatureQuery([south, west, north, east]: Bounds): string {
  const box = `${south},${west},${north},${east}`;
  return [
    '[out:json][timeout:60];(',
    `nwr["seamark:type"="bridge"](${box});`,
    `nwr["bridge"]["bridge"!="no"](${box});`,
    `nwr["man_made"="bridge"](${box});`,
    // Water the tide reaches. Most of it is not tagged tidal at all: a sea,
    // estuary, harbour basin or dock is mapped by what it is.
    `nwr["tidal"="yes"](${box});`,
    `nwr["tidal:range"](${box});`,
    `nwr["waterway"~"^(tidal_channel|dock)$"](${box});`,
    `nwr["water"~"^(sea|tidal|estuary|lagoon|harbour|harbor|dock|basin|cove|bay)$"](${box});`,
    `nwr["natural"~"^(bay|strait|cove|fjord)$"](${box});`,
    `nwr["harbour"](${box});`,
    `nwr["seamark:type"~"^(harbour|harbour_basin|bay|estuary|dock|sea_area)$"](${box});`,
    // Marine areas that restrict a boat or matter to marine life: protected and
    // conservation designations, reefs, banks and shoals, restricted and
    // caution areas, and military ranges and test areas.
    `nwr["boundary"~"^(protected_area|national_park)$"](${box});`,
    `nwr["leisure"="nature_reserve"](${box});`,
    `nwr["protect_class"](${box});`,
    `nwr["natural"~"^(reef|shoal|bank)$"](${box});`,
    `nwr["seamark:type"~"^(reef|shoal|bank|restricted_area|caution_area|anchoring_prohibited|no_anchoring|firing_danger_area)$"](${box});`,
    `nwr["military"~"^(danger_area|training_area|naval_base|test_range|range)$"](${box});`,
    `nwr["landuse"="military"](${box});`,
    ');out geom tags;',
  ].join('');
}

export function buildOverpassQuery([south, west, north, east]: Bounds): string {
  const box = `${south},${west},${north},${east}`;
  return [
    '[out:json][timeout:60];',
    '(',
    `node["seamark:type"](${box});`,
    // Reporting/communication areas are normally polygons, not point aids.
    `way["seamark:type"="communication_area"](${box});`,
    `relation["seamark:type"="communication_area"](${box});`,
    // Calling-in points are lines, so they are fetched separately with geometry
    // instead of collapsing to a centre point like the other ways.
    `way["seamark:type"](${box})["seamark:type"!="calling-in_point"];`,
    `node["man_made"="lighthouse"](${box});`,
    `node["seamark:light:character"](${box});`,
    ');',
    'out center tags;',
    `way["seamark:type"="calling-in_point"](${box});`,
    'out geom;',
    `way["seamark:type"="communication_area"](${box});`,
    `relation["seamark:type"="communication_area"](${box});`,
    'out geom;',
  ].join('');
}

function parseBounds(value: string | null): Bounds | null {
  if (!value) return null;
  const parts = value.split(',').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return null;
  const [south, west, north, east] = parts;
  if (south >= north || west >= east) return null;
  if (north - south > 6 || east - west > 6) return null;
  return [south, west, north, east];
}

async function fetchMirror(mirror: string, query: string): Promise<CacheEntry> {
  const response = await fetch(mirror, {
    method: 'POST',
    headers: {
      'User-Agent': 'wheel-over/1.0 (offline chart cache)',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ data: query }),
    signal: AbortSignal.timeout(50_000),
  });
  if (!response.ok) throw new Error(`${mirror} HTTP ${response.status}`);
  const payload = (await response.json()) as { elements?: unknown[] };
  if (!Array.isArray(payload.elements)) throw new Error(`${mirror} returned no elements`);
  return { fetchedAt: Date.now(), source: mirror, sourceTimestamp: replySourceTimestamp(payload), payload };
}

/**
 * Race the mirrors, staggering starts so the fastest current one wins. A reply
 * from a lagging mirror is held back as a fallback and the race continues, so
 * the newest data available wins instead of the quickest answer.
 */
function raceMirrors(query: string): Promise<CacheEntry> {
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    let started = 0;
    let finished = 0;
    let nextIndex = 0;
    let lagging: CacheEntry | null = null;

    const finish = (entry: CacheEntry | null) => {
      if (settled) return;
      settled = true;
      if (entry) resolvePromise(entry);
      else reject(new Error('all Overpass mirrors failed'));
    };

    const launch = () => {
      if (settled || nextIndex >= MIRRORS.length) return;
      const mirror = MIRRORS[nextIndex];
      nextIndex += 1;
      started += 1;
      fetchMirror(mirror, query)
        .then((entry) => {
          finished += 1;
          if (settled) return;
          if (mirrorDataIsCurrent(entry.sourceTimestamp ?? null)) {
            finish(entry);
            return;
          }
          if (!lagging || (entry.sourceTimestamp ?? 0) > (lagging.sourceTimestamp ?? 0)) lagging = entry;
          if (finished >= MIRRORS.length) finish(lagging);
        })
        .catch(() => {
          finished += 1;
          if (!settled && finished >= started && nextIndex >= MIRRORS.length) finish(lagging);
        });
    };

    launch();
    setTimeout(launch, 1500).unref?.();
    setTimeout(launch, 4500).unref?.();
  });
}

function cachePath(key: string) {
  return resolve(CACHE_DIR, `${key}.json`);
}

async function readCache(key: string): Promise<CacheEntry | null> {
  try {
    const raw = await readFile(cachePath(key), 'utf8');
    const parsed = JSON.parse(raw) as CacheEntry;
    if (typeof parsed?.fetchedAt !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeCache(key: string, entry: CacheEntry) {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(cachePath(key), JSON.stringify(entry));
  } catch {
    // Cache write failures must never fail a chart query.
  }
}

async function writeChartFeatureStats(entry: CacheEntry) {
  try {
    const elements = Array.isArray((entry.payload as { elements?: unknown[] }).elements)
      ? (entry.payload as { elements: RawChartElement[] }).elements
      : [];
    // Count with the chart's own selection rules, so the disclaimer line
    // describes what was drawn rather than every object the reply mentioned.
    const { bridges, areas } = chartFeaturesFromElements(elements);
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(
      CHART_FEATURE_STATS_FILE,
      JSON.stringify({
        fetchedAt: entry.fetchedAt,
        sourceTimestamp: entry.sourceTimestamp ?? null,
        objects: elements.length,
        bridges: bridges.length,
        areas: areas.length,
        behind: !mirrorDataIsCurrent(entry.sourceTimestamp ?? null, entry.fetchedAt),
      }),
    );
  } catch {
    // The disclaimer line is optional; a stats write must never fail a query.
  }
}

function refresh(key: string, query: string, kind: QueryKind) {
  if (inflight.has(key)) return inflight.get(key)!;
  const promise = raceMirrors(query)
    .then(async (entry) => {
      await writeCache(key, entry);
      // Counting the drawn features is the chart's own work, not the reply's, so
      // it must not delay the answer: a large view would otherwise wait on it.
      if (kind === 'chart-features') void writeChartFeatureStats(entry);
      return entry;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

function sendJson(req: IncomingMessage, res: ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body);
  const acceptsGzip = String(req.headers['accept-encoding'] ?? '').includes('gzip');
  const payload = acceptsGzip ? gzipSync(json) : Buffer.from(json);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (acceptsGzip) res.setHeader('Content-Encoding', 'gzip');
  res.end(payload);
}

export function createOverpassHandler(log: (message: string) => void = () => {}) {
  return async function overpassHandler(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    // The disclaimer page asks what the live bridge/area overlay last fetched.
    if (url.searchParams.get('stats') === 'chart-features') {
      const raw = await readFile(CHART_FEATURE_STATS_FILE, 'utf8').catch(() => null);
      sendJson(req, res, 200, summarizeChartFeatureStats(raw) ?? { available: false });
      return;
    }
    const bounds = parseBounds(url.searchParams.get('bbox'));
    if (!bounds) {
      sendJson(req, res, 400, { error: 'bbox=south,west,north,east is required (max 6° per side)' });
      return;
    }

    const requestedKind = url.searchParams.get('kind');
    const kind: QueryKind = requestedKind === 'pois' || requestedKind === 'chart-features' ? requestedKind : 'navaids';
    // Use a new cache namespace after changing chart-feature semantics so old
    // generic road-bridge results cannot linger as if they were water crossings.
    const cacheKind = kind === 'chart-features' ? 'chart-features-tidal-v5' : kind;
    const key = createHash('sha1')
      .update(`${cacheKind}:${bounds.map((v) => v.toFixed(3)).join(',')}`)
      .digest('hex')
      .slice(0, 16);
    const query = kind === 'pois'
      ? buildPoiQuery(bounds)
      : kind === 'chart-features' ? buildChartFeatureQuery(bounds) : buildOverpassQuery(bounds);
    const cached = await readCache(key);
    const age = cached ? Date.now() - cached.fetchedAt : Infinity;
    // An entry fetched from a lagging mirror is still old data: keep serving it,
    // but refresh instead of treating it as the six-hour-fresh answer.
    const cachedCurrent = cached ? mirrorDataIsCurrent(replySourceTimestamp(cached.payload)) : false;

    if (cached && age < FRESH_MS && cachedCurrent) {
      // The disclaimer page describes the reply this chart view is being served,
      // whether it came from a mirror just now or from the on-disk cache.
      if (kind === 'chart-features') void writeChartFeatureStats(cached);
      sendJson(req, res, 200, { ...(cached.payload as object), meta: { cached: true, ageMs: age, source: cached.source } });
      return;
    }

    if (cached && age < STALE_MS) {
      // Serve stale immediately, refresh quietly.
      refresh(key, query, kind).catch((error) => log(`overpass refresh failed: ${error.message}`));
      if (kind === 'chart-features') void writeChartFeatureStats(cached);
      sendJson(req, res, 200, {
        ...(cached.payload as object),
        meta: { cached: true, stale: true, ageMs: age, source: cached.source },
      });
      return;
    }

    try {
      const entry = await refresh(key, query, kind);
      sendJson(req, res, 200, {
        ...(entry.payload as object),
        meta: { cached: false, ageMs: 0, source: entry.source },
      });
    } catch (error) {
      if (cached) {
        if (kind === 'chart-features') void writeChartFeatureStats(cached);
        sendJson(req, res, 200, {
          ...(cached.payload as object),
          meta: { cached: true, stale: true, ageMs: age, source: cached.source },
        });
        return;
      }
      sendJson(req, res, 502, { error: error instanceof Error ? error.message : 'overpass unavailable' });
    }
  };
}
