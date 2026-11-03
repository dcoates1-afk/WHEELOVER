import { describe, expect, it } from 'vitest';
import {
  createPin,
  isValidPin,
  loadPins,
  removePin,
  updatePin,
  writePins,
  type Pin,
} from './pins';

function memoryStorage(initial?: Record<string, string>): Storage {
  const store = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => [...store.keys()][index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  } as Storage;
}

const good: Pin = {
  id: 'pin-1',
  lat: 50.76,
  lon: -1.3,
  title: 'Cowes',
  note: 'Fuel here',
  createdAt: 100,
};

describe('loadPins', () => {
  it('returns stored pins oldest first and drops malformed rows', () => {
    const storage = memoryStorage({
      'wheel-over:pins': JSON.stringify([
        { ...good, id: 'pin-2', createdAt: 200 },
        good,
        { id: 'bad', lat: 999, lon: 0, title: 'x', note: '', createdAt: 50 },
        'not an object',
      ]),
    });
    expect(loadPins(storage).map((pin) => pin.id)).toEqual(['pin-1', 'pin-2']);
  });

  it('returns nothing for missing, corrupt, or non-array data', () => {
    expect(loadPins(memoryStorage())).toEqual([]);
    expect(loadPins(memoryStorage({ 'wheel-over:pins': '{bad json' }))).toEqual([]);
    expect(loadPins(memoryStorage({ 'wheel-over:pins': '{"a":1}' }))).toEqual([]);
    expect(loadPins(null)).toEqual([]);
  });
});

describe('writePins / round trip', () => {
  it('writes pins that load back identically', () => {
    const storage = memoryStorage();
    writePins(storage, [good]);
    expect(loadPins(storage)).toEqual([good]);
  });
});

describe('createPin', () => {
  it('builds a valid pin with a default title', () => {
    const pin = createPin(48.42, -123.37);
    expect(isValidPin(pin)).toBe(true);
    expect(pin.lat).toBe(48.42);
    expect(pin.title).toBe('Pinned place');
  });
});

describe('updatePin / removePin', () => {
  it('updates only the named pin', () => {
    const updated = updatePin([good], 'pin-1', { title: 'New name' });
    expect(updated[0]?.title).toBe('New name');
    expect(updated[0]?.note).toBe('Fuel here');
    expect(updatePin([good], 'other', { title: 'Nope' })).toEqual([good]);
  });

  it('removes only the named pin', () => {
    expect(removePin([good, { ...good, id: 'pin-2' }], 'pin-1').map((p) => p.id)).toEqual(['pin-2']);
  });
});
