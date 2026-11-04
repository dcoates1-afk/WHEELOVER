import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Same-host relay for U.S. Coast Guard Local Notices to Mariners (LNMs).
 *
 * NAVCEN publishes the current LNM items as plain static GeoJSON files —
 * no API key, no query parameters, no per-request filtering. The relay
 * discovers the file list from the MSI app page itself (falling back to a
 * hardcoded list when the page cannot be read), fetches the files in
 * parallel, normalizes each feature, and serves only the features whose
 * geometry overlaps the client's requested bounding box. The browser
 * cannot fetch NAVCEN directly (no CORS headers), and earlier direct
 * probes were refused, so the relay sends a browser-like User-Agent and
 * Referer, the same approach the NGA warnings relay uses.
 *
 * The files are the current set by definition (NAVCEN refreshes LNM data
 * every 15 minutes), so no date filtering is applied here; the 15-minute
 * relay cache matches that refresh rhythm.
 */

const MSI_PAGE_URL = 'https://navcen.uscg.gov/msi';
const MSI_FILE_BASE = 'https://navcen.uscg.gov/sites/default/files/msi';
const CACHE_TTL_MS = 15 * 60 * 1000;
const FILE_TIMEOUT_MS = 30_000;
const FILE_CONCURRENCY = 8;
const MAX_FEATURES = 2000;
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36';

/** LNM files known on 2026-11-03; the live page scrape supersedes this. */
const FALLBACK_FILES = [
  'autoVesselLine_1.geojson',
  'autoVesselPoint_1.geojson',
  'autoVesselPoly_1.geojson',
  'bridgeLine_1.geojson',
  'bridgePoly_1.geojson',
  'bridge_1.geojson',
  'buoys_1.geojson',
  'buoys_2.geojson',
  'buoys_3.geojson',
  'buoys_4.geojson',
  'buoys_5.geojson',
  'buoys_6.geojson',
  'buoys_7.geojson',
  'buoys_8.geojson',
  'buoys_9.geojson',
  'buoys_10.geojson',
  'buoys_11.geojson',
  'buoys_12.geojson',
  'changeAdvNot_1.geojson',
  'changeProp_1.geojson',
  'change_1.geojson',
  'discFedAidCor_1.geojson',
  'discFedAid_1.geojson',
  'discFedAid_2.geojson',
  'discFedAid_3.geojson',
  'discPriAidCor_1.geojson',
  'discPriAid_1.geojson',
  'discPriAid_2.geojson',
  'discPriAid_3.geojson',
  'hazNavLine_1.geojson',
  'hazNavPoly_1.geojson',
  'hazNav_1.geojson',
  'marConLine_1.geojson',
  'marConPoly_1.geojson',
  'marConPoly_2.geojson',
  'marCon_1.geojson',
  'marEventLine_1.geojson',
  'marEventPoly_1.geojson',
  'marEvent_1.geojson',
  'miscLine_1.geojson',
  'miscPoly_1.geojson',
  'misc_1.geojson',
  'msibLine_1.geojson',
  'msibPoly_1.geojson',
  'msib_1.geojson',
  'navalActLine_1.geojson',
  'navalActPoly_1.geojson',
  'navalAct_1.geojson',
  'safeZoneLine_1.geojson',
  'safeZonePoly_1.geojson',
  'safeZone_1.geojson',
  'spaceOpsPoly_1.geojson',
  'tessAdvLine_1.geojson',
  'tessAdvPoly_1.geojson',
  'tessAdv_1.geojson',
  'tmpChangeCor_1.geojson',
  'tmpChange_1.geojson',
];

/** Display labels, following NAVCEN's own download-tab expansions. */
const CATEGORY_LABELS: Record<string, string> = {
  autoVessel: 'Autonomous Vessel Operations',
  bridge: 'Bridges',
  buoys: 'Buoys',
  changeAdvNot: 'Advance Notice of Change',
  changeProp: 'Proposed Notice of Change',
  change: 'Changes',
  discFedAidCor: 'Discrepant Federal Aids Corrected',
  discFedAid: 'Discrepant Federal Aids',
  discPriAidCor: 'Discrepant Private Aids Corrected',
  discPriAid: 'Discrepant Private Aids',
  hazNav: 'Hazards to Navigation',
  marCon: 'Marine Construction',
  marEvent: 'Marine Events',
  misc: 'Miscellaneous',
  msib: 'Marine Safety Information Bulletin',
  navalAct: 'Naval Activity',
  safeZone: 'Safety Zones',
  spaceOps: 'Space Operations',
  tessAdv: 'TESS Advisory',
  tmpChangeCor: 'Temporary Changes Corrected',
  tmpChange: 'Temporary Changes',
};

/** File base without the chunk suffix and geometry suffix, e.g. bridgeLine_1 -> bridge. */
export function lnmFileBase(filename: string): string {
  return filename
    .replace(/\.geojson$/i, '')
    .replace(/_\d+$/, '')
    .replace(/(Line|Point|Poly)$/, '');
}

export function lnmCategoryLabel(filename: string): string {
  const base = lnmFileBase(filename);
  return CATEGORY_LABELS[base] ?? base;
}

/**
 * Filenames published on the MSI page, Light List files excluded. The page
 * lists every file the app itself loads, so this keeps the relay current
 * when NAVCEN adds a chunk; it never trusts a filename it did not see.
 */
export function extractLnmFilenames(html: string): string[] {
  const found = new Set<string>();
  const pattern = /\/sites\/default\/files\/msi\/([A-Za-z0-9_-]+\.geojson)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const name = match[1];
    if (!name.startsWith('lightList')) found.add(name);
  }
  return [...found].sort();
}

type LnmGeometry =
  | { type: string; coordinates?: unknown; geometries?: LnmGeometry[] }
  | null
  | undefined;

export interface LnmFeature {
  id: string;
  category: string;
  categoryLabel: string;
  title: string;
  waterway: string | null;
  subCategory: string | null;
  beginMs: number | null;
  endMs: number | null;
  description: string;
  geometry: { type: string; coordinates?: unknown; geometries?: LnmGeometry[] };
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length > 0 ? text : null;
}

/** Bounding box of a GeoJSON geometry as [S, W, N, E], or null when empty. */
export function geometryBounds(geometry: LnmGeometry): [number, number, number, number] | null {
  if (!geometry) return null;
  if (geometry.type === 'GeometryCollection' && Array.isArray(geometry.geometries)) {
    let acc: [number, number, number, number] | null = null;
    for (const child of geometry.geometries) {
      const childBounds = geometryBounds(child);
      if (!childBounds) continue;
      acc = acc
        ? [
            Math.min(acc[0], childBounds[0]),
            Math.min(acc[1], childBounds[1]),
            Math.max(acc[2], childBounds[2]),
            Math.max(acc[3], childBounds[3]),
          ]
        : childBounds;
    }
    return acc;
  }
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  let seen = false;
  const walk = (node: unknown): void => {
    if (!Array.isArray(node)) return;
    if (
      node.length >= 2 &&
      typeof node[0] === 'number' &&
      typeof node[1] === 'number'
    ) {
      const lon = node[0];
      const lat = node[1];
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
      seen = true;
      south = Math.min(south, lat);
      west = Math.min(west, lon);
      north = Math.max(north, lat);
      east = Math.max(east, lon);
      return;
    }
    for (const child of node) walk(child);
  };
  walk(geometry.coordinates);
  return seen ? [south, west, north, east] : null;
}

function boundsOverlap(
  a: [number, number, number, number],
  b: [number, number, number, number],
): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function normalizeFeature(
  filename: string,
  raw: Record<string, unknown>,
  index: number,
): LnmFeature | null {
  const geometry = (raw.geometry ?? null) as LnmGeometry;
  if (!geometry || typeof geometry.type !== 'string') return null;
  if (geometryBounds(geometry) === null) return null;
  const properties = (raw.properties ?? {}) as Record<string, unknown>;
  const uid =
    cleanText(properties.MSI_UID) ??
    (finiteNumber(properties.ESRI_OID) !== null ? String(properties.ESRI_OID) : null) ??
    cleanText(raw.id) ??
    String(index);
  return {
    id: `${lnmFileBase(filename)}:${uid}`,
    category: lnmFileBase(filename),
    categoryLabel: lnmCategoryLabel(filename),
    title: cleanText(properties.TITLE) ?? 'Local notice',
    waterway: cleanText(properties.WATERWAY_NAME),
    subCategory: cleanText(properties.SUB_CATEGORY),
    beginMs: finiteNumber(properties.BEGIN_DATE),
    endMs: finiteNumber(properties.END_DATE),
    description: cleanText(properties.DESCRIPTION) ?? '',
    geometry: geometry as { type: string; coordinates?: unknown; geometries?: LnmGeometry[] },
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(json);
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Referer: MSI_PAGE_URL },
    signal: AbortSignal.timeout(FILE_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`NAVCEN HTTP ${response.status}`);
  return response.text();
}

async function fetchFileFeatures(filename: string): Promise<LnmFeature[]> {
  const response = await fetch(`${MSI_FILE_BASE}/${filename}`, {
    headers: { 'User-Agent': USER_AGENT, Referer: MSI_PAGE_URL },
    signal: AbortSignal.timeout(FILE_TIMEOUT_MS),
  });
  // A missing file means the category currently has no features: NAVCEN
  // only generates files for categories with data, so 404 is empty, not
  // an error. Other failures still land in meta.incomplete.
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`NAVCEN HTTP ${response.status}`);
  const payload = (await response.json()) as { features?: unknown };
  if (!Array.isArray(payload.features)) return [];
  const features: LnmFeature[] = [];
  payload.features.forEach((raw, index) => {
    if (raw && typeof raw === 'object') {
      const feature = normalizeFeature(filename, raw as Record<string, unknown>, index);
      if (feature) features.push(feature);
    }
  });
  return features;
}

interface LnmCache {
  at: number;
  features: LnmFeature[];
  files: number;
  incomplete: string[];
  fetchedAt: string;
}

export function createLnmHandler(log: (message: string) => void = () => {}) {
  let cached: LnmCache | null = null;
  let inflight: Promise<LnmCache> | null = null;

  async function refresh(): Promise<LnmCache> {
    if (inflight) return inflight;
    inflight = (async () => {
      let filenames: string[] = [];
      try {
        filenames = extractLnmFilenames(await fetchText(MSI_PAGE_URL));
      } catch (error) {
        log(`lnm proxy: MSI page unreadable, using fallback list (${error instanceof Error ? error.message : 'fetch failed'})`);
      }
      if (filenames.length === 0) filenames = [...FALLBACK_FILES];
      const incomplete: string[] = [];
      const features: LnmFeature[] = [];
      let nextIndex = 0;
      const workers = Array.from({ length: FILE_CONCURRENCY }, async () => {
        while (nextIndex < filenames.length) {
          const filename = filenames[nextIndex];
          nextIndex += 1;
          try {
            features.push(...(await fetchFileFeatures(filename)));
          } catch (error) {
            incomplete.push(filename);
            log(`lnm proxy: ${filename} failed (${error instanceof Error ? error.message : 'fetch failed'})`);
          }
        }
      });
      await Promise.all(workers);
      if (features.length === 0) throw new Error('no LNM files could be read');
      const entry: LnmCache = {
        at: Date.now(),
        features,
        files: filenames.length - incomplete.length,
        incomplete,
        fetchedAt: new Date().toISOString(),
      };
      cached = entry;
      return entry;
    })();
    try {
      return await inflight;
    } finally {
      inflight = null;
    }
  }

  return async function lnmHandler(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const parts = (url.searchParams.get('bbox') ?? '')
      .split(',')
      .map((part) => Number(part.trim()));
    if (
      parts.length !== 4 ||
      parts.some((part) => !Number.isFinite(part)) ||
      parts[0] > parts[2] ||
      parts[1] > parts[3]
    ) {
      sendJson(res, 400, { error: 'bbox query parameter required as S,W,N,E' });
      return;
    }
    const bbox = parts as [number, number, number, number];
    let entry = cached && Date.now() - cached.at < CACHE_TTL_MS ? cached : null;
    let stale = false;
    if (!entry) {
      try {
        entry = await refresh();
      } catch (error) {
        log(`lnm proxy: refresh failed (${error instanceof Error ? error.message : 'fetch failed'})`);
        if (cached) {
          entry = cached;
          stale = true;
        } else {
          sendJson(res, 502, { error: 'USCG local notices unavailable' });
          return;
        }
      }
    }
    const inView = entry.features.filter((feature) => {
      const bounds = geometryBounds(feature.geometry);
      return bounds !== null && boundsOverlap(bounds, bbox);
    });
    const truncated = inView.length > MAX_FEATURES;
    sendJson(res, 200, {
      features: truncated ? inView.slice(0, MAX_FEATURES) : inView,
      meta: {
        files: entry.files,
        total: inView.length,
        returned: truncated ? MAX_FEATURES : inView.length,
        truncated,
        incomplete: entry.incomplete,
        fetchedAt: entry.fetchedAt,
        stale,
        cached: entry === cached && Date.now() - entry.at < CACHE_TTL_MS,
      },
    });
  };
}
