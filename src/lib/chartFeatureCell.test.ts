import { describe, expect, it } from 'vitest';
import { LAGGING_GRACE_MS, snapChartFeatureBounds } from '../../server/overpassProxy';

describe('bridge and area overlay fetch cells', () => {
  it('rounds a chart view out to the cell that contains it', () => {
    expect(snapChartFeatureBounds([50.9079, -1.3927, 50.925, -1.3732]))
      .toEqual([50.9, -1.4, 50.95, -1.35]);
  });

  it('never shrinks the view it was given', () => {
    const view: [number, number, number, number] = [48.4381, -123.3871, 48.4402, -123.3829];
    const cell = snapChartFeatureBounds(view);
    expect(cell[0]).toBeLessThanOrEqual(view[0]);
    expect(cell[1]).toBeLessThanOrEqual(view[1]);
    expect(cell[2]).toBeGreaterThanOrEqual(view[2]);
    expect(cell[3]).toBeGreaterThanOrEqual(view[3]);
  });

  it('gives two small pans over the same water the same cell, so the answer is reused', () => {
    const first = snapChartFeatureBounds([50.9165, -1.383, 50.9188, -1.379]);
    const panned = snapChartFeatureBounds([50.9192, -1.3821, 50.9214, -1.3778]);
    expect(panned).toEqual(first);
  });

  it('frames a wider view without changing it', () => {
    expect(snapChartFeatureBounds([49, -124, 50, -123])).toEqual([49, -124, 50, -123]);
  });
});

describe('mirror race timing', () => {
  it('uses a usable reply within a short bound instead of waiting out a dead mirror', () => {
    expect(LAGGING_GRACE_MS).toBeLessThanOrEqual(10_000);
  });
});
