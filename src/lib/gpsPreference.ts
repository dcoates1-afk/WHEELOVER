export type GpsMode = 'on' | 'off';

export const GPS_STORAGE_KEY = 'wheel-over:gps-mode';
const LEGACY_GPS_STORAGE_KEYS = ['leeward:gps-mode', 'marnav:gps-mode'] as const;
export const GPS_DEFAULT: GpsMode = 'on';

export function parseGpsMode(value: unknown): GpsMode {
  return value === 'off' ? 'off' : 'on';
}

export function readGpsMode(storage: Pick<Storage, 'getItem'> | null | undefined): GpsMode {
  if (!storage) return GPS_DEFAULT;
  try {
    const raw =
      storage.getItem(GPS_STORAGE_KEY) ??
      LEGACY_GPS_STORAGE_KEYS.map((key) => storage.getItem(key)).find((value) => value !== null);
    return parseGpsMode(raw);
  } catch {
    return GPS_DEFAULT;
  }
}

export function writeGpsMode(
  storage: Pick<Storage, 'setItem'> | null | undefined,
  mode: GpsMode,
): void {
  if (!storage) return;
  try {
    storage.setItem(GPS_STORAGE_KEY, mode);
  } catch {
    // Private mode or blocked storage: the in-memory setting still applies.
  }
}
