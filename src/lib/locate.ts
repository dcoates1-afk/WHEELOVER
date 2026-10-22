/**
 * Where the chart opens, and when it may move itself to the vessel.
 *
 * A cold start cannot wait for a GPS fix, so the last fix is cached and used as
 * the opening position; the first live fix then refines it. Auto-centring is
 * deliberately conservative: a deep link, any pan/zoom by the user, or an
 * already-completed centre cancels it. A chart that keeps jumping away from
 * where the navigator put it is worse than one that starts slightly off.
 */

export interface CachedFix {
  lat: number;
  lon: number;
  at: number;
}

export const LAST_FIX_KEY = 'wheel-over:last-fix';
const LEGACY_LAST_FIX_KEYS = ['leeward:last-fix', 'marnav:last-fix'] as const;
export const LAST_FIX_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

type ReadableStorage = Pick<Storage, 'getItem'> | null | undefined;
type WritableStorage = Pick<Storage, 'setItem'> | null | undefined;

function isValidFix(value: unknown, now: number): value is CachedFix {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CachedFix>;
  const { lat, lon, at } = candidate;
  if (typeof lat !== 'number' || typeof lon !== 'number' || typeof at !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(at)) return false;
  if (Math.abs(lat) > 85 || Math.abs(lon) > 180) return false;
  if (at > now + 5 * 60 * 1000) return false;
  return now - at <= LAST_FIX_MAX_AGE_MS;
}

/** Parse a stored fix, rejecting junk, impossible coordinates and stale fixes. */
export function parseLastFix(raw: string | null | undefined, now = Date.now()): CachedFix | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isValidFix(parsed, now) ? { lat: parsed.lat, lon: parsed.lon, at: parsed.at } : null;
  } catch {
    return null;
  }
}

export function readLastFix(storage: ReadableStorage, now = Date.now()): CachedFix | null {
  if (!storage) return null;
  try {
    const raw =
      storage.getItem(LAST_FIX_KEY) ??
      LEGACY_LAST_FIX_KEYS.map((key) => storage.getItem(key)).find((value) => value !== null);
    return parseLastFix(raw, now);
  } catch {
    return null;
  }
}

export function writeLastFix(
  storage: WritableStorage,
  fix: { lat: number; lon: number; timestamp?: number },
): void {
  if (!storage) return;
  const at = fix.timestamp ?? Date.now();
  if (!isValidFix({ lat: fix.lat, lon: fix.lon, at }, Date.now())) return;
  try {
    storage.setItem(LAST_FIX_KEY, JSON.stringify({ lat: fix.lat, lon: fix.lon, at }));
  } catch {
    // Storage blocked or full: the chart still works, it just starts elsewhere.
  }
}

export interface AutoCentreState {
  hasFix: boolean;
  hasDeepLink: boolean;
  userMoved: boolean;
  alreadyCentred: boolean;
}

/** True only for the very first fix of a session the user has not overridden. */
export function shouldAutoCentre(state: AutoCentreState): boolean {
  return state.hasFix && !state.hasDeepLink && !state.userMoved && !state.alreadyCentred;
}

/** A live fix wins; the cached position is only a starting guess. */
export function openingView(
  deepLink: { lat: number; lon: number } | null,
  cached: CachedFix | null,
): { lat: number; lon: number } | null {
  if (deepLink) return deepLink;
  if (cached) return { lat: cached.lat, lon: cached.lon };
  return null;
}
