import { describe, expect, it } from 'vitest';
import { pointInPolygon, pointSegmentDistanceKm } from './geo';

describe('pointSegmentDistanceKm', () => {
  it('is zero for a point on the segment', () => {
    expect(pointSegmentDistanceKm(48, -125.5, [48, -126], [48, -125])).toBeCloseTo(0, 6);
  });

  it('measures the perpendicular distance off the segment', () => {
    // 1 km north of the segment at lat 48 (1 deg lat = ~111.195 km).
    const oneKmNorth = 48 + 1 / 111.195;
    expect(pointSegmentDistanceKm(oneKmNorth, -125.5, [48, -126], [48, -125])).toBeCloseTo(1, 2);
  });

  it('falls back to the nearer endpoint beyond the segment ends', () => {
    // 1 deg of longitude at lat 48 is ~74.39 km; the point sits one degree
    // east of the segment's eastern end.
    expect(pointSegmentDistanceKm(48, -124, [48, -126], [48, -125])).toBeCloseTo(74.39, 1);
  });

  it('handles a zero-length segment as a point distance', () => {
    // Diagonal: 0.5 deg lat (~55.6 km) and 0.5 deg lon at lat 48 (~37.0 km).
    expect(pointSegmentDistanceKm(48.5, -125.5, [48, -125], [48, -125])).toBeCloseTo(66.9, 1);
  });
});

describe('pointInPolygon', () => {
  const square: [number, number][] = [
    [48, -126],
    [48, -125],
    [49, -125],
    [49, -126],
  ];

  it('finds an interior point', () => {
    expect(pointInPolygon(48.5, -125.5, square)).toBe(true);
  });

  it('rejects an exterior point', () => {
    expect(pointInPolygon(50, -125.5, square)).toBe(false);
  });

  it('counts a point on an edge as inside', () => {
    expect(pointInPolygon(48, -125.5, square)).toBe(true);
  });

  it('counts a vertex as inside', () => {
    expect(pointInPolygon(48, -126, square)).toBe(true);
  });
});
