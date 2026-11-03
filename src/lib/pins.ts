/**
 * Local place pins: the navigator's own marks on the chart, kept only on
 * this device in localStorage. No account, no server, nothing leaves the
 * device — the shared-pins version waits on the accounts project.
 */

export interface Pin {
  id: string;
  lat: number;
  lon: number;
  title: string;
  note: string;
  createdAt: number;
}

export const PINS_STORAGE_KEY = 'wheel-over:pins';

export function createPin(lat: number, lon: number): Pin {
  return {
    id: `pin-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
    lat,
    lon,
    title: 'Pinned place',
    note: '',
    createdAt: Date.now(),
  };
}

export function isValidPin(value: unknown): value is Pin {
  if (!value || typeof value !== 'object') return false;
  const pin = value as Partial<Pin>;
  return (
    typeof pin.id === 'string' &&
    pin.id.length > 0 &&
    typeof pin.lat === 'number' &&
    Number.isFinite(pin.lat) &&
    pin.lat >= -90 &&
    pin.lat <= 90 &&
    typeof pin.lon === 'number' &&
    Number.isFinite(pin.lon) &&
    pin.lon >= -180 &&
    pin.lon <= 180 &&
    typeof pin.title === 'string' &&
    typeof pin.note === 'string' &&
    typeof pin.createdAt === 'number' &&
    Number.isFinite(pin.createdAt)
  );
}

/** Stored pins, oldest first; anything malformed is dropped, never trusted. */
export function loadPins(storage: Storage | null): Pin[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(PINS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidPin).sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
  }
}

export function writePins(storage: Storage | null, pins: Pin[]): void {
  if (!storage) return;
  try {
    storage.setItem(PINS_STORAGE_KEY, JSON.stringify(pins));
  } catch {
    // A full or unavailable store just means pins do not persist.
  }
}

export function updatePin(
  pins: Pin[],
  id: string,
  patch: Partial<Pick<Pin, 'title' | 'note'>>,
): Pin[] {
  return pins.map((pin) => (pin.id === id ? { ...pin, ...patch } : pin));
}

export function removePin(pins: Pin[], id: string): Pin[] {
  return pins.filter((pin) => pin.id !== id);
}
