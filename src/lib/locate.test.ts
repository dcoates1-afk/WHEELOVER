import { describe, expect, it } from 'vitest';
import {
  LAST_FIX_KEY,
  LAST_FIX_MAX_AGE_MS,
  openingView,
  parseLastFix,
  readLastFix,
  shouldAutoCentre,
  writeLastFix,
} from './locate';

const NOW = Date.UTC(2026, 9, 18, 12, 0, 0);

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

describe('cached position', () => {
  it('accepts a recent, sane fix', () => {
    const raw = JSON.stringify({ lat: 50.7612, lon: -1.2012, at: NOW - 60_000 });
    expect(parseLastFix(raw, NOW)).toEqual({ lat: 50.7612, lon: -1.2012, at: NOW - 60_000 });
  });

  it('rejects junk, impossible coordinates and stale fixes', () => {
    expect(parseLastFix(null, NOW)).toBeNull();
    expect(parseLastFix('not json', NOW)).toBeNull();
    expect(parseLastFix(JSON.stringify({ lat: 'x', lon: -1, at: NOW }), NOW)).toBeNull();
    expect(parseLastFix(JSON.stringify({ lat: 91, lon: -1, at: NOW }), NOW)).toBeNull();
    expect(parseLastFix(JSON.stringify({ lat: 50, lon: 181, at: NOW }), NOW)).toBeNull();
    expect(parseLastFix(JSON.stringify({ lat: 50, lon: -1, at: NOW - LAST_FIX_MAX_AGE_MS - 1 }), NOW)).toBeNull();
    // A fix stamped in the future means a clock problem, not a position.
    expect(parseLastFix(JSON.stringify({ lat: 50, lon: -1, at: NOW + 10 * 60_000 }), NOW)).toBeNull();
  });

  it('imports fixes from previous prefixes and writes to WHEELOVER storage', () => {
    const leewardFix = JSON.stringify({ lat: 50.7612, lon: -1.2012, at: NOW });
    expect(readLastFix(fakeStorage({ 'leeward:last-fix': leewardFix }), NOW)).toEqual({
      lat: 50.7612,
      lon: -1.2012,
      at: NOW,
    });
    const storage = fakeStorage({ 'marnav:last-fix': leewardFix });
    expect(readLastFix(storage, NOW)).toEqual({ lat: 50.7612, lon: -1.2012, at: NOW });
    writeLastFix(storage, { lat: 50.8, lon: -1.3, timestamp: NOW });
    expect(storage.getItem(LAST_FIX_KEY)).toContain('50.8');
  });

  it('round-trips through storage and tolerates blocked storage', () => {
    const storage = fakeStorage();
    writeLastFix(storage, { lat: 50.7612, lon: -1.2012, timestamp: NOW });
    expect(readLastFix(storage, NOW)).toEqual({ lat: 50.7612, lon: -1.2012, at: NOW });
    expect(readLastFix(null, NOW)).toBeNull();
    expect(readLastFix(fakeStorage({ [LAST_FIX_KEY]: '{oops' }), NOW)).toBeNull();

    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(() => writeLastFix(blocked, { lat: 50, lon: -1, timestamp: NOW })).not.toThrow();
    expect(readLastFix(blocked, NOW)).toBeNull();
  });

  it('never stores a fix it would reject on read', () => {
    const storage = fakeStorage();
    writeLastFix(storage, { lat: 200, lon: 0, timestamp: NOW });
    expect(storage.getItem(LAST_FIX_KEY)).toBeNull();
  });
});

describe('auto-centring', () => {
  const base = { hasFix: true, hasDeepLink: false, userMoved: false, alreadyCentred: false };

  it('centres only on the first fix of an untouched session', () => {
    expect(shouldAutoCentre(base)).toBe(true);
  });

  it('stands down for a deep link, a pan, or a completed centre', () => {
    expect(shouldAutoCentre({ ...base, hasFix: false })).toBe(false);
    expect(shouldAutoCentre({ ...base, hasDeepLink: true })).toBe(false);
    expect(shouldAutoCentre({ ...base, userMoved: true })).toBe(false);
    expect(shouldAutoCentre({ ...base, alreadyCentred: true })).toBe(false);
  });

  it('prefers the deep link, then the cached fix, then nothing', () => {
    const cached = { lat: 50.7612, lon: -1.2012, at: NOW };
    expect(openingView({ lat: 40.7, lon: -74.03 }, cached)).toEqual({ lat: 40.7, lon: -74.03 });
    expect(openingView(null, cached)).toEqual({ lat: 50.7612, lon: -1.2012 });
    expect(openingView(null, null)).toBeNull();
  });
});
