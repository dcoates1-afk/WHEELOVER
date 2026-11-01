import type { Navaid } from './navaidTypes';

export type MarineLayer = 'navaids' | 'ferries' | 'bridges' | 'tss';
export type MarineBounds = [south: number, west: number, north: number, east: number];

export interface MarineFeature {
  id: string;
  type: string;
  name: string;
  bounds: MarineBounds;
  path: [number, number][];
  paths?: [number, number][][];
  polygons?: [number, number][][][];
  details?: Record<string, string>;
  sourceUrl?: string;
  sourceName?: string;
  navaid?: Navaid;
}

export type TssGeometryPart =
  | { kind: 'line'; coordinates: [number, number][] }
  | { kind: 'polygon'; coordinates: [number, number][][] };

export function tssGeometryParts(feature: MarineFeature): TssGeometryPart[] {
  const parts: TssGeometryPart[] = [
    ...(feature.polygons ?? [])
      .filter((rings) => rings.some((ring) => ring.length >= 4))
      .map((coordinates) => ({ kind: 'polygon' as const, coordinates })),
    ...(feature.paths ?? [])
      .filter((coordinates) => coordinates.length >= 2)
      .map((coordinates) => ({ kind: 'line' as const, coordinates })),
  ];
  if (parts.length || feature.path.length < 2) return parts;
  const first = feature.path[0];
  const last = feature.path.at(-1)!;
  const closed = feature.path.length >= 4 && first[0] === last[0] && first[1] === last[1];
  return closed
    ? [{ kind: 'polygon', coordinates: [feature.path] }]
    : [{ kind: 'line', coordinates: feature.path }];
}

export const TSS_SOURCE_ATTRIBUTION = 'TSS data © OpenStreetMap contributors (ODbL) and the credited regional data providers.';

const TSS_DETAIL_LABELS: Record<string, string> = {
  operator: 'Operator',
  source: 'OSM source note',
  ref: 'Reference',
  'seamark:separation_scheme:category': 'Scheme category',
  'seamark:separation_scheme:traffic_flow': 'Traffic flow',
  'seamark:separation_scheme:lane_count': 'Lane count',
  'seamark:separation_scheme:lane_width': 'Lane width',
  'seamark:separation_scheme:orientation': 'Orientation',
  'seamark:separation_scheme:category_of_separation': 'Separation type',
  'seamark:separation_boundary:category': 'Boundary',
  'seamark:separation_lane:traffic_flow': 'Lane traffic flow',
  'seamark:separation_lane:category': 'Lane category',
  'seamark:separation_zone:category': 'Zone category',
  'seamark:information': 'Information',
  source_name: 'Data source',
  source_class: 'Source class',
  source_date: 'Source date',
  valid_from: 'Valid from',
  valid_to: 'Valid to',
  information: 'Information',
  orientation: 'Orientation',
  traffic_flow: 'Traffic flow',
};

export function describeTssFeature(feature: MarineFeature): { title: string; type: string; details: Array<[string, string]>; sourceUrl: string | null; sourceName: string | null } {
  const details = Object.entries(feature.details ?? {})
    .filter(([key, value]) => key !== 'seamark:name' && key !== 'name' && typeof value === 'string' && value.trim())
    .map(([key, value]) => [TSS_DETAIL_LABELS[key] ?? key.replace(/^seamark:/, '').replace(/[:_]/g, ' '), value.trim()] as [string, string]);
  const osmId = feature.id.match(/(?:^|:)([nwr])(\d+)$/);
  const sourceUrl = feature.sourceUrl ?? (osmId
    ? `https://www.openstreetmap.org/${osmId[1] === 'r' ? 'relation' : osmId[1] === 'w' ? 'way' : 'node'}/${osmId[2]}`
    : null);
  return {
    title: feature.name,
    type: feature.type.replace(/_/g, ' '),
    details,
    sourceUrl,
    sourceName: feature.details?.source_name ?? (sourceUrl?.includes('openstreetmap.org') ? 'OpenStreetMap contributors (ODbL)' : null),
  };
}

export interface MarineShard {
  path: string;
  bounds: MarineBounds;
  count: number;
}

export interface MarineManifest {
  schema: 1;
  version: string;
  generatedAt: string;
  cellSize: number;
  layers: Record<Exclude<MarineLayer, 'bridges'>, { count: number; shards: MarineShard[] }> & {
    bridges?: { count: number; shards: MarineShard[] };
  };
}

const isBounds = (value: unknown): value is MarineBounds =>
  Array.isArray(value) && value.length === 4 && value.every((n) => typeof n === 'number' && Number.isFinite(n));

export function validateMarineManifest(value: unknown): MarineManifest | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Partial<MarineManifest>;
  if (input.schema !== 1 || typeof input.version !== 'string' || !input.layers) return null;
  const layers = {} as MarineManifest['layers'];
  for (const layer of ['navaids', 'ferries', 'tss', 'bridges'] as const) {
    const entry = input.layers[layer];
    if (layer === 'bridges' && entry === undefined) continue;
    if (!entry || !Array.isArray(entry.shards)) return null;
    const shards: MarineShard[] = [];
    for (const shard of entry.shards) {
      if (!shard || typeof shard.path !== 'string' || !isBounds(shard.bounds)) return null;
      shards.push({ path: shard.path, bounds: shard.bounds, count: Number(shard.count) || 0 });
    }
    if (layer === 'bridges') layers.bridges = { count: Number(entry.count) || 0, shards };
    else layers[layer] = { count: Number(entry.count) || 0, shards };
  }
  return {
    schema: 1,
    version: input.version,
    generatedAt: typeof input.generatedAt === 'string' ? input.generatedAt : new Date(0).toISOString(),
    cellSize: Number(input.cellSize) || 5,
    layers,
  };
}

export function marineBoundsIntersect(a: MarineBounds, b: MarineBounds): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

export function marineShardsForBounds(manifest: MarineManifest, layer: MarineLayer, bounds: MarineBounds): MarineShard[] {
  return (manifest.layers[layer]?.shards ?? []).filter((shard) => marineBoundsIntersect(shard.bounds, bounds));
}

export function marineDataUrl(path: string, configuredBase = import.meta.env.VITE_MARINE_DATA_URL): string {
  return configuredBase
    ? new URL(path, `${configuredBase.replace(/\/+$/, '')}/`).toString()
    : `/marine-db/${path}`;
}

/**
 * The manifest is the index for every shard, and it is over a megabyte. It only
 * changes when the archive is rebuilt, so it is read once per session instead of
 * on every pan: refetching it made each view wait for the index before any lane
 * or mark could be requested.
 */
const manifestCache = new Map<string, Promise<MarineManifest>>();

function manifestKey(baseUrl?: string): string {
  return baseUrl ?? '';
}

async function readManifest(baseUrl?: string): Promise<MarineManifest> {
  const key = manifestKey(baseUrl);
  const cached = manifestCache.get(key);
  if (cached) {
    try {
      return await cached;
    } catch {
      manifestCache.delete(key);
    }
  }
  const request = (async () => {
    const response = await fetch(marineDataUrl('manifest.json', baseUrl), { cache: 'no-store' });
    if (!response.ok) throw new Error(`Marine data manifest unavailable (HTTP ${response.status})`);
    const manifest = validateMarineManifest(await response.json());
    if (!manifest) throw new Error('Marine data manifest is invalid');
    return manifest;
  })();
  manifestCache.set(key, request);
  request.catch(() => manifestCache.delete(key));
  return request;
}

/** Test and reload hook: forget the cached index so the next call re-reads it. */
export function clearMarineManifestCache(): void {
  manifestCache.clear();
}

/**
 * How many shard requests a single view keeps in flight. A wide view can
 * intersect hundreds of cells, and firing them all at once starves the browser's
 * per-origin connection pool: the archive requests queue behind each other, the
 * slowest ones time out, and the view is left with gaps where lanes and marks
 * should be. A short queue keeps the same data with far fewer failures.
 */
export const SHARD_CONCURRENCY = 6;

/**
 * Run an async reader over every path with a bounded number in flight. A path
 * that fails is skipped: one unreadable cell leaves a gap, while rejecting the
 * batch used to discard every lane, mark or sector on screen because one request
 * out of a hundred timed out.
 */
export async function loadShardBatch<T>(
  paths: readonly string[],
  read: (path: string) => Promise<T | null>,
  options: { signal?: AbortSignal } = {},
): Promise<T[]> {
  const results: T[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= paths.length) return;
      if (options.signal?.aborted) return;
      const value = await read(paths[index]);
      if (value !== null) results.push(value);
    }
  };
  const workers = Array.from(
    { length: Math.min(SHARD_CONCURRENCY, paths.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

/**
 * One shard, with a single retry. A shard that still fails reads as empty rather
 * than failing the whole view.
 */
async function readShard(
  path: string,
  options: { signal?: AbortSignal; baseUrl?: string },
): Promise<MarineFeature[]> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(marineDataUrl(path, options.baseUrl), { signal: options.signal });
      if (!response.ok) throw new Error(`Marine data shard unavailable: ${path}`);
      const payload = (await response.json()) as { features?: unknown };
      return Array.isArray(payload.features) ? (payload.features as MarineFeature[]) : [];
    } catch (error) {
      // An aborted view is a deliberate cancellation, not a flaky request.
      if (options.signal?.aborted) throw error;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  return [];
}

export async function loadMarineData(
  bounds: MarineBounds,
  options: { signal?: AbortSignal; baseUrl?: string } = {},
): Promise<{ navaids: Navaid[]; ferries: MarineFeature[]; bridges: MarineFeature[]; tss: MarineFeature[] }> {
  const manifest = await readManifest(options.baseUrl);
  const result: Record<MarineLayer, MarineFeature[]> = { navaids: [], ferries: [], bridges: [], tss: [] };
  for (const layer of ['navaids', 'ferries', 'bridges', 'tss'] as const) {
    const shards = marineShardsForBounds(manifest, layer, bounds);
    const responses = await loadShardBatch(
      shards.map((shard) => shard.path),
      (path) => readShard(path, options),
      options,
    );
    const seen = new Set<string>();
    for (const features of responses) {
      for (const feature of features) {
        if (marineBoundsIntersect(feature.bounds, bounds) && !seen.has(feature.id)) {
          seen.add(feature.id);
          result[layer].push(feature);
        }
      }
    }
  }
  return {
    ...result,
    navaids: result.navaids.flatMap((feature) => feature.navaid ? [feature.navaid] : []),
  };
}
