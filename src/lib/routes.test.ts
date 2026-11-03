import { describe, expect, it } from 'vitest';
import { initialBearingDeg, routeTotals } from './routes';

describe('initialBearingDeg', () => {
  it('starts slightly north of east along a parallel (great-circle curve)', () => {
    // A great circle between two points on the same northern parallel does
    // not follow the parallel: it starts toward the pole, so the initial
    // bearing is 89.63 deg, not exactly 90.
    expect(initialBearingDeg({ lat: 48, lon: -126 }, { lat: 48, lon: -125 })).toBeCloseTo(89.63, 1);
  });

  it('is due north along a meridian', () => {
    expect(initialBearingDeg({ lat: 48, lon: -126 }, { lat: 49, lon: -126 })).toBeCloseTo(0, 6);
  });

  it('is due south on the return leg', () => {
    expect(initialBearingDeg({ lat: 49, lon: -126 }, { lat: 48, lon: -126 })).toBeCloseTo(180, 6);
  });
});

describe('routeTotals', () => {
  it('is empty for fewer than two waypoints', () => {
    const totals = routeTotals([{ lat: 48, lon: -126 }], 10);
    expect(totals.legs).toHaveLength(0);
    expect(totals.totalNm).toBe(0);
    expect(totals.etaHours).toBe(0);
  });

  it('sums legs and divides by speed for ETA', () => {
    // Two 1-degree east legs at lat 48: ~74.39 km / ~40.17 NM each.
    const totals = routeTotals(
      [
        { lat: 48, lon: -126 },
        { lat: 48, lon: -125 },
        { lat: 48, lon: -124 },
      ],
      10,
    );
    expect(totals.legs).toHaveLength(2);
    expect(totals.legs[0].bearingDeg).toBeCloseTo(89.63, 1);
    expect(totals.totalNm).toBeCloseTo(80.34, 1);
    expect(totals.etaHours).toBeCloseTo(8.034, 2);
  });

  it('reports no ETA without a positive speed', () => {
    const totals = routeTotals(
      [
        { lat: 48, lon: -126 },
        { lat: 48, lon: -125 },
      ],
      0,
    );
    expect(totals.etaHours).toBeNull();
  });
});
