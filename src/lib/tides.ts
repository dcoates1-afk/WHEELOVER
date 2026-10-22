/**
 * Tides anywhere.
 *
 * NOAA harmonic predictions are the best answer in US waters, so they are used
 * whenever a station is close. Everywhere else the Open-Meteo marine model
 * (Météo-France SMOC, ~8 km) supplies hourly sea level, and the panel derives
 * high and low water from that curve. Model heights are above mean sea level,
 * not chart datum, so the UI labels the source rather than inventing a datum.
 */
import { distanceKm } from './geo';
import type { SeriesPoint } from './weather';
import { formatUtc, parseNoaaTime } from './time';

export interface TideStation {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export interface TideEvent {
  time: string;
  value: number;
  type: 'H' | 'L';
}

export interface TideForecast {
  source: 'noaa' | 'model';
  label: string;
  distanceKm: number | null;
  datum: string;
  events: TideEvent[];
  /** Present for the model curve only; NOAA's list has no "now" reading. */
  heightNow: number | null;
}

export type TideLookup =
  | { status: 'ok'; forecast: TideForecast }
  | { status: 'no-station' }
  | { status: 'unavailable' };

/** A harmonic station further than this is not describing your water. */
export const TIDE_STATION_MAX_KM = 120;

const TIDES_URL = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';
const MODEL_LABEL = 'Open-Meteo sea-level model';

type StationTuple = [string, string, number, number];

let stationsPromise: Promise<TideStation[]> | null = null;

export function loadTideStations(): Promise<TideStation[]> {
  stationsPromise ??= import('../data/tideStations.json')
    .then((module) => {
      const rows = (module.default ?? module) as unknown as StationTuple[];
      return rows.map(([id, name, lat, lon]) => ({ id, name, lat, lon }));
    })
    .catch(() => {
      stationsPromise = null;
      return [] as TideStation[];
    });
  return stationsPromise;
}

export function nearestTideStation(
  lat: number,
  lon: number,
  stations: TideStation[],
  maxKm = TIDE_STATION_MAX_KM,
): { station: TideStation; distanceKm: number } | null {
  let best: { station: TideStation; distanceKm: number } | null = null;
  for (const station of stations) {
    const km = distanceKm(lat, lon, station.lat, station.lon);
    if (!best || km < best.distanceKm) best = { station, distanceKm: km };
  }
  if (!best || best.distanceKm > maxKm) return null;
  return best;
}

function noaaDate(date: Date): string {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(
    date.getUTCDate(),
  ).padStart(2, '0')}`;
}

export async function fetchNoaaTideEvents(
  stationId: string,
  days = 3,
  signal?: AbortSignal,
): Promise<TideEvent[]> {
  const begin = new Date();
  const end = new Date(begin.getTime() + days * 24 * 60 * 60 * 1000);
  const params = new URLSearchParams({
    product: 'predictions',
    application: 'WHEELOVER',
    begin_date: noaaDate(begin),
    end_date: noaaDate(end),
    datum: 'MLLW',
    station: stationId,
    time_zone: 'gmt',
    units: 'metric',
    interval: 'hilo',
    format: 'json',
  });
  const response = await fetch(`${TIDES_URL}?${params}`, { signal });
  if (!response.ok) throw new Error(`Tide service returned HTTP ${response.status}`);
  const payload = (await response.json()) as {
    predictions?: { t: string; v: string; type: string }[];
    error?: { message?: string };
  };
  if (payload.error) throw new Error(payload.error.message ?? 'Tide predictions unavailable');
  const events = (payload.predictions ?? [])
    .map((entry) => ({
      time: entry.t,
      value: Number(entry.v),
      type: entry.type === 'H' ? ('H' as const) : ('L' as const),
    }))
    .filter((entry) => Number.isFinite(entry.value) && Number.isFinite(parseNoaaTime(entry.time)));
  if (events.length === 0) throw new Error('Tide predictions unavailable');
  return events;
}

function round(value: number, places = 2): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

/**
 * High and low water from an hourly height curve. Each turning point is refined
 * to a parabola through its neighbours, which recovers the peak within a few
 * minutes instead of forcing it onto the hour.
 */
export function tideEventsFromSeries(points: SeriesPoint[]): TideEvent[] {
  const events: TideEvent[] = [];
  for (let index = 1; index < points.length - 1; index += 1) {
    const prev = points[index - 1];
    const centre = points[index];
    const next = points[index + 1];
    const high = centre.value >= prev.value && centre.value > next.value;
    const low = centre.value <= prev.value && centre.value < next.value;
    if (!high && !low) continue;

    const curvature = prev.value - 2 * centre.value + next.value;
    let offset = curvature === 0 ? 0 : (0.5 * (prev.value - next.value)) / curvature;
    offset = Math.max(-0.5, Math.min(0.5, offset));
    const value = centre.value - 0.25 * (prev.value - next.value) * offset;
    const base = parseNoaaTime(centre.time);
    if (!Number.isFinite(base)) continue;
    events.push({
      time: formatUtc(base + offset * 60 * 60 * 1000),
      value: round(value),
      type: high ? 'H' : 'L',
    });
  }
  return events;
}

/** Linear height at a moment, clamped to the ends of the curve. */
export function heightAt(points: SeriesPoint[], at = Date.now()): number | null {
  if (points.length === 0) return null;
  const stamps = points.map((point) => parseNoaaTime(point.time));
  if (stamps.some((stamp) => !Number.isFinite(stamp))) return null;
  if (at <= stamps[0]) return round(points[0].value);
  if (at >= stamps[stamps.length - 1]) return round(points[points.length - 1].value);
  for (let index = 0; index < points.length - 1; index += 1) {
    if (at >= stamps[index] && at <= stamps[index + 1]) {
      const span = stamps[index + 1] - stamps[index] || 1;
      const fraction = (at - stamps[index]) / span;
      return round(points[index].value + (points[index + 1].value - points[index].value) * fraction);
    }
  }
  return null;
}

export function modelTideForecast(seaLevel: SeriesPoint[], now = Date.now()): TideForecast {
  return {
    source: 'model',
    label: MODEL_LABEL,
    distanceKm: null,
    datum: 'mean sea level',
    events: tideEventsFromSeries(seaLevel),
    heightNow: heightAt(seaLevel, now),
  };
}

interface CacheEntry {
  events: TideEvent[];
  at: number;
}

const predictionCache = new Map<string, CacheEntry>();
const PREDICTION_TTL_MS = 30 * 60 * 1000;

/**
 * NOAA predictions when a station is close; otherwise `no-station` and the
 * caller falls back to the global model curve it already has.
 */
export async function findTideForecast(
  lat: number,
  lon: number,
  options: { signal?: AbortSignal; maxKm?: number; attempts?: number; now?: number } = {},
): Promise<TideLookup> {
  const { signal, maxKm = TIDE_STATION_MAX_KM, attempts = 3, now = Date.now() } = options;
  const stations = await loadTideStations();
  if (stations.length === 0) return { status: 'unavailable' };

  const nearby = stations
    .map((station) => ({ station, distanceKm: distanceKm(lat, lon, station.lat, station.lon) }))
    .filter((entry) => entry.distanceKm <= maxKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
  if (nearby.length === 0) return { status: 'no-station' };

  for (const candidate of nearby.slice(0, attempts)) {
    const cached = predictionCache.get(candidate.station.id);
    if (cached && now - cached.at < PREDICTION_TTL_MS) {
      return {
        status: 'ok',
        forecast: {
          source: 'noaa',
          label: candidate.station.name,
          distanceKm: candidate.distanceKm,
          datum: 'MLLW',
          events: cached.events,
          heightNow: null,
        },
      };
    }
    try {
      const events = await fetchNoaaTideEvents(candidate.station.id, 3, signal);
      predictionCache.set(candidate.station.id, { events, at: now });
      return {
        status: 'ok',
        forecast: {
          source: 'noaa',
          label: candidate.station.name,
          distanceKm: candidate.distanceKm,
          datum: 'MLLW',
          events,
          heightNow: null,
        },
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      // NOAA sometimes lists a station without predictions; try the next one.
    }
  }
  return { status: 'unavailable' };
}

export function clearTideCache(): void {
  predictionCache.clear();
  stationsPromise = null;
}
