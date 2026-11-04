import { describe, expect, it } from 'vitest';
import {
  clearMob,
  createMobRecord,
  isValidMobRecord,
  loadMob,
  mobRangeFromFix,
  writeMob,
} from './mob';

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

describe('mob', () => {
  it('round-trips a record and clears it', () => {
    const storage = memoryStorage();
    const record = createMobRecord(48.0, -126.0, true, 1000);
    writeMob(storage, record);
    expect(loadMob(storage)).toEqual(record);
    clearMob(storage);
    expect(loadMob(storage)).toBeNull();
  });

  it('rejects out-of-range and malformed rows', () => {
    expect(isValidMobRecord({ lat: 91, lon: 0, at: 1, fromGps: true })).toBe(false);
    expect(isValidMobRecord({ lat: 48, lon: -126, at: 1 })).toBe(false);
    expect(loadMob(memoryStorage({ 'wheel-over:mob': '{"lat":48}' }))).toBeNull();
    expect(loadMob(null)).toBeNull();
  });

  it('computes range and bearing from a fix, null without one', () => {
    const mob = createMobRecord(48.0, -125.9, true, 1000);
    const range = mobRangeFromFix({ lat: 48.0, lon: -126.0 }, mob);
    expect(range).not.toBeNull();
    // 0.1 degrees of longitude at latitude 48 is about 4.0 NM due east.
    expect(range!.distanceNm).toBeCloseTo(4.0, 0);
    expect(range!.bearingDeg).toBeCloseTo(90, 0);
    expect(mobRangeFromFix(null, mob)).toBeNull();
  });
});
