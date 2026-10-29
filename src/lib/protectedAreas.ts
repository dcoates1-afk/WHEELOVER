import type { Bounds } from './navaidDb';

export interface ProtectedAreaFeature {
  id: string;
  name: string;
  bounds: Bounds;
  geometry: GeoJSON.Geometry;
  properties: Record<string, string>;
  sourceUrl: string;
}

const ENDPOINT = '/api/natura2000';
const cache = new Map<string, { at: number; features: ProtectedAreaFeature[] }>();
const CACHE_MS = 60 * 60 * 1000;

function boundsKey(bounds: Bounds): string {
  return bounds.map((value) => value.toFixed(3)).join(',');
}

export async function loadNatura2000(bounds: Bounds, signal?: AbortSignal): Promise<ProtectedAreaFeature[]> {
  const key = boundsKey(bounds);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.features;
  const [south, west, north, east] = bounds;
  const params = new URLSearchParams({ bbox: `${south},${west},${north},${east}` });
  const response = await fetch(`${ENDPOINT}?${params}`, { signal });
  if (!response.ok) throw new Error(`Natura 2000 data unavailable (HTTP ${response.status})`);
  const payload = (await response.json()) as {
    type?: unknown;
    features?: Array<{ id?: string; geometry?: GeoJSON.Geometry | null; properties?: Record<string, unknown> }>;
  };
  if (payload.type !== 'FeatureCollection' || !Array.isArray(payload.features)) {
    throw new Error('Natura 2000 service returned an invalid feature collection');
  }
  const features = payload.features.flatMap((feature): ProtectedAreaFeature[] => {
    const properties = feature.properties ?? {};
    const geometry = feature.geometry;
    if (!geometry || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) return [];
    const polygonGeometry = geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
    const coordinatePairs: number[][] = [];
    const collect = (value: unknown) => {
      if (!Array.isArray(value)) return;
      if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
        coordinatePairs.push(value as number[]);
        return;
      }
      value.forEach(collect);
    };
    collect(polygonGeometry.coordinates);
    if (coordinatePairs.length < 3) return [];
    const lons = coordinatePairs.map(([lon]) => lon);
    const lats = coordinatePairs.map(([, lat]) => lat);
    const featureBounds: Bounds = [Math.min(...lats), Math.min(...lons), Math.max(...lats), Math.max(...lons)];
    const name = typeof properties.sitename === 'string' && properties.sitename.trim() ? properties.sitename : 'Unnamed Natura 2000 site';
    const detailKeys = ['sitecode', 'sitename', 'ms', 'country', 'sitetype', 'sitedesc', 'directive', 'area_ha', 'mar_perc', 'release_da', 'date_spa', 'date_sci', 'date_sac'];
    const details = Object.fromEntries(detailKeys.flatMap((field) => {
      const value = properties[field];
      return value === null || value === undefined || value === '' || value === 0 || value === 'n/a'
        ? []
        : [[field, String(value)]];
    }));
    return [{
      id: String(feature.id ?? `${details.sitecode ?? name}:${featureBounds.join(',')}`),
      name,
      bounds: featureBounds,
      geometry,
      properties: details,
      sourceUrl: 'https://emodnet.ec.europa.eu/geonetwork/srv/api/records/ac911c34-1692-4642-a031-87bcb5822158',
    }];
  });
  cache.set(key, { at: Date.now(), features });
  return features;
}

export function clearProtectedAreaCache(): void {
  cache.clear();
}
