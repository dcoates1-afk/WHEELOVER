import { describe, expect, it } from 'vitest';
import { summarizeChartFeatureStats } from '../../server/overpassProxy';

describe('chart-feature coverage stats', () => {
  it('describes the most recent live fetch for the disclaimer page', () => {
    expect(summarizeChartFeatureStats(JSON.stringify({
      fetchedAt: 1_790_000_000_000,
      sourceTimestamp: 1_789_000_000_000,
      objects: 1114,
      bridges: 54,
      areas: 9,
      behind: false,
    }))).toEqual({
      fetchedAt: 1_790_000_000_000,
      sourceTimestamp: 1_789_000_000_000,
      objects: 1114,
      bridges: 54,
      areas: 9,
      behind: false,
    });
  });

  it('keeps the counts when the mirror reported no snapshot time', () => {
    expect(summarizeChartFeatureStats(JSON.stringify({
      fetchedAt: 1,
      sourceTimestamp: null,
      objects: 12,
      bridges: 8,
      areas: 4,
    }))).toEqual({
      fetchedAt: 1,
      sourceTimestamp: null,
      objects: 12,
      bridges: 8,
      areas: 4,
      behind: false,
    });
  });

  it('reports a mirror that was behind current data', () => {
    const stats = summarizeChartFeatureStats(JSON.stringify({
      fetchedAt: 1,
      sourceTimestamp: 1_000,
      objects: 5,
      bridges: 2,
      areas: 3,
      behind: true,
    }));
    expect(stats?.behind).toBe(true);
  });

  it('defaults a file written before the split to zero drawn features', () => {
    expect(summarizeChartFeatureStats(JSON.stringify({ objects: 300, fetchedAt: 1 })))
      .toEqual({ fetchedAt: 1, sourceTimestamp: null, objects: 300, bridges: 0, areas: 0, behind: false });
  });

  it('adds the two halves of one chart view into a single coverage line', () => {
    const stats = summarizeChartFeatureStats(JSON.stringify({
      cell: '50.883,-1.417,50.933,-1.367',
      parts: {
        bridges: { fetchedAt: 2_000, sourceTimestamp: 1_500, objects: 553, count: 92, behind: false },
        areas: { fetchedAt: 2_400, sourceTimestamp: 1_400, objects: 40, count: 12, behind: false },
      },
    }));
    expect(stats).toEqual({
      fetchedAt: 2_400,
      // The older half dates the view, so the line never claims fresher data than shown.
      sourceTimestamp: 1_400,
      objects: 593,
      bridges: 92,
      areas: 12,
      behind: false,
    });
  });

  it('reports one half that has arrived without inventing the other', () => {
    const stats = summarizeChartFeatureStats(JSON.stringify({
      cell: '50.883,-1.417,50.933,-1.367',
      parts: { bridges: { fetchedAt: 2_000, sourceTimestamp: null, objects: 553, count: 92, behind: true } },
    }));
    expect(stats?.bridges).toBe(92);
    expect(stats?.areas).toBe(0);
    expect(stats?.behind).toBe(true);
  });

  it('rejects a file whose halves are empty', () => {
    expect(summarizeChartFeatureStats(JSON.stringify({ cell: '1,2,3,4', parts: {} }))).toBeNull();
  });

  it('rejects a missing, empty or malformed file', () => {
    expect(summarizeChartFeatureStats(null)).toBeNull();
    expect(summarizeChartFeatureStats('not json')).toBeNull();
    expect(summarizeChartFeatureStats(JSON.stringify({ objects: 0, fetchedAt: 1 }))).toBeNull();
    expect(summarizeChartFeatureStats(JSON.stringify({ objects: 'many', fetchedAt: 1 }))).toBeNull();
  });
});
