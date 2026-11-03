import { describe, expect, it } from 'vitest';
import { evaluateGrounding, sampleRoute, type GroundingSample } from './routeGrounding';

function sample(lat: number, lon: number, legIndex: number, elevation: number | null): GroundingSample {
  return { lat, lon, legIndex, elevation };
}

describe('sampleRoute', () => {
  it('samples about every 250 m along a leg', () => {
    // ~1.11 km of latitude at the equator.
    const points = sampleRoute([
      { lat: 0, lon: 0 },
      { lat: 0.01, lon: 0 },
    ]);
    expect(points.length).toBeGreaterThanOrEqual(5);
    expect(points.length).toBeLessThanOrEqual(7);
    expect(points[0].legIndex).toBe(0);
    expect(points[points.length - 1].lat).toBeCloseTo(0.01, 6);
  });

  it('returns nothing for fewer than two waypoints', () => {
    expect(sampleRoute([{ lat: 0, lon: 0 }])).toEqual([]);
  });
});

describe('evaluateGrounding', () => {
  it('flags land samples and keeps the highest elevation per leg', () => {
    const result = evaluateGrounding(
      [sample(0, 0, 0, 2), sample(0, 0.001, 0, 5), sample(0, 0.002, 0, -20)],
      2,
      1,
    );
    expect(result.flags).toHaveLength(1);
    expect(result.flags[0]).toMatchObject({ legIndex: 0, kind: 'land', count: 2, metres: 5 });
    expect(result.sampled).toBe(3);
  });

  it('flags water shallower than draught plus margin, worst spot first', () => {
    const result = evaluateGrounding(
      [sample(0, 0, 0, -1.5), sample(0, 0.001, 0, -2.5), sample(0, 0.002, 0, -30)],
      2,
      1,
    );
    expect(result.flags).toHaveLength(1);
    expect(result.flags[0]).toMatchObject({ legIndex: 0, kind: 'shallow', count: 2, metres: 1.5 });
  });

  it('passes water exactly at the required depth and deeper', () => {
    const result = evaluateGrounding([sample(0, 0, 0, -3), sample(0, 0.001, 0, -30)], 2, 1);
    expect(result.flags).toEqual([]);
  });

  it('counts null samples as unsampled, not as clear water', () => {
    const result = evaluateGrounding([sample(0, 0, 0, null), sample(0, 0.001, 0, -30)], 2, 1);
    expect(result.flags).toEqual([]);
    expect(result.sampled).toBe(1);
    expect(result.unsampled).toBe(1);
  });

  it('keeps land and shallow flags separate on the same leg', () => {
    const result = evaluateGrounding(
      [sample(0, 0, 0, 3), sample(0, 0.001, 0, -1)],
      2,
      1,
    );
    expect(result.flags.map((flag) => flag.kind).sort()).toEqual(['land', 'shallow']);
  });
});
