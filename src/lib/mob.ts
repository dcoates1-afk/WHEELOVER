import { distanceKm } from './geo';
import { initialBearingDeg, KM_PER_NM, type RouteWaypoint } from './routes';

// Man overboard: one recorded position, kept on this device only. The app
// never guesses a MOB position — it comes from the GPS fix when one exists,
// otherwise from the screen centre, and the record says which. A MOB record
// is a marker and a return bearing, not an alarm: nothing here sounds or
// transmits anything.

export interface MobRecord {
  lat: number;
  lon: number;
  at: number;
  fromGps: boolean;
}

export const MOB_STORAGE_KEY = 'wheel-over:mob';

export function createMobRecord(lat: number, lon: number, fromGps: boolean, now: number = Date.now()): MobRecord {
  return { lat, lon, at: now, fromGps };
}

export function isValidMobRecord(value: unknown): value is MobRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<MobRecord>;
  return (
    typeof record.lat === 'number' &&
    Number.isFinite(record.lat) &&
    record.lat >= -90 &&
    record.lat <= 90 &&
    typeof record.lon === 'number' &&
    Number.isFinite(record.lon) &&
    record.lon >= -180 &&
    record.lon <= 180 &&
    typeof record.at === 'number' &&
    Number.isFinite(record.at) &&
    typeof record.fromGps === 'boolean'
  );
}

/** The stored MOB record, or null when none is set or the stored row is bad. */
export function loadMob(storage: Storage | null): MobRecord | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(MOB_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isValidMobRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeMob(storage: Storage | null, record: MobRecord): void {
  if (!storage) return;
  try {
    storage.setItem(MOB_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // A full or unavailable store must not break the chart.
  }
}

export function clearMob(storage: Storage | null): void {
  if (!storage) return;
  try {
    storage.removeItem(MOB_STORAGE_KEY);
  } catch {
    // Clearing is best-effort; a stale record is still just a marker.
  }
}

export interface MobRange {
  distanceNm: number;
  bearingDeg: number;
}

/** Range and bearing from a fix back to the MOB position, null without a fix. */
export function mobRangeFromFix(fix: RouteWaypoint | null, mob: MobRecord): MobRange | null {
  if (!fix) return null;
  const km = distanceKm(fix.lat, fix.lon, mob.lat, mob.lon);
  return { distanceNm: km / KM_PER_NM, bearingDeg: initialBearingDeg(fix, mob) };
}
