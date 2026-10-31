import { describe, expect, it } from 'vitest';
import {
  formatDepth,
  inEmodnetCoverage,
  parseEmodnetSample,
  parseGebcoIdentify,
  sampleOffsets,
} from './depthLabels';

describe('depth number formatting', () => {
  it('uses chart-style precision', () => {
    expect(formatDepth(3.24)).toBe('3.2');
    expect(formatDepth(0.6)).toBe('0.6');
    expect(formatDepth(0.04)).toBe('');
    expect(formatDepth(9.96)).toBe('10');
    expect(formatDepth(12.6)).toBe('13');
    expect(formatDepth(1234)).toBe('1234');
  });

  it('writes the number in the chosen depth unit', () => {
    expect(formatDepth(3.24, 'm')).toBe('3.2');
    expect(formatDepth(0.6, 'ft')).toBe('2.0');
    expect(formatDepth(3.24, 'ft')).toBe('11');
    expect(formatDepth(12.6, 'ft')).toBe('41');
    expect(formatDepth(12.6, 'fathoms')).toBe('6.9');
    expect(formatDepth(0.05, 'ft')).toBe('');
  });

  it('leaves land, nodata and missing values blank', () => {
    expect(formatDepth(null)).toBe('');
    expect(formatDepth(undefined)).toBe('');
    expect(formatDepth(0)).toBe('');
    expect(formatDepth(-4)).toBe('');
    expect(formatDepth(Number.NaN)).toBe('');
  });
});

describe('GEBCO identify parsing', () => {
  it('reads a multipoint response and keeps only water', () => {
    const parsed = parseGebcoIdentify({
      results: [
        { value: '-12.4', location: { x: -1.3, y: 50.7 } },
        { value: '30', location: { x: -1.25, y: 50.72 } },
        { value: '-32767', location: { x: -1.2, y: 50.75 } },
      ],
    });
    expect(parsed).toEqual([{ lat: 50.7, lon: -1.3, depth: 12.4 }]);
  });

  it('reads the single-point shape too', () => {
    expect(
      parseGebcoIdentify({ value: '-27', location: { x: -1, y: 50.5 } }),
    ).toEqual([{ lat: 50.5, lon: -1, depth: 27 }]);
  });

  it('ignores malformed entries', () => {
    expect(parseGebcoIdentify({ results: [{}] })).toEqual([]);
    expect(parseGebcoIdentify(null)).toEqual([]);
  });
});

describe('EMODnet depth parsing', () => {
  it('turns a negative elevation into a positive depth', () => {
    expect(parseEmodnetSample({ avg: -27.33, min: -27.46, max: -27.17 })).toBe(27.33);
  });

  it('rejects land and missing samples', () => {
    expect(parseEmodnetSample({ avg: 31.25 })).toBeNull();
    expect(parseEmodnetSample({})).toBeNull();
    expect(parseEmodnetSample(null)).toBeNull();
  });

  it('knows its European coverage', () => {
    expect(inEmodnetCoverage(50.76, -1.2)).toBe(true);
    expect(inEmodnetCoverage(40.7, -74.0)).toBe(false);
    expect(inEmodnetCoverage(-33.9, 18.4)).toBe(false);
  });
});

describe('label grid', () => {
  it('fills a desktop chart with a bounded number of staggered points', () => {
    const points = sampleOffsets(1280, 800);
    expect(points.length).toBeGreaterThan(20);
    expect(points.length).toBeLessThanOrEqual(72);
    expect(points.every(([x, y]) => x >= 64 && x <= 1216 && y >= 64 && y <= 736)).toBe(true);
    // Alternate rows are shifted, so the first two rows cannot start at the same x.
    const rows = new Map<number, number>();
    for (const [x, y] of points) if (!rows.has(y)) rows.set(y, x);
    const starts = [...rows.values()];
    expect(new Set(starts).size).toBeGreaterThan(1);
  });

  it('adapts to a phone without crowding it', () => {
    const points = sampleOffsets(390, 844);
    expect(points.length).toBeGreaterThanOrEqual(6);
    expect(points.length).toBeLessThanOrEqual(16);
  });

  it('returns nothing when the chart is smaller than the margins', () => {
    expect(sampleOffsets(100, 100)).toEqual([]);
  });
});
