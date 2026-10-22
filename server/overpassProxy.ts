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

const MIRRORS = [
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const CACHE_DIR = resolve(process.cwd(), '.marnav-cache/overpass');
const FRESH_MS = 6 * 60 * 60 * 1000;
const STALE_MS = 30 * 24 * 60 * 60 * 1000;

type Bounds = [number, number, number, number];
type QueryKind = 'navaids' | 'pois';

const buildPoiQuery = RAW_BUILD_POI_QUERY as (bounds: Bounds) => string;

interface CacheEntry {
  fetchedAt: number;
  source: string;
  payload: unknown;
}

const inflight = new Map<string, Promise<CacheEntry>>();

export function buildOverpassQuery([south, west, north, east]: Bounds): string {
  const box = `${south},${west},${north},${east}`;
  return [
    '[out:json][timeout:60];',
    '(',
    `node["seamark:type"](${box});`,
    // Calling-in points are lines, so they are fetched separately with geometry
    // instead of collapsing to a centre point like the other ways.
    `way["seamark:type"](${box})["seamark:type"!="calling-in_point"];`,
    `node["man_made"="lighthouse"](${box});`,
    `node["seamark:light:character"](${box});`,
    ');',
    'out center tags;',
    `way["seamark:type"="calling-in_point"](${box});`,
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
  return { fetchedAt: Date.now(), source: mirror, payload };
}

/** Race the mirrors, staggering starts so the fastest healthy one wins. */
function raceMirrors(query: string): Promise<CacheEntry> {
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    let started = 0;
    let failures = 0;
    let nextIndex = 0;

    const launch = () => {
      if (settled || nextIndex >= MIRRORS.length) return;
      const mirror = MIRRORS[nextIndex];
      nextIndex += 1;
      started += 1;
      fetchMirror(mirror, query)
        .then((entry) => {
          if (settled) return;
          settled = true;
          resolvePromise(entry);
        })
        .catch(() => {
          failures += 1;
          if (!settled && failures >= started && nextIndex >= MIRRORS.length) {
            settled = true;
            reject(new Error('all Overpass mirrors failed'));
          }
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

function refresh(key: string, query: string) {
  if (inflight.has(key)) return inflight.get(key)!;
  const promise = raceMirrors(query)
    .then(async (entry) => {
      await writeCache(key, entry);
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
    const bounds = parseBounds(url.searchParams.get('bbox'));
    if (!bounds) {
      sendJson(req, res, 400, { error: 'bbox=south,west,north,east is required (max 6° per side)' });
      return;
    }

    const kind: QueryKind = url.searchParams.get('kind') === 'pois' ? 'pois' : 'navaids';
    const key = createHash('sha1')
      .update(`${kind}:${bounds.map((v) => v.toFixed(3)).join(',')}`)
      .digest('hex')
      .slice(0, 16);
    const query = kind === 'pois' ? buildPoiQuery(bounds) : buildOverpassQuery(bounds);
    const cached = await readCache(key);
    const age = cached ? Date.now() - cached.fetchedAt : Infinity;

    if (cached && age < FRESH_MS) {
      sendJson(req, res, 200, { ...(cached.payload as object), meta: { cached: true, ageMs: age, source: cached.source } });
      return;
    }

    if (cached && age < STALE_MS) {
      // Serve stale immediately, refresh quietly.
      refresh(key, query).catch((error) => log(`overpass refresh failed: ${error.message}`));
      sendJson(req, res, 200, {
        ...(cached.payload as object),
        meta: { cached: true, stale: true, ageMs: age, source: cached.source },
      });
      return;
    }

    try {
      const entry = await refresh(key, query);
      sendJson(req, res, 200, {
        ...(entry.payload as object),
        meta: { cached: false, ageMs: 0, source: entry.source },
      });
    } catch (error) {
      if (cached) {
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
