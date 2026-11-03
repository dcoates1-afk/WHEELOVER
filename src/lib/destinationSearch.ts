/**
 * Destination search over OpenStreetMap's Nominatim service. No key is needed;
 * the component debounces typing so the service never sees more than about
 * one request per second, per its usage policy. Results are places, not
 * routes — picking one flies the chart there and pins it.
 */

export interface DestinationResult {
  name: string;
  detail: string;
  lat: number;
  lon: number;
}

const SEARCH_URL = 'https://nominatim.openstreetmap.org/search';

export function buildSearchUrl(query: string): string {
  const params = new URLSearchParams({
    format: 'jsonv2',
    q: query,
    limit: '8',
    addressdetails: '0',
  });
  return `${SEARCH_URL}?${params.toString()}`;
}

/** Turn a Nominatim JSON payload into results; anything malformed is dropped. */
export function parseSearchResults(payload: unknown): DestinationResult[] {
  if (!Array.isArray(payload)) return [];
  const results: DestinationResult[] = [];
  for (const item of payload) {
    const row = item as { display_name?: unknown; lat?: unknown; lon?: unknown };
    if (typeof row.display_name !== 'string') continue;
    const lat = Number(row.lat);
    const lon = Number(row.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const parts = row.display_name
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    const name = parts[0];
    if (!name) continue;
    results.push({ name, detail: parts.slice(1).join(', '), lat, lon });
  }
  return results;
}

export async function searchDestinations(
  query: string,
  signal?: AbortSignal,
): Promise<DestinationResult[]> {
  const response = await fetch(buildSearchUrl(query), {
    signal,
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Destination search failed (${response.status})`);
  return parseSearchResults(await response.json());
}
