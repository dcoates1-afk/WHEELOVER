import { describe, expect, it } from 'vitest';
import { describeTssFeature, marineBoundsIntersect, marineShardsForBounds, tssGeometryParts, validateMarineManifest } from './marineDb';
import { DEFAULT_PREFERENCES, readChartPreferences } from './chartPreferences';

const manifest = validateMarineManifest({
  schema: 1,
  version: 'test',
  generatedAt: '2026-01-01T00:00:00.000Z',
  cellSize: 5,
  layers: {
    navaids: { count: 0, shards: [] },
    ferries: { count: 1, shards: [{ path: 'ferries/28_35.json', bounds: [50, -5, 55, 0], count: 1 }] },
    bridges: { count: 0, shards: [] },
    tss: { count: 0, shards: [] },
  },
});

describe('worldwide marine archive index', () => {
  it('validates the versioned manifest and rejects unsupported data', () => {
    expect(manifest?.version).toBe('test');
    expect(validateMarineManifest({ ...manifest, schema: 2 })).toBeNull();
    expect(validateMarineManifest({ ...manifest, layers: {} })).toBeNull();
  });

  it('selects only shards intersecting the map viewport', () => {
    expect(manifest).not.toBeNull();
    expect(marineShardsForBounds(manifest!, 'ferries', [51, -2, 52, -1])).toHaveLength(1);
    expect(marineShardsForBounds(manifest!, 'ferries', [20, 20, 21, 21])).toHaveLength(0);
    expect(marineShardsForBounds(manifest!, 'tss', [51, -2, 52, -1])).toHaveLength(0);
    expect(marineShardsForBounds(manifest!, 'bridges', [51, -2, 52, -1])).toHaveLength(0);
    expect(marineShardsForBounds(manifest!, 'bridges', [20, 20, 21, 21])).toHaveLength(0);
  });

  it('starts ferries and TSS enabled so route data remains visible by default', () => {
    expect(DEFAULT_PREFERENCES.overlays.ferries).toBe(true);
    expect(DEFAULT_PREFERENCES.overlays.tss).toBe(true);
    const migrated = readChartPreferences({
      getItem: () => JSON.stringify({ overlays: { ferries: false, tss: false } }),
    });
    expect(migrated.overlays).toMatchObject({ ferries: true, tss: true });
  });

  it('preserves disconnected TSS components rather than drawing artificial joins', () => {
    const feature = {
      id: 'tss:r321',
      type: 'separation_lane',
      name: 'Multipart traffic lane',
      bounds: [50, -5, 51, -4] as [number, number, number, number],
      path: [[50, -5], [50.1, -4.9]] as [number, number][],
      paths: [
        [[50, -5], [50.1, -4.9]],
        [[50.8, -4.2], [51, -4]],
      ] as [number, number][][],
      polygons: [[
        [[50, -5], [50, -4.8], [50.2, -4.8], [50, -5]],
        [[50.05, -4.98], [50.08, -4.98], [50.08, -4.95], [50.05, -4.98]],
      ]] as [number, number][][][],
    };

    expect(tssGeometryParts(feature)).toEqual([
      { kind: 'polygon', coordinates: feature.polygons[0] },
      { kind: 'line', coordinates: feature.paths[0] },
      { kind: 'line', coordinates: feature.paths[1] },
    ]);
    expect(tssGeometryParts({ ...feature, polygons: undefined })).toEqual([
      { kind: 'line', coordinates: feature.paths[0] },
      { kind: 'line', coordinates: feature.paths[1] },
    ]);
  });

  it('keeps legacy closed-zone geometries as polygons and lines as lines', () => {
    const base = {
      id: 'tss:w654',
      type: 'separation_zone',
      name: 'Legacy feature',
      bounds: [50, -5, 51, -4] as [number, number, number, number],
    };
    expect(tssGeometryParts({ ...base, path: [[50, -5], [50, -4], [51, -4], [50, -5]] })).toEqual([
      { kind: 'polygon', coordinates: [[[50, -5], [50, -4], [51, -4], [50, -5]]] },
    ]);
    expect(tssGeometryParts({ ...base, path: [[50, -5], [51, -4]] })).toEqual([
      { kind: 'line', coordinates: [[50, -5], [51, -4]] },
    ]);
  });

  it('formats TSS popup details and produces a direct OSM source link', () => {
    const info = describeTssFeature({
      id: 'tss:r987',
      type: 'separation_lane',
      name: 'Example scheme',
      bounds: [50, -5, 51, -4],
      path: [[50, -5], [51, -4]],
      details: {
        'seamark:separation_lane:traffic_flow': 'inbound',
        source: 'IMO circular',
      },
    });
    expect(info).toEqual({
      title: 'Example scheme',
      type: 'separation lane',
      details: [['Lane traffic flow', 'inbound'], ['OSM source note', 'IMO circular']],
      sourceUrl: 'https://www.openstreetmap.org/relation/987',
      sourceName: 'OpenStreetMap contributors (ODbL)',
    });
  });

  it('treats touching cell edges as intersecting', () => {
    expect(marineBoundsIntersect([50, -5, 55, 0], [55, 0, 60, 5])).toBe(true);
  });
});
