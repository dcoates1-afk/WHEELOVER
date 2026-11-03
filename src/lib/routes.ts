import { distanceKm } from './geo';

// Route planning math, kept pure so the builder UI and the safety checks
// share one calculation. A route is an ordered list of waypoints; legs are
// the gaps between consecutive waypoints. Distances come from the
// great-circle helper in geo.ts, bearings are initial bearings, and ETA is
// total distance over the skipper's editable cruising speed. Nothing here
// judges a route — the safety checks report, the skipper decides.

export interface RouteWaypoint {
  lat: number;
  lon: number;
}

export interface RouteLeg {
  from: RouteWaypoint;
  to: RouteWaypoint;
  distanceKm: number;
  distanceNm: number;
  bearingDeg: number;
}

export interface RouteTotals {
  legs: RouteLeg[];
  totalKm: number;
  totalNm: number;
  etaHours: number | null;
}

export const KM_PER_NM = 1.852;

const toRad = (value: number) => (value * Math.PI) / 180;
const toDeg = (value: number) => (value * 180) / Math.PI;

/** Initial bearing in degrees true, 0–360. */
export function initialBearingDeg(from: RouteWaypoint, to: RouteWaypoint): number {
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const dLon = toRad(to.lon - from.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Per-leg stats plus totals. etaHours is null when speedKnots is not positive. */
export function routeTotals(waypoints: RouteWaypoint[], speedKnots: number): RouteTotals {
  const legs: RouteLeg[] = [];
  for (let i = 1; i < waypoints.length; i++) {
    const from = waypoints[i - 1];
    const to = waypoints[i];
    const km = distanceKm(from.lat, from.lon, to.lat, to.lon);
    legs.push({
      from,
      to,
      distanceKm: km,
      distanceNm: km / KM_PER_NM,
      bearingDeg: initialBearingDeg(from, to),
    });
  }
  const totalKm = legs.reduce((sum, leg) => sum + leg.distanceKm, 0);
  const totalNm = totalKm / KM_PER_NM;
  return {
    legs,
    totalKm,
    totalNm,
    etaHours: speedKnots > 0 ? totalNm / speedKnots : null,
  };
}

// --- Device-only storage ---------------------------------------------------
// The route lives in this browser's localStorage, like pins and tracks. No
// account, no server — the account project is what would ever sync it.

export const ROUTE_STORAGE_KEY = 'wheel-over:route';
export const ROUTE_SPEED_STORAGE_KEY = 'wheel-over:route-speed';
export const DEFAULT_ROUTE_SPEED_KNOTS = 6;

export function isValidWaypoint(value: unknown): value is RouteWaypoint {
  if (!value || typeof value !== 'object') return false;
  const point = value as Partial<RouteWaypoint>;
  return (
    typeof point.lat === 'number' &&
    Number.isFinite(point.lat) &&
    point.lat >= -90 &&
    point.lat <= 90 &&
    typeof point.lon === 'number' &&
    Number.isFinite(point.lon) &&
    point.lon >= -180 &&
    point.lon <= 180
  );
}

/** Stored waypoints in order; anything malformed is dropped, never trusted. */
export function loadRoute(storage: Storage | null): RouteWaypoint[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(ROUTE_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidWaypoint);
  } catch {
    return [];
  }
}

export function writeRoute(storage: Storage | null, waypoints: RouteWaypoint[]): void {
  if (!storage) return;
  try {
    storage.setItem(ROUTE_STORAGE_KEY, JSON.stringify(waypoints));
  } catch {
    // A full or unavailable store must not break the chart.
  }
}

export function loadRouteSpeed(storage: Storage | null): number {
  if (!storage) return DEFAULT_ROUTE_SPEED_KNOTS;
  try {
    const parsed = Number(storage.getItem(ROUTE_SPEED_STORAGE_KEY));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_ROUTE_SPEED_KNOTS;
  } catch {
    return DEFAULT_ROUTE_SPEED_KNOTS;
  }
}

export function writeRouteSpeed(storage: Storage | null, speedKnots: number): void {
  if (!storage) return;
  try {
    storage.setItem(ROUTE_SPEED_STORAGE_KEY, String(speedKnots));
  } catch {
    // As above: never break the chart over storage.
  }
}

/** '1h 30m' style ETA; '—' when no speed is set. */
export function formatEtaHours(etaHours: number | null): string {
  if (etaHours === null) return '—';
  const totalMinutes = Math.round(etaHours * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}
