import { describe, expect, it } from 'vitest';
import { advanceNavTarget, navTarget, shouldFollowPan } from './navigation';

const route = [
  { lat: 48.0, lon: -126.0 },
  { lat: 48.0, lon: -125.9 },
  { lat: 48.0, lon: -125.8 },
];

describe('navigation', () => {
  it('targets the second waypoint from the start, with distance and bearing', () => {
    const target = navTarget({ lat: 48.0, lon: -126.0 }, route, 1);
    expect(target?.index).toBe(1);
    expect(target?.distanceNm).toBeCloseTo(4.0, 0);
    expect(target?.bearingDeg).toBeCloseTo(90, 0);
  });

  it('returns null without a fix or with fewer than two waypoints', () => {
    expect(navTarget(null, route, 1)).toBeNull();
    expect(navTarget({ lat: 48.0, lon: -126.0 }, [route[0]], 1)).toBeNull();
  });

  it('advances past a waypoint inside arrival range and completes at the last', () => {
    expect(advanceNavTarget({ lat: 48.0, lon: -125.9 }, route, 1)).toEqual({
      index: 2,
      complete: false,
    });
    expect(advanceNavTarget({ lat: 48.0, lon: -125.8 }, route, 1)).toEqual({
      index: 2,
      complete: true,
    });
    expect(advanceNavTarget({ lat: 48.0, lon: -126.0 }, route, 1)).toEqual({
      index: 1,
      complete: false,
    });
  });

  it('only recentres the follow pan past a quarter of the view span', () => {
    expect(shouldFollowPan(48.0, -126.0, 48.0, -126.0, 1)).toBe(false);
    expect(shouldFollowPan(48.1, -126.0, 48.0, -126.0, 1)).toBe(false);
    expect(shouldFollowPan(48.3, -126.0, 48.0, -126.0, 1)).toBe(true);
    expect(shouldFollowPan(48.0, -125.7, 48.0, -126.0, 1)).toBe(true);
  });
});
