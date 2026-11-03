import { describe, expect, it } from 'vitest';
import {
  CHART_FEATURE_STORE_FRESH_MS,
  CHART_FEATURE_STORE_STALE_MS,
  readChartFeatureCell,
  storedCellStatus,
  writeChartFeatureCell,
} from './chartFeatureStore';

describe('storedCellStatus', () => {
  it('is fresh inside six hours, stale inside thirty days, expired after', () => {
    const now = Date.now();
    expect(storedCellStatus(now, now)).toBe('fresh');
    expect(storedCellStatus(now - CHART_FEATURE_STORE_FRESH_MS + 1000, now)).toBe('fresh');
    expect(storedCellStatus(now - CHART_FEATURE_STORE_FRESH_MS, now)).toBe('stale');
    expect(storedCellStatus(now - CHART_FEATURE_STORE_STALE_MS + 1000, now)).toBe('stale');
    expect(storedCellStatus(now - CHART_FEATURE_STORE_STALE_MS, now)).toBe('expired');
  });
});

describe('chart feature store without IndexedDB', () => {
  it('reads as a miss and writes as a no-op, never throwing', async () => {
    await expect(readChartFeatureCell('bridges:test')).resolves.toBeNull();
    await expect(writeChartFeatureCell('bridges:test', [], Date.now())).resolves.toBeUndefined();
  });
});
