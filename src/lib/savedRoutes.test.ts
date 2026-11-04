import { describe, expect, it } from 'vitest';
import {
  createSavedRoute,
  isValidSavedRoute,
  loadSavedRoutes,
  writeSavedRoutes,
  type SavedRoute,
} from './savedRoutes';

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

const points = [
  { lat: 48.0, lon: -126.0 },
  { lat: 48.0, lon: -125.9 },
];

describe('savedRoutes', () => {
  it('creates a route with a fresh id and copied waypoints', () => {
    const saved = createSavedRoute('Test Route', points, 6, 1000);
    expect(saved.name).toBe('Test Route');
    expect(saved.speedKnots).toBe(6);
    expect(saved.createdAt).toBe(1000);
    expect(saved.waypoints).toEqual(points);
    expect(saved.waypoints).not.toBe(points);
    expect(saved.waypoints[0]).not.toBe(points[0]);
  });

  it('rejects single-waypoint, bad-speed, and nameless rows', () => {
    expect(isValidSavedRoute({ ...createSavedRoute('A', points, 6), waypoints: [points[0]] })).toBe(false);
    expect(isValidSavedRoute({ ...createSavedRoute('A', points, 6), speedKnots: 0 })).toBe(false);
    expect(isValidSavedRoute({ ...createSavedRoute('A', points, 6), name: '' })).toBe(false);
    expect(isValidSavedRoute(null)).toBe(false);
  });

  it('round-trips through storage newest first and drops malformed rows', () => {
    const storage = memoryStorage();
    const good: SavedRoute = createSavedRoute('Good', points, 6, 2000);
    const older: SavedRoute = createSavedRoute('Older', points, 5, 1000);
    const bad = { id: 'x', name: 'Bad', waypoints: [{ lat: 999, lon: 0 }], speedKnots: 6, createdAt: 3000 };
    writeSavedRoutes(storage, [good, bad as SavedRoute, older]);
    expect(loadSavedRoutes(storage).map((route) => route.name)).toEqual(['Good', 'Older']);
  });

  it('returns [] without storage or with corrupt JSON', () => {
    expect(loadSavedRoutes(null)).toEqual([]);
    expect(loadSavedRoutes(memoryStorage({ 'wheel-over:saved-routes': 'not json' }))).toEqual([]);
  });
});
