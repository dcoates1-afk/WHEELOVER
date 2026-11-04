/**
 * U.S. Coast Guard Local Notices to Mariners, via the app's own /api/lnm
 * relay. NAVCEN publishes the current notices as static GeoJSON files with
 * no CORS headers, so the browser cannot fetch them directly; the relay
 * discovers the file list, fetches the files, and serves only the features
 * overlapping the requested bounding box. The files are the current set by
 * definition (NAVCEN refreshes LNM data every 15 minutes), so no date
 * filtering is applied here.
 */

export interface LnmGeometry {
  type: string;
  coordinates?: unknown;
  geometries?: LnmGeometry[];
}

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
  geometry: LnmGeometry;
}

export interface LnmMeta {
  files: number;
  total: number;
  returned: number;
  truncated: boolean;
  incomplete: string[];
  fetchedAt: string;
  stale: boolean;
  cached: boolean;
}

export interface LnmResponse {
  features: LnmFeature[];
  meta: LnmMeta;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isFeature(value: unknown): value is LnmFeature {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.description === 'string' &&
    isRecord(value.geometry) &&
    typeof value.geometry.type === 'string'
  );
}

export async function fetchLnmFeatures(
  bounds: [number, number, number, number],
  signal?: AbortSignal,
): Promise<LnmResponse> {
  const response = await fetch(`/api/lnm?bbox=${bounds.join(',')}`, { signal });
  if (!response.ok) throw new Error(`Local notices HTTP ${response.status}`);
  const payload = (await response.json()) as { features?: unknown; meta?: unknown };
  const features = Array.isArray(payload.features)
    ? payload.features.filter(isFeature)
    : [];
  const meta = (isRecord(payload.meta) ? payload.meta : {}) as Record<string, unknown>;
  return {
    features,
    meta: {
      files: typeof meta.files === 'number' ? meta.files : 0,
      total: typeof meta.total === 'number' ? meta.total : features.length,
      returned: typeof meta.returned === 'number' ? meta.returned : features.length,
      truncated: meta.truncated === true,
      incomplete: Array.isArray(meta.incomplete)
        ? meta.incomplete.filter((entry): entry is string => typeof entry === 'string')
        : [],
      fetchedAt: typeof meta.fetchedAt === 'string' ? meta.fetchedAt : '',
      stale: meta.stale === true,
      cached: meta.cached === true,
    },
  };
}

/**
 * One chart point for a feature, for "Centre on chart" and list display.
 * GeoJSON coordinates are [lon, lat]; the result is [lat, lon]. Lines use
 * their middle coordinate, polygons their outer ring's bounding-box centre.
 */
export function lnmRepresentativePoint(feature: LnmFeature): [number, number] | null {
  const point = (node: unknown): [number, number] | null => {
    if (
      Array.isArray(node) &&
      node.length >= 2 &&
      typeof node[0] === 'number' &&
      typeof node[1] === 'number'
    ) {
      return [node[1], node[0]];
    }
    return null;
  };
  const geometry = feature.geometry;
  switch (geometry.type) {
    case 'Point':
      return point(geometry.coordinates);
    case 'MultiPoint':
      return Array.isArray(geometry.coordinates) ? point(geometry.coordinates[0]) : null;
    case 'LineString': {
      if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) return null;
      return point(geometry.coordinates[Math.floor(geometry.coordinates.length / 2)]);
    }
    case 'MultiLineString': {
      if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) return null;
      const first = geometry.coordinates[0];
      if (!Array.isArray(first) || first.length === 0) return null;
      return point(first[Math.floor(first.length / 2)]);
    }
    case 'Polygon': {
      if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) return null;
      const ring = geometry.coordinates[0];
      if (!Array.isArray(ring) || ring.length === 0) return null;
      let south = Infinity;
      let west = Infinity;
      let north = -Infinity;
      let east = -Infinity;
      for (const node of ring) {
        const candidate = point(node);
        if (!candidate) continue;
        south = Math.min(south, candidate[0]);
        west = Math.min(west, candidate[1]);
        north = Math.max(north, candidate[0]);
        east = Math.max(east, candidate[1]);
      }
      if (!Number.isFinite(south)) return null;
      return [(south + north) / 2, (west + east) / 2];
    }
    case 'MultiPolygon': {
      if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) return null;
      return lnmRepresentativePoint({ ...feature, geometry: { type: 'Polygon', coordinates: geometry.coordinates[0] } });
    }
    case 'GeometryCollection': {
      if (!Array.isArray(geometry.geometries)) return null;
      for (const child of geometry.geometries) {
        const candidate = lnmRepresentativePoint({ ...feature, geometry: child });
        if (candidate) return candidate;
      }
      return null;
    }
    default:
      return null;
  }
}

/** 'Nov 5, 2026' style, or null when the notice carries no date. */
export function lnmDateLabel(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
