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
import { chartFeaturesFromElements, type ChartFeature, type RawChartElement } from '../src/lib/overpass';

const MIRRORS = [
  'https://overpass.openstreetmap.fr/api/interpreter',
  // Mail.ru's mirror has been the dependable one when the busy mirrors refuse or
  // time out, which is exactly when a bridge or area overlay went missing.
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

/**
 * Start delays for the mirrors above, so the fastest one wins without a burst.
 *
 * The stagger used to reach 7 s, so when the first mirror refused the proxy sat
 * on a question it could already have asked elsewhere: on a cold cell the bridge
 * and area overlays took 15 s or more, and most of that was waiting to hedge. A
 * short stagger still keeps the first healthy mirror first without a burst.
 */
const MIRROR_START_DELAYS_MS = [0, 500, 1200, 2200];

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

/**
 * Bridge and marine-area counts for one part of one chart view.
 *
 * The overlay is fetched in two halves, so the file holds a record per half for
 * the same cell rather than one number that the other half's arrival would
 * overwrite.
 */
interface PartStats {
  fetchedAt: number;
  sourceTimestamp: number | null;
  objects: number;
  /** Features this part drew: bridges for the bridge half, areas for the area half. */
  count: number;
  /** Split counts, only written when both halves arrived in a single reply. */
  bridges?: number;
  areas?: number;
  behind: boolean;
}

interface StoredStats {
  cell: string;
  parts: Record<string, PartStats>;
}

function statsFromParts(stored: StoredStats): ChartFeatureStats | null {
  const entries = Object.entries(stored.parts ?? {}).filter(([, part]) => part && Number.isFinite(part.fetchedAt));
  if (entries.length === 0) return null;
  const objects = entries.reduce((sum, [, part]) => sum + (Number.isFinite(part.objects) ? part.objects : 0), 0);
  if (objects <= 0) return null;
  const bridges = entries.reduce((sum, [name, part]) =>
    sum + (name === 'bridges' ? part.count ?? 0 : part.bridges ?? 0), 0);
  const areas = entries.reduce((sum, [name, part]) =>
    sum + (name === 'areas' ? part.count ?? 0 : part.areas ?? 0), 0);
  const timestamps = entries
    .map(([, part]) => part.sourceTimestamp)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
  return {
    fetchedAt: Math.max(...entries.map(([, part]) => part.fetchedAt)),
    // The oldest half is the oldest data the chart is showing, so it dates the view.
    sourceTimestamp: timestamps.length > 0 ? Math.min(...timestamps) : null,
    objects,
    bridges,
    areas,
    behind: entries.some(([, part]) => part.behind === true),
  };
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
  const record = parsed as Partial<ChartFeatureStats> & Partial<StoredStats> | null;
  if (!record || typeof record !== 'object') return null;
  if (record.parts && typeof record.parts === 'object') {
    return statsFromParts(record as StoredStats);
  }
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
  /**
   * Features drawn from the payload, computed once when the entry is written.
   * The water-crossing geometry math on a large reply takes seconds, so a
   * cache hit must not redo it: without this, a "warm" bridges reply still
   * took over twenty seconds while it recomputed what it already knew.
   */
  features?: { bridges: ChartFeature[]; areas: ChartFeature[] };
}

const inflight = new Map<string, Promise<CacheEntry>>();

/**
 * Which half of the bridge/area overlay a request is for.
 *
 * `all` is the single combined query, kept for a caller that does not name a
 * half; the chart itself asks for each half separately so the smaller query is
 * not held behind the slower one.
 */
export type ChartFeaturePart = 'bridges' | 'areas' | 'all';

/**
 * Bridge-and-water half of the chart-feature query.
 *
 * The overlay used to ask for bridges, water and marine areas in one request, so
 * it waited for the slowest category: the combined query measured about twice as
 * long as either half on the same mirror (7.8 s against 3.3–3.9 s), and bridges
 * did not draw until the protected-area shapes had arrived too. Each half is now
 * its own request, cached and raced on its own.
 */
export function buildChartBridgeQuery(bounds: Bounds): string {
  return buildChartQuery(BRIDGE_SELECTORS, bounds);
}

/** Marine-area half: designations that restrict a boat or matter to marine life. */
export function buildChartAreaQuery(bounds: Bounds): string {
  return buildChartQuery(AREA_SELECTORS, bounds);
}

/** Both halves in one query, for a caller that does not ask for a part. */
export function buildChartFeatureQuery(bounds: Bounds): string {
  return buildChartQuery([...BRIDGE_SELECTORS, ...AREA_SELECTORS], bounds);
}

function buildChartQuery(selectors: ((box: string) => string)[], [south, west, north, east]: Bounds): string {
  const box = `${south},${west},${north},${east}`;
  return [
    '[out:json][timeout:60];(',
    ...selectors.map((selector) => selector(box)),
    // `out geom tags` drops member geometry on relations in current Overpass,
    // which silently emptied every relation-mapped bay, strait and harbour — and
    // with them every bridge that crosses one. `out body geom` keeps it.
    ');out body geom;',
  ].join('');
}

const BRIDGE_SELECTORS: ((box: string) => string)[] = [
  (box) => `nwr["seamark:type"="bridge"](${box});`,
  (box) => `nwr["bridge"]["bridge"!="no"](${box});`,
  (box) => `nwr["man_made"="bridge"](${box});`,
  // Water the tide reaches. Most of it is not tagged tidal at all: a sea,
  // estuary, harbour basin or dock is mapped by what it is, so the water
  // classes are one scan over three keys rather than four separate scans over
  // `water`, `natural` and `waterway`. On a Solent-sized view the separate
  // scans took 8.1 s and the consolidated one 6.4 s for the same answer.
  // River reaches are included for the same reason: most tidal rivers are not
  // tagged tidal at all — the Itchen, the Gorge and hundreds like them are a
  // plain `water=river` or a river centreline — and whether such a reach is
  // tidal is decided from its position against water already known to be tidal
  // (see overpass.ts), so these are fetched as candidates, not as tidal water.
  (box) =>
    'nwr[~"^(water|waterway|natural)$"' +
    '~"^(sea|tidal|estuary|lagoon|harbour|harbor|dock|basin|cove|bay|river|riverbank|tidal_channel|fjord|strait)$"]' +
    `(${box});`,
  // `[~"…"]` with no value regex is rejected by current Overpass, so the key
  // regex is given one; `tidal` and `tidal:range` are still one scan.
  (box) => `nwr[~"^(tidal|tidal:range)$"~"."](${box});`,
  (box) => `nwr["harbour"](${box});`,
  (box) => `nwr["seamark:type"~"^(harbour|harbour_basin|bay|estuary|dock|sea_area)$"](${box});`,
];

const AREA_SELECTORS: ((box: string) => string)[] = [
  (box) => `nwr["boundary"~"^(protected_area|national_park)$"](${box});`,
  (box) => `nwr["leisure"="nature_reserve"](${box});`,
  (box) => `nwr["protect_class"](${box});`,
  (box) => `nwr["natural"~"^(reef|shoal|bank)$"](${box});`,
  (box) => `nwr["seamark:type"~"^(reef|shoal|bank|restricted_area|caution_area|anchoring_prohibited|no_anchoring|firing_danger_area)$"](${box});`,
  (box) => `nwr["military"~"^(danger_area|training_area|naval_base|test_range|range)$"](${box});`,
  (box) => `nwr["landuse"="military"](${box});`,
];


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

/**
 * Cell size the live bridge/area overlay is fetched in.
 *
 * A chart view changes with every small pan, and each one used to be its own
 * Overpass query, so a navigator panning across a harbour asked repeatedly and
 * saw nothing until one answered. Rounding the request out to a fixed cell lets
 * nearby views (and other devices over the same water) share one answer; the
 * rounding is outward, so no cell ever omits part of the requested view.
 */
export const CHART_FEATURE_CELL_DEGREES = 0.05;

/** The cell that fully contains the requested view. */
export function snapChartFeatureBounds([south, west, north, east]: Bounds): Bounds {
  const step = CHART_FEATURE_CELL_DEGREES;
  const down = (value: number) => Math.round(Math.floor(value / step) * step * 1000) / 1000;
  const up = (value: number) => Math.round(Math.ceil(value / step) * step * 1000) / 1000;
  return [down(south), down(west), up(north), up(east)];
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
 * How long a usable but lagging reply is held back while a current one is
 * awaited.
 *
 * Mirrors are frequently days or months behind, and a mirror that has already
 * answered with an older copy is still chart data. Without this bound the race
 * waited for every other mirror to fail — up to the 50 s request timeout — so a
 * bridge overlay could take a minute to draw or never arrive at all. Eight
 * seconds is longer than a responsive mirror takes and far shorter than a
 * navigator's patience.
 *
 * The bridge/area overlay uses its own, much shorter grace: it is fetched per
 * chart cell on a first visit to an area, and a mirror that is a few months
 * behind still answers bridges correctly. Holding that reply for the full eight
 * seconds was the difference between an overlay that draws and one that appears
 * to be missing.
 */
export const LAGGING_GRACE_MS = 8000;
export const CHART_FEATURE_GRACE_MS = 2000;

/**
 * Race the mirrors, staggering starts so the fastest current one wins. A reply
 * from a lagging mirror is held back as a fallback and the race continues, so
 * the newest data available wins instead of the quickest answer — but only for
 * `graceMs`, after which the best reply in hand is served.
 */
function raceMirrors(query: string, graceMs = LAGGING_GRACE_MS): Promise<CacheEntry> {
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    let started = 0;
    let finished = 0;
    let nextIndex = 0;
    let lagging: CacheEntry | null = null;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = (entry: CacheEntry | null) => {
      if (settled) return;
      settled = true;
      if (graceTimer) clearTimeout(graceTimer);
      if (entry) resolvePromise(entry);
      else reject(new Error('all Overpass mirrors failed'));
    };

    graceTimer = setTimeout(() => {
      if (lagging) finish(lagging);
    }, graceMs);
    graceTimer.unref?.();

    const raceStarted = Date.now();

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
          // A lagging reply that arrived after the grace period is served now
          // rather than waiting on mirrors that may never answer.
          if (Date.now() - raceStarted >= graceMs) finish(lagging);
        })
        .catch(() => {
          finished += 1;
          if (!settled && finished >= started && nextIndex >= MIRRORS.length) finish(lagging);
        });
    };

    launch();
    for (const delay of MIRROR_START_DELAYS_MS.slice(1)) setTimeout(launch, delay).unref?.();
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

async function writeChartFeatureStats(entry: CacheEntry, part: ChartFeaturePart, cell: string) {
  try {
    const elements = Array.isArray((entry.payload as { elements?: unknown[] }).elements)
      ? (entry.payload as { elements: RawChartElement[] }).elements
      : [];
    // Count with the chart's own selection rules, so the disclaimer line
    // describes what was drawn rather than every object the reply mentioned.
    const drawn = entry.features ?? chartFeaturesFromElements(elements);
    const previous = await readFile(CHART_FEATURE_STATS_FILE, 'utf8').catch(() => null);
    let stored: StoredStats = { cell, parts: {} };
    try {
      const parsed = JSON.parse(previous ?? 'null') as StoredStats | null;
      // A new chart view starts a new description; halves of the same view merge.
      if (parsed && parsed.cell === cell && parsed.parts) stored = parsed;
    } catch {
      // An unreadable file is replaced, not preserved.
    }
    stored.parts[part] = part === 'all'
      ? {
        fetchedAt: entry.fetchedAt,
        sourceTimestamp: entry.sourceTimestamp ?? null,
        objects: elements.length,
        count: drawn.bridges.length,
        bridges: drawn.bridges.length,
        areas: drawn.areas.length,
        behind: !mirrorDataIsCurrent(entry.sourceTimestamp ?? null, entry.fetchedAt),
      }
      : {
        fetchedAt: entry.fetchedAt,
        sourceTimestamp: entry.sourceTimestamp ?? null,
        objects: elements.length,
        count: part === 'bridges' ? drawn.bridges.length : drawn.areas.length,
        behind: !mirrorDataIsCurrent(entry.sourceTimestamp ?? null, entry.fetchedAt),
      };
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(CHART_FEATURE_STATS_FILE, JSON.stringify(stored));
  } catch {
    // The disclaimer line is optional; a stats write must never fail a query.
  }
}

function refresh(key: string, query: string, kind: QueryKind, part: ChartFeaturePart = 'all', cell = '') {
  const running = inflight.get(key);
  if (running) return running;
  const promise = raceMirrors(
    query,
    kind === 'chart-features' ? CHART_FEATURE_GRACE_MS : LAGGING_GRACE_MS,
  )
    .then(async (entry) => {
      if (kind === 'chart-features') {
        const elements = (entry.payload as { elements?: unknown[] } | null)?.elements;
        if (Array.isArray(elements)) {
          entry.features = chartFeaturesFromElements(elements as RawChartElement[]);
        }
      }
      await writeCache(key, entry);
      // Counting the drawn features is the chart's own work, not the reply's, so
      // it must not delay the answer: a large view would otherwise wait on it.
      if (kind === 'chart-features') void writeChartFeatureStats(entry, part, cell);
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

/**
 * What a chart-features reply sends to the chart.
 *
 * The raw mirror reply is mostly water geometry the chart only uses to test
 * which bridges cross water; the drawn bridges and areas are a small fraction
 * of it. Sending the drawn features instead of the raw elements cuts the
 * transfer and the chart's own water processing, which was a large share of
 * the wait on a cold cell. Other query kinds still send the raw reply.
 *
 * The drawn features are computed once when the entry is written and served
 * from the entry afterwards. An entry written before that change has no
 * features field: it is computed on first re-read and written back, so only
 * that one request pays the geometry math.
 */
function responseBody(entry: CacheEntry, key: string, meta: Record<string, unknown>, kind: QueryKind): unknown {
  if (kind !== 'chart-features') return { ...(entry.payload as object), meta };
  if (entry.features) {
    return { features: [...entry.features.areas, ...entry.features.bridges], meta };
  }
  const elements = (entry.payload as { elements?: unknown[] } | null)?.elements;
  if (!Array.isArray(elements)) return { ...(entry.payload as object), meta };
  const features = chartFeaturesFromElements(elements as RawChartElement[]);
  void writeCache(key, { ...entry, features });
  return { features: [...features.areas, ...features.bridges], meta };
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
    const requestedPart = url.searchParams.get('part');
    const part: ChartFeaturePart =
      requestedPart === 'bridges' || requestedPart === 'areas' ? requestedPart : 'all';
    // Bridges and areas are fetched in fixed cells so panning reuses one answer.
    const queryBounds = kind === 'chart-features' ? snapChartFeatureBounds(bounds) : bounds;
    const cell = queryBounds.map((v) => v.toFixed(3)).join(',');
    // Use a new cache namespace after changing chart-feature semantics so old
    // generic road-bridge results cannot linger as if they were water crossings.
    const cacheKind = kind === 'chart-features' ? `chart-features-cell-v9-${part}` : kind;
    const key = createHash('sha1')
      .update(`${cacheKind}:${cell}`)
      .digest('hex')
      .slice(0, 16);
    const query = kind === 'pois'
      ? buildPoiQuery(bounds)
      : kind === 'chart-features'
        ? part === 'bridges'
          ? buildChartBridgeQuery(queryBounds)
          : part === 'areas'
            ? buildChartAreaQuery(queryBounds)
            : buildChartFeatureQuery(queryBounds)
        : buildOverpassQuery(bounds);
    const cached = await readCache(key);
    const age = cached ? Date.now() - cached.fetchedAt : Infinity;
    // An entry fetched from a lagging mirror is still old data: keep serving it,
    // but refresh instead of treating it as the six-hour-fresh answer.
    const cachedCurrent = cached ? mirrorDataIsCurrent(replySourceTimestamp(cached.payload)) : false;

    if (cached && age < FRESH_MS && cachedCurrent) {
      // The disclaimer page describes the reply this chart view is being served,
      // whether it came from a mirror just now or from the on-disk cache.
      if (kind === 'chart-features') void writeChartFeatureStats(cached, part, cell);
      sendJson(req, res, 200, responseBody(cached, key, { cached: true, ageMs: age, source: cached.source }, kind));
      return;
    }

    if (cached && age < STALE_MS) {
      // Serve stale immediately, refresh quietly.
      refresh(key, query, kind, part, cell).catch((error) => log(`overpass refresh failed: ${error.message}`));
      if (kind === 'chart-features') void writeChartFeatureStats(cached, part, cell);
      sendJson(req, res, 200, responseBody(cached, key, { cached: true, stale: true, ageMs: age, source: cached.source }, kind));
      return;
    }

    try {
      const entry = await refresh(key, query, kind, part, cell);
      sendJson(req, res, 200, responseBody(entry, key, { cached: false, ageMs: 0, source: entry.source }, kind));
    } catch (error) {
      if (cached) {
        if (kind === 'chart-features') void writeChartFeatureStats(cached, part, cell);
        sendJson(req, res, 200, responseBody(cached, key, { cached: true, stale: true, ageMs: age, source: cached.source }, kind));
        return;
      }
      sendJson(req, res, 502, { error: error instanceof Error ? error.message : 'overpass unavailable' });
    }
  };
}
