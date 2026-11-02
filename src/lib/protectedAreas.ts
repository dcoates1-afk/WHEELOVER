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

/** The protected-area layer ships site names with HTML entities in them. */
function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

const CONSERVATION_DETAIL_FIELDS: Array<[string, string]> = [
  ['designation_layer', 'Designation layer'],
  ['designatio', 'Designation'],
  ['sitetype', 'Site type'],
  ['sitecode', 'Site code'],
  ['orig_name', 'Source site name'],
  ['country', 'Country'],
  ['directive', 'Directive'],
  ['iucn_cat', 'IUCN category'],
  ['status', 'Status'],
  ['status_yr', 'Status year'],
  ['mang_auth', 'Managing authority'],
  ['area_ha', 'Area (ha)'],
  ['mar_perc', 'Marine share (%)'],
  ['rep_m_area', 'Reported marine area (km²)'],
  ['sitedesc', 'Site description'],
  ['release_da', 'Release date'],
  ['date_spa', 'SPA designated'],
  ['date_sci', 'SCI designated'],
  ['date_sac', 'SAC designated'],
];

/** Both EMODnet conservation layers are folded into one collection. */
function featureName(properties: Record<string, unknown>): string {
  for (const field of ['sitename', 'name', 'orig_name']) {
    const value = properties[field];
    if (typeof value === 'string' && value.trim()) return decodeEntities(value.trim());
  }
  return 'Unnamed conservation site';
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
    // A detailed survey ring can hold hundreds of thousands of points, which is
    // too many to spread into Math.min/Math.max, so reduce instead.
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    for (const [lon, lat] of coordinatePairs) {
      if (lon < west) west = lon;
      if (lon > east) east = lon;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
    const featureBounds: Bounds = [south, west, north, east];
    const name = featureName(properties);
    // The two source layers use different column names; both are labelled with
    // the heading the chart popup prints.
    const details = Object.fromEntries(CONSERVATION_DETAIL_FIELDS.flatMap(([field, label]) => {
      const value = properties[field];
      return value === null || value === undefined || value === '' || value === 0 || value === 'n/a'
        ? []
        : [[label, String(value)]];
    }));
    const recordLink = typeof properties.link === 'string' && /^https?:\/\//.test(properties.link) ? properties.link : null;
    return [{
      id: String(feature.id ?? `${details['Site code'] ?? name}:${featureBounds.join(',')}`),
      name,
      bounds: featureBounds,
      geometry,
      properties: details,
      sourceUrl: recordLink ?? 'https://emodnet.ec.europa.eu/geonetwork/srv/api/records/ac911c34-1692-4642-a031-87bcb5822158',
    }];
  });
  cache.set(key, { at: Date.now(), features });
  return features;
}

export function clearProtectedAreaCache(): void {
  cache.clear();
}
