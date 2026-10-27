import { describe, expect, it } from 'vitest';
import { contourBoundsIntersect, contourManifestCoversBounds, contourShardsForBounds, loadContoursForBounds, validateContourManifest, type ContourManifest } from './marineContours';

const shard = {
  path: 'gebco-1/gebco-1_170_130.fgb',
  bounds: [49, -2, 50, -1] as [number, number, number, number],
  count: 12,
  totalBytes: 2048,
  source: 'GEBCO_2026',
  sourceId: 'gebco-1',
  attribution: 'GEBCO citation',
  datum: 'MSL assumption',
  resolutionDegrees: 0.0041667,
  contourProperty: 'elev_m' as const,
};

const manifest: ContourManifest = {
  schema: 1,
  generatedAt: '2026-10-23T00:00:00Z',
  bounds: [-90, -180, 90, 180],
  coverageBounds: [[49, -2, 50, -1]],
  shardDegrees: 10,
  contourLevelsMetres: [10, 25, 50],
  sources: [{ id: 'gebco-1', name: 'GEBCO_2026', attribution: 'GEBCO citation', datum: 'MSL assumption' }],
  shards: [shard],
  notice: 'Not for navigation',
};

describe('world contour manifest', () => {
  it('accepts the schema emitted by the local contour builder', () => {
    expect(validateContourManifest(manifest)).toEqual(manifest);
    expect(validateContourManifest(null)).toBeNull();
    expect(validateContourManifest({ ...manifest, coverageBounds: [] })).toBeNull();
    expect(validateContourManifest({ ...manifest, schema: 2 })).toBeNull();
  });

  it('rejects paths that can escape the configured contour archive', () => {
    expect(validateContourManifest({ ...manifest, shards: [{ ...shard, path: '../private/data.fgb' }] })).toBeNull();
    expect(validateContourManifest({ ...manifest, shards: [{ ...shard, path: '/outside.fgb' }] })).toBeNull();
  });

  it('rejects unsafe or unbounded shard descriptors', () => {
    expect(validateContourManifest({ ...manifest, shards: [{ ...shard, totalBytes: 0 }] })).toBeNull();
    expect(validateContourManifest({ ...manifest, shards: [{ ...shard, bounds: [91, -2, 92, -1] }] })).toBeNull();
  });

  it('selects only shards that intersect the map viewport', () => {
    const parsed = validateContourManifest(manifest)!;
    expect(contourBoundsIntersect(shard.bounds, [49.5, -1.5, 49.6, -1.4])).toBe(true);
    expect(contourBoundsIntersect(shard.bounds, [52, 2, 53, 3])).toBe(false);
    expect(contourShardsForBounds(parsed, [49.5, -1.5, 49.6, -1.4])).toEqual([shard]);
    expect(contourShardsForBounds(parsed, [52, 2, 53, 3])).toEqual([]);
    expect(contourManifestCoversBounds(parsed, [49.5, -1.5, 49.6, -1.4])).toBe(true);
    expect(contourManifestCoversBounds(parsed, [52, 2, 53, 3])).toBe(false);
  });

  it('requires complete viewport coverage rather than one intersecting coverage rectangle', () => {
    const split = validateContourManifest({
      ...manifest,
      coverageBounds: [
        [49, -2, 50, -1],
        [49, -1, 50, 0],
      ],
    })!;
    expect(contourManifestCoversBounds(split, [49, -2, 50, 0])).toBe(true);
    expect(contourManifestCoversBounds(split, [49, -2, 51, 0])).toBe(false);
    expect(contourManifestCoversBounds(split, [49, -2, 50, 1])).toBe(false);
  });

  it('refuses an unsafe global request that would download over 64 MiB at once', async () => {
    const many = Array.from({ length: 8 }, (_, index) => ({
      ...shard,
      path: `gebco-1/gebco-1_${index}.fgb`,
      bounds: [-80, -170 + index, 80, -169 + index] as [number, number, number, number],
      totalBytes: 9 * 1024 * 1024,
    }));
    const wide = validateContourManifest({ ...manifest, shards: many })!;
    await expect(loadContoursForBounds(wide, [-80, -170, 80, -160])).rejects.toThrow('64 MiB');
  });
});