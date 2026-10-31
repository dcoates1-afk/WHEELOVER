/**
 * The two things an alert can watch while under way: the anchor the boat is
 * swinging on, and the course the helmsman is steering.
 *
 * Both are set from the live fix, so neither alert needs a route planner behind
 * it: dropping the anchor records where the boat is and how much circle it can
 * swing through, and setting a course records the bearing to steer. They are
 * kept on this device only.
 */

export interface AnchorWatch {
  lat: number;
  lon: number;
  radiusM: number;
  droppedAt: number;
}

export interface CourseWatch {
  bearingDeg: number;
  toleranceDeg: number;
}

export interface VoyageWatch {
  anchor: AnchorWatch | null;
  course: CourseWatch | null;
}

export const VOYAGE_STORAGE_KEY = 'wheel-over:voyage-watch';

export const ANCHOR_RADIUS_DEFAULT_M = 30;
export const ANCHOR_RADIUS_MIN_M = 10;
export const ANCHOR_RADIUS_MAX_M = 500;
export const COURSE_TOLERANCE_DEFAULT_DEG = 15;
export const COURSE_TOLERANCE_MIN_DEG = 3;
export const COURSE_TOLERANCE_MAX_DEG = 60;

export const DEFAULT_VOYAGE_WATCH: VoyageWatch = { anchor: null, course: null };

function finite(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(number) ? number : null;
}

/** Degrees true, 0–359.9, from whatever the helmsman typed. */
export function normalizeBearing(value: number): number {
  const wrapped = ((value % 360) + 360) % 360;
  return Math.round(wrapped * 10) / 10;
}

/** A swing circle in metres, or null when the figure is not plausible. */
export function parseRadiusM(raw: string | number | null | undefined): number | null {
  const value = finite(raw);
  if (value === null || value < ANCHOR_RADIUS_MIN_M || value > ANCHOR_RADIUS_MAX_M) return null;
  return Math.round(value);
}

export function clampRadiusM(value: number): number {
  return Math.min(ANCHOR_RADIUS_MAX_M, Math.max(ANCHOR_RADIUS_MIN_M, Math.round(value)));
}

/** A course to steer in degrees true, or null when the entry is unusable. */
export function parseCourseDeg(raw: string | number | null | undefined): number | null {
  const value = finite(raw);
  if (value === null) return null;
  return normalizeBearing(value);
}

export function parseToleranceDeg(raw: string | number | null | undefined): number | null {
  const value = finite(raw);
  if (value === null || value < COURSE_TOLERANCE_MIN_DEG || value > COURSE_TOLERANCE_MAX_DEG) {
    return null;
  }
  return Math.round(value);
}

export function sanitizeAnchorWatch(value: unknown): AnchorWatch | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Partial<AnchorWatch>;
  const lat = finite(input.lat);
  const lon = finite(input.lon);
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const radius = finite(input.radiusM);
  const droppedAt = finite(input.droppedAt);
  return {
    lat,
    lon,
    radiusM: radius === null ? ANCHOR_RADIUS_DEFAULT_M : clampRadiusM(radius),
    droppedAt: droppedAt ?? Date.now(),
  };
}

export function sanitizeCourseWatch(value: unknown): CourseWatch | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Partial<CourseWatch>;
  const bearing = finite(input.bearingDeg);
  if (bearing === null) return null;
  const tolerance = finite(input.toleranceDeg);
  return {
    bearingDeg: normalizeBearing(bearing),
    toleranceDeg:
      tolerance === null
        ? COURSE_TOLERANCE_DEFAULT_DEG
        : Math.min(COURSE_TOLERANCE_MAX_DEG, Math.max(COURSE_TOLERANCE_MIN_DEG, Math.round(tolerance))),
  };
}

export function sanitizeVoyageWatch(value: unknown): VoyageWatch {
  if (!value || typeof value !== 'object') return { ...DEFAULT_VOYAGE_WATCH };
  const input = value as Partial<VoyageWatch>;
  return {
    anchor: sanitizeAnchorWatch(input.anchor),
    course: sanitizeCourseWatch(input.course),
  };
}

export function readVoyageWatch(
  storage: Pick<Storage, 'getItem'> | null | undefined,
): VoyageWatch {
  if (!storage) return { ...DEFAULT_VOYAGE_WATCH };
  try {
    const raw = storage.getItem(VOYAGE_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_VOYAGE_WATCH };
    return sanitizeVoyageWatch(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_VOYAGE_WATCH };
  }
}

export function writeVoyageWatch(
  storage: Pick<Storage, 'setItem'> | null | undefined,
  watch: VoyageWatch,
): void {
  if (!storage) return;
  try {
    storage.setItem(VOYAGE_STORAGE_KEY, JSON.stringify(watch));
  } catch {
    // Storage blocked: the watch still applies for this session.
  }
}

/** Compact age for the alert cards and the menu: "just now", "24 min", "3 h 10 m". */
export function formatWatchAge(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} m`;
}
