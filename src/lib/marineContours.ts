import { HttpReader } from 'flatgeobuf/lib/mjs/http-reader.js';
import { fromFeature } from 'flatgeobuf/lib/mjs/geojson/feature.js';
import type { Rect } from 'flatgeobuf/lib/mjs/packedrtree.js';

export type ContourBounds = [south: number, west: number, north: number, east: number];
export interface ContourShard {
  path: string;
  bounds: ContourBounds;
  count: number;
  totalBytes: number;
  source: string;
  sourceId: string;
  attribution: string;
  datum: string;
  resolutionDegrees: number;
  contourProperty: 'elev_m';
}
export interface ContourManifest {
  schema: 1;
  generatedAt: string;
  bounds: ContourBounds;
  coverageBounds: ContourBounds[];
  shardDegrees: number;
  contourLevelsMetres: number[];
  sources: Array<{ id: string; name: string; attribution: string; datum: string }>;
  shards: ContourShard[];
  notice: string;
}
export interface ContourFeature {
  type: 'Feature';
  geometry: GeoJSON.LineString | GeoJSON.MultiLineString;
  properties: { elev_m: number; [key: string]: unknown };
}

const isBounds = (value: unknown): value is ContourBounds => {
  if (!Array.isArray(value) || value.length !== 4 || !value.every((part) => typeof part === 'number' && Number.isFinite(part))) return false;
  const [south, west, north, east] = value;
  return -90 <= south && south < north && north <= 90 && -180 <= west && west < east && east <= 180;
};

export function validateContourManifest(value: unknown): ContourManifest | null {
  if (!value || typeof value !== 'object') return null;
  const manifest = value as Partial<ContourManifest>;
  if (manifest.schema !== 1 || typeof manifest.generatedAt !== 'string' || !isBounds(manifest.bounds) || !Array.isArray(manifest.coverageBounds) || !manifest.coverageBounds.length || !manifest.coverageBounds.every(isBounds) || !Array.isArray(manifest.shards) || !Array.isArray(manifest.sources)) return null;
  const shards: ContourShard[] = [];
  for (const candidate of manifest.shards) {
    if (!candidate || typeof candidate !== 'object') return null;
    const shard = candidate as Partial<ContourShard>;
    const pathParts = typeof shard.path === 'string' ? shard.path.split('/') : [];
    if (!pathParts.length || pathParts.some((part) => !part || part === '.' || part === '..') || !/^[A-Za-z0-9][A-Za-z0-9._/-]*\.fgb$/.test(shard.path!) || !isBounds(shard.bounds) || !Number.isSafeInteger(shard.count) || shard.count! < 0 || !Number.isSafeInteger(shard.totalBytes) || shard.totalBytes! <= 0 || typeof shard.source !== 'string' || typeof shard.sourceId !== 'string' || typeof shard.attribution !== 'string' || typeof shard.datum !== 'string' || typeof shard.resolutionDegrees !== 'number' || !Number.isFinite(shard.resolutionDegrees) || shard.resolutionDegrees! <= 0 || shard.contourProperty !== 'elev_m') return null;
    shards.push(shard as ContourShard);
  }
  return {
    schema: 1,
    generatedAt: manifest.generatedAt,
    bounds: manifest.bounds,
    coverageBounds: manifest.coverageBounds,
    shardDegrees: Number(manifest.shardDegrees) || 10,
    contourLevelsMetres: Array.isArray(manifest.contourLevelsMetres) ? manifest.contourLevelsMetres.filter((item): item is number => typeof item === 'number' && Number.isFinite(item)) : [],
    sources: manifest.sources.filter((source) => !!source && typeof source.id === 'string' && typeof source.name === 'string' && typeof source.attribution === 'string' && typeof source.datum === 'string'),
    shards,
    notice: typeof manifest.notice === 'string' ? manifest.notice : 'Contours are interpolated display data, not for navigation.',
  };
}

export function contourBoundsIntersect(a: ContourBounds, b: ContourBounds): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

export function contourShardsForBounds(manifest: ContourManifest, bounds: ContourBounds): ContourShard[] {
  return manifest.shards.filter((shard) => contourBoundsIntersect(shard.bounds, bounds));
}

export function contourManifestCoversBounds(manifest: ContourManifest, bounds: ContourBounds): boolean {
  const [south, west, north, east] = bounds;
  const coverage = manifest.coverageBounds
    .filter((item) => contourBoundsIntersect(item, bounds))
    .map(([itemSouth, itemWest, itemNorth, itemEast]) => [
      Math.max(south, itemSouth), Math.max(west, itemWest), Math.min(north, itemNorth), Math.min(east, itemEast),
    ] as ContourBounds);
  if (!coverage.length) return false;

  // Sweep each longitude band formed by coverage edges. For every band, the
  // union of its latitude intervals must cover the full viewport; a mere
  // overlap is not enough to suppress the global fallback layer.
  const longitudeEdges = [...new Set([
    west,
    east,
    ...coverage.flatMap((item) => [item[1], item[3]]),
  ])].sort((a, b) => a - b);
  for (let index = 0; index < longitudeEdges.length - 1; index += 1) {
    const bandWest = longitudeEdges[index];
    const bandEast = longitudeEdges[index + 1];
    if (bandWest >= bandEast) continue;
    const middle = (bandWest + bandEast) / 2;
    const intervals = coverage
      .filter((item) => item[1] <= middle && middle <= item[3])
      .map((item) => [item[0], item[2]] as const)
      .sort((a, b) => a[0] - b[0]);
    let coveredNorth = south;
    for (const [intervalSouth, intervalNorth] of intervals) {
      if (intervalSouth > coveredNorth) break;
      coveredNorth = Math.max(coveredNorth, intervalNorth);
      if (coveredNorth >= north) break;
    }
    if (coveredNorth < north) return false;
  }
  return true;
}

export function contourDataBaseUrl(configured = import.meta.env.VITE_CONTOUR_DATA_URL): string {
  return configured ? `${configured.replace(/\/+$/, '')}/` : '/contours/';
}

function absoluteBaseUrl(baseUrl: string): string {
  const pageUrl = typeof globalThis.location?.href === 'string' ? globalThis.location.href : 'http://localhost/';
  return new URL(baseUrl, pageUrl).toString();
}

export async function readContourManifest(baseUrl = contourDataBaseUrl()): Promise<ContourManifest> {
  const response = await fetch(new URL('manifest.json', absoluteBaseUrl(baseUrl)), { cache: 'no-store' });
  if (!response.ok) throw new Error(`Contour manifest unavailable (HTTP ${response.status})`);
  const manifest = validateContourManifest(await response.json());
  if (!manifest) throw new Error('Contour manifest is invalid');
  return manifest;
}

export async function loadContoursForBounds(
  manifest: ContourManifest,
  bounds: ContourBounds,
  baseUrl = contourDataBaseUrl(),
  signal?: AbortSignal,
): Promise<ContourFeature[]> {
  const selected = contourShardsForBounds(manifest, bounds);
  if (selected.reduce((total, shard) => total + shard.totalBytes, 0) > 64 * 1024 * 1024) {
    throw new Error('Selected contour shards exceed the 64 MiB viewport safety limit; zoom in before loading');
  }
  const seen = new Set<string>();
  const features: ContourFeature[] = [];
  const rect = { minX: bounds[1], minY: bounds[0], maxX: bounds[3], maxY: bounds[2] };
  const base = absoluteBaseUrl(`${baseUrl.replace(/\/+$/, '')}/`);
  for (const shard of selected) {
    if (signal?.aborted) throw new DOMException('Contour request aborted', 'AbortError');
    const url = new URL(shard.path, base).toString();
    const rangeClient = {
      async getRange(begin: number, length: number): Promise<ArrayBuffer> {
        if (signal?.aborted) throw new DOMException('Contour request aborted', 'AbortError');
        const response = await fetch(url, {
          headers: { Range: `bytes=${begin}-${begin + length - 1}` },
          signal,
        });
        if (response.status !== 206) throw new Error(`FlatGeobuf server must support byte ranges (HTTP ${response.status})`);
        const range = response.headers.get('Content-Range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
        if (!range || Number(range[1]) !== begin || Number(range[3]) !== shard.totalBytes) throw new Error('FlatGeobuf server returned an invalid Content-Range');
        const bytes = await response.arrayBuffer();
        const actualEnd = Number(range[2]);
        if (actualEnd < begin || actualEnd >= begin + length || bytes.byteLength !== actualEnd - begin + 1) {
          throw new Error('FlatGeobuf server returned an incomplete byte range');
        }
        return bytes;
      },
    };
    const reader = await HttpReader.openSource(rangeClient);
    for await (const indexed of reader.selectBbox(rect as Rect)) {
      if (signal?.aborted) throw new DOMException('Contour request aborted', 'AbortError');
      const feature = fromFeature(indexed.id, indexed.feature, reader.header);
      if (feature.type !== 'Feature' || !feature.geometry || !feature.properties) continue;
      const elevation = Number((feature.properties as Record<string, unknown>).elev_m);
      if (!Number.isFinite(elevation)) continue;
      const geometry = feature.geometry as ContourFeature['geometry'];
      const key = `${shard.sourceId}:${elevation}:${JSON.stringify(geometry.coordinates)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      features.push({
        type: 'Feature',
        geometry,
        properties: { ...feature.properties, elev_m: elevation, _source: shard.source, _datum: shard.datum },
      } as ContourFeature);
    }
  }
  return features;
}
