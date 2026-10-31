import { describe, expect, it } from 'vitest';
import {
  ANCHOR_RADIUS_DEFAULT_M,
  ANCHOR_RADIUS_MAX_M,
  ANCHOR_RADIUS_MIN_M,
  COURSE_TOLERANCE_DEFAULT_DEG,
  DEFAULT_VOYAGE_WATCH,
  VOYAGE_STORAGE_KEY,
  formatWatchAge,
  normalizeBearing,
  parseCourseDeg,
  parseRadiusM,
  parseToleranceDeg,
  readVoyageWatch,
  sanitizeVoyageWatch,
  writeVoyageWatch,
} from './voyageWatch';

function storage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    dump: () => map,
  };
}

const anchor = { lat: 50.76, lon: -1.2, radiusM: 40, droppedAt: 1_700_000_000_000 };

describe('anchor and course entries', () => {
  it('parses a swing circle within range', () => {
    expect(parseRadiusM('45')).toBe(45);
    expect(parseRadiusM(90)).toBe(90);
    expect(parseRadiusM(String(ANCHOR_RADIUS_MIN_M))).toBe(ANCHOR_RADIUS_MIN_M);
    expect(parseRadiusM(String(ANCHOR_RADIUS_MAX_M))).toBe(ANCHOR_RADIUS_MAX_M);
  });

  it('rejects an implausible circle', () => {
    expect(parseRadiusM('')).toBeNull();
    expect(parseRadiusM('5')).toBeNull();
    expect(parseRadiusM('900')).toBeNull();
    expect(parseRadiusM('wide')).toBeNull();
  });

  it('normalises a typed course into 0–360', () => {
    expect(parseCourseDeg('042')).toBe(42);
    expect(parseCourseDeg('400')).toBe(40);
    expect(parseCourseDeg('-10')).toBe(350);
    expect(parseCourseDeg('')).toBeNull();
    expect(normalizeBearing(359.97)).toBe(360 - 0);
  });

  it('keeps the tolerance inside its limits', () => {
    expect(parseToleranceDeg('20')).toBe(20);
    expect(parseToleranceDeg('1')).toBeNull();
    expect(parseToleranceDeg('90')).toBeNull();
  });
});

describe('stored watch', () => {
  it('round-trips through storage', () => {
    const store = storage();
    writeVoyageWatch(store, { anchor, course: { bearingDeg: 42, toleranceDeg: 20 } });
    expect(readVoyageWatch(store)).toEqual({ anchor, course: { bearingDeg: 42, toleranceDeg: 20 } });
  });

  it('starts empty when nothing is stored', () => {
    expect(readVoyageWatch(storage())).toEqual(DEFAULT_VOYAGE_WATCH);
    expect(readVoyageWatch(null)).toEqual(DEFAULT_VOYAGE_WATCH);
  });

  it('survives corrupt storage', () => {
    expect(readVoyageWatch(storage({ [VOYAGE_STORAGE_KEY]: '{not json' }))).toEqual(DEFAULT_VOYAGE_WATCH);
  });

  it('drops an anchor without a usable position', () => {
    expect(sanitizeVoyageWatch({ anchor: { lat: 91, lon: 0 } }).anchor).toBeNull();
    expect(sanitizeVoyageWatch({ anchor: { lat: 'north', lon: 0 } }).anchor).toBeNull();
  });

  it('fills in the default circle and tolerance', () => {
    const watch = sanitizeVoyageWatch({
      anchor: { lat: 50.76, lon: -1.2 },
      course: { bearingDeg: 120 },
    });
    expect(watch.anchor?.radiusM).toBe(ANCHOR_RADIUS_DEFAULT_M);
    expect(watch.anchor?.droppedAt).toBeGreaterThan(0);
    expect(watch.course?.toleranceDeg).toBe(COURSE_TOLERANCE_DEFAULT_DEG);
  });

  it('clamps a stored radius and tolerance instead of trusting them', () => {
    const watch = sanitizeVoyageWatch({
      anchor: { ...anchor, radiusM: 9000 },
      course: { bearingDeg: 42, toleranceDeg: 400 },
    });
    expect(watch.anchor?.radiusM).toBe(ANCHOR_RADIUS_MAX_M);
    expect(watch.course?.toleranceDeg).toBe(60);
  });
});

describe('watch age', () => {
  it('reads in minutes and hours', () => {
    expect(formatWatchAge(20_000)).toBe('just now');
    expect(formatWatchAge(24 * 60_000)).toBe('24 min');
    expect(formatWatchAge(3 * 60 * 60_000 + 10 * 60_000)).toBe('3 h 10 m');
    expect(formatWatchAge(2 * 60 * 60_000)).toBe('2 h');
    expect(formatWatchAge(-5)).toBe('—');
  });
});
