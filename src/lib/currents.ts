/**
 * Tidal-current predictions from NOAA CO-OPS.
 *
 * Currents are a different product from tides: predictions are published for
 * current stations (often mid-channel) at slack, maximum flood and maximum ebb,
 * each with a signed velocity and the mean set of the flood and ebb streams.
 * The water between those events is interpolated with a cosine, which matches
 * the shape of a reversing tidal stream closely enough for planning.
 */
import { distanceKm } from './geo';
import { parseNoaaTime } from './time';
import type { SeriesPoint } from './weather';

export type CurrentPhase = 'flood' | 'ebb' | 'slack';

export interface CurrentStation {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export interface CurrentEvent {
  /** NOAA timestamp as published, `YYYY-MM-DD HH:mm` UTC. */
  time: string;
  epoch: number;
  type: CurrentPhase;
  /** Magnitude in knots. */
  speedKn: number;
  /** Direction the stream sets towards, degrees true; null at slack. */
  setDegrees: number | null;
}

export interface CurrentNow {
  speedKn: number;
  setDegrees: number | null;
  phase: CurrentPhase;
  next: CurrentEvent | null;
  minutesToNext: number | null;
}

export interface CurrentForecast {
  station: CurrentStation;
  distanceKm: number;
  events: CurrentEvent[];
}

export type CurrentLookup =
  | { status: 'ok'; forecast: CurrentForecast }
  | { status: 'no-station' }
  | { status: 'unavailable' };

export interface CurrentSeriesPoint {
  epoch: number;
  speedKn: number;
}

/** A current station further than this is not describing the water you are in. */
export const CURRENT_STATION_MAX_KM = 60;

/** Below this the stream is called slack rather than flood or ebb. */
const SLACK_KN = 0.05;

const CURRENTS_URL = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';

type StationTuple = [string, string, number, number];

let stationsPromise: Promise<CurrentStation[]> | null = null;

/**
 * The bundled station index is a lazy chunk: the chart itself never pays for
 * it, and the panel gets it from the app rather than from NOAA's 4 MB metadata
 * service.
 */
export function loadCurrentStations(): Promise<CurrentStation[]> {
  stationsPromise ??= import('../data/currentStations.json')
    .then((module) => {
      const rows = (module.default ?? module) as unknown as StationTuple[];
      return rows.map(([id, name, lat, lon]) => ({ id, name, lat, lon }));
    })
    .catch(() => {
      stationsPromise = null;
      return [] as CurrentStation[];
    });
  return stationsPromise;
}

export function nearestCurrentStation(
  lat: number,
  lon: number,
  stations: CurrentStation[],
  maxKm = CURRENT_STATION_MAX_KM,
): { station: CurrentStation; distanceKm: number } | null {
  let best: { station: CurrentStation; distanceKm: number } | null = null;
  for (const station of stations) {
    const km = distanceKm(lat, lon, station.lat, station.lon);
    if (!best || km < best.distanceKm) best = { station, distanceKm: km };
  }
  if (!best || best.distanceKm > maxKm) return null;
  return best;
}

interface PredictionEntry {
  Type?: string;
  Time?: string;
  Velocity_Major?: number | string;
  meanFloodDir?: number | string;
  meanEbbDir?: number | string;
}

function phaseOf(value: string | undefined): CurrentPhase | null {
  const type = (value ?? '').trim().toLowerCase();
  if (type === 'flood' || type === 'ebb' || type === 'slack') return type;
  return null;
}

function degrees(value: number | string | undefined): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return ((parsed % 360) + 360) % 360;
}

/**
 * Normalise NOAA's signed `Velocity_Major` into a magnitude plus the set of the
 * stream. Flood positives run towards `meanFloodDir`, ebb negatives towards
 * `meanEbbDir`; the sign is not the direction.
 */
export function normalizeCurrentPredictions(entries: PredictionEntry[] | undefined): CurrentEvent[] {
  const events: CurrentEvent[] = [];
  for (const entry of entries ?? []) {
    const type = phaseOf(entry.Type);
    const time = typeof entry.Time === 'string' ? entry.Time.trim() : '';
    const epoch = parseNoaaTime(time);
    if (!type || !Number.isFinite(epoch)) continue;
    const velocity = Math.abs(Number(entry.Velocity_Major));
    const setDegrees = type === 'flood'
      ? degrees(entry.meanFloodDir)
      : type === 'ebb'
        ? degrees(entry.meanEbbDir)
        : null;
    events.push({
      time,
      epoch,
      type,
      speedKn: Number.isFinite(velocity) ? velocity : 0,
      setDegrees,
    });
  }
  return events.sort((a, b) => a.epoch - b.epoch);
}

function noaaDate(date: Date): string {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(
    date.getUTCDate(),
  ).padStart(2, '0')}`;
}

export async function fetchCurrentEvents(
  stationId: string,
  days = 2,
  signal?: AbortSignal,
): Promise<CurrentEvent[]> {
  const begin = new Date();
  const end = new Date(begin.getTime() + days * 24 * 60 * 60 * 1000);
  const params = new URLSearchParams({
    product: 'currents_predictions',
    application: 'WHEELOVER',
    begin_date: noaaDate(begin),
    end_date: noaaDate(end),
    station: stationId,
    time_zone: 'gmt',
    units: 'english',
    interval: 'max_slack',
    format: 'json',
  });
  const response = await fetch(`${CURRENTS_URL}?${params}`, { signal });
  if (!response.ok) throw new Error(`Current service returned HTTP ${response.status}`);
  const payload = (await response.json()) as {
    current_predictions?: { cp?: PredictionEntry[] };
    error?: { message?: string };
  };
  if (payload.error) throw new Error(payload.error.message ?? 'Current predictions unavailable');
  const events = normalizeCurrentPredictions(payload.current_predictions?.cp);
  if (events.length < 2) throw new Error('Current predictions unavailable');
  return events;
}

function lastSlackBefore(events: CurrentEvent[], at: number): CurrentEvent | null {
  let best: CurrentEvent | null = null;
  for (const event of events) {
    if (event.type === 'slack' && event.epoch <= at) best = event;
  }
  return best;
}

function firstSlackAfter(events: CurrentEvent[], at: number): CurrentEvent | null {
  for (const event of events) {
    if (event.type === 'slack' && event.epoch > at) return event;
  }
  return null;
}

/**
 * The stream at a moment, cosine-interpolated between the slacks that bracket
 * it with the strongest event between them as the peak. Outside the predicted
 * span the nearest published event is reported as-is.
 */
export function currentAt(events: CurrentEvent[], at = Date.now()): CurrentNow | null {
  if (events.length === 0) return null;

  const next = events.find((event) => event.epoch > at) ?? null;
  const windows = { next, minutesToNext: next ? Math.max(0, Math.round((next.epoch - at) / 60000)) : null };

  const prevSlack = lastSlackBefore(events, at);
  const nextSlack = firstSlackAfter(events, at);

  let speedKn = 0;
  let setDegrees: number | null = null;
  let phase: CurrentPhase = 'slack';

  if (prevSlack && nextSlack) {
    const span = nextSlack.epoch - prevSlack.epoch;
    let peak: CurrentEvent | null = null;
    for (const event of events) {
      if (event.epoch <= prevSlack.epoch || event.epoch >= nextSlack.epoch) continue;
      if (event.type === 'slack') continue;
      if (!peak || event.speedKn > peak.speedKn) peak = event;
    }
    if (peak && span > 0) {
      const progress = Math.min(1, Math.max(0, (at - prevSlack.epoch) / span));
      speedKn = peak.speedKn * Math.sin(Math.PI * progress);
      phase = speedKn < SLACK_KN ? 'slack' : peak.type;
      setDegrees = phase === 'slack' ? null : peak.setDegrees;
    }
  } else {
    let nearest: CurrentEvent | null = null;
    for (const event of events) {
      if (!nearest || Math.abs(event.epoch - at) < Math.abs(nearest.epoch - at)) nearest = event;
    }
    if (nearest) {
      speedKn = nearest.speedKn;
      phase = nearest.speedKn < SLACK_KN ? 'slack' : nearest.type;
      setDegrees = phase === 'slack' ? null : nearest.setDegrees;
    }
  }

  return { speedKn, setDegrees, phase, ...windows };
}

/** Speed curve for a sparkline: every step minutes from `from` for `hours`. */
export function currentSeries(
  events: CurrentEvent[],
  from = Date.now(),
  hours = 12,
  stepMinutes = 30,
): CurrentSeriesPoint[] {
  if (events.length === 0) return [];
  const points: CurrentSeriesPoint[] = [];
  const step = stepMinutes * 60 * 1000;
  for (let epoch = from; epoch <= from + hours * 60 * 60 * 1000; epoch += step) {
    const now = currentAt(events, epoch);
    if (now) points.push({ epoch, speedKn: now.speedKn });
  }
  return points;
}

interface CacheEntry {
  events: CurrentEvent[];
  at: number;
}

const forecastCache = new Map<string, CacheEntry>();
const FORECAST_TTL_MS = 30 * 60 * 1000;

/**
 * Nearest station with usable predictions. NOAA publishes metadata for places
 * where the datagetter answers "not available", so the closest few stations are
 * tried in turn rather than letting the first miss blank the panel.
 */
export async function findCurrentPredictions(
  lat: number,
  lon: number,
  options: { signal?: AbortSignal; maxKm?: number; attempts?: number; now?: number } = {},
): Promise<CurrentLookup> {
  const { signal, maxKm = CURRENT_STATION_MAX_KM, attempts = 4, now = Date.now() } = options;
  const stations = await loadCurrentStations();
  if (stations.length === 0) return { status: 'unavailable' };

  const nearby = stations
    .map((station) => ({ station, distanceKm: distanceKm(lat, lon, station.lat, station.lon) }))
    .filter((entry) => entry.distanceKm <= maxKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
  if (nearby.length === 0) return { status: 'no-station' };

  for (const candidate of nearby.slice(0, attempts)) {
    const cached = forecastCache.get(candidate.station.id);
    if (cached && now - cached.at < FORECAST_TTL_MS) {
      return { status: 'ok', forecast: { ...candidate, events: cached.events } };
    }
    try {
      const events = await fetchCurrentEvents(candidate.station.id, 2, signal);
      forecastCache.set(candidate.station.id, { events, at: now });
      return { status: 'ok', forecast: { ...candidate, events } };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      // Try the next-nearest station; NOAA sometimes has metadata but no data.
    }
  }
  return { status: 'unavailable' };
}

export function clearCurrentCache(): void {
  forecastCache.clear();
  stationsPromise = null;
}

const KMH_PER_KNOT = 1.852;

export interface ModelCurrentNow {
  speedKn: number;
  setDegrees: number | null;
}

/**
 * Surface current from the global ocean model, used where NOAA has no current
 * station. Open-Meteo publishes km/h; mariners read knots.
 */
export function modelCurrentAt(
  speed: SeriesPoint[],
  direction: SeriesPoint[],
  at = Date.now(),
): ModelCurrentNow | null {
  if (speed.length === 0) return null;
  const stamps = speed.map((point) => parseNoaaTime(point.time));
  if (stamps.some((stamp) => !Number.isFinite(stamp))) return null;

  let knots = speed[speed.length - 1].value;
  if (at <= stamps[0]) {
    knots = speed[0].value;
  } else if (at < stamps[stamps.length - 1]) {
    for (let index = 0; index < speed.length - 1; index += 1) {
      if (at >= stamps[index] && at <= stamps[index + 1]) {
        const span = stamps[index + 1] - stamps[index] || 1;
        const fraction = (at - stamps[index]) / span;
        knots = speed[index].value + (speed[index + 1].value - speed[index].value) * fraction;
        break;
      }
    }
  }

  let setDegrees: number | null = null;
  let closest = Number.POSITIVE_INFINITY;
  for (const point of direction) {
    const stamp = parseNoaaTime(point.time);
    if (!Number.isFinite(stamp)) continue;
    const gap = Math.abs(stamp - at);
    if (gap < closest) {
      closest = gap;
      setDegrees = ((point.value % 360) + 360) % 360;
    }
  }

  const speedKn = Math.max(0, knots / KMH_PER_KNOT);
  return { speedKn, setDegrees };
}

/** Twelve-hour speed curve for the model readout, in knots. */
export function modelCurrentSeries(
  speed: SeriesPoint[],
  from = Date.now(),
  hours = 12,
): CurrentSeriesPoint[] {
  const points: CurrentSeriesPoint[] = [];
  for (const point of speed) {
    const epoch = parseNoaaTime(point.time);
    if (!Number.isFinite(epoch)) continue;
    if (epoch < from || epoch > from + hours * 60 * 60 * 1000) continue;
    points.push({ epoch, speedKn: Math.max(0, point.value / KMH_PER_KNOT) });
  }
  return points;
}
