import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearMarineManifestCache, describeTssFeature, loadMarineData, marineBoundsIntersect, marineShardsForBounds, SHARD_CONCURRENCY, tssGeometryParts, validateMarineManifest } from './marineDb';
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

describe('worldwide marine archive loading', () => {
  const shardManifest = {
    schema: 1,
    version: 'live',
    generatedAt: '2026-01-01T00:00:00.000Z',
    cellSize: 5,
    layers: {
      navaids: { count: 1, shards: [{ path: 'navaids/28_35.json', bounds: [50, -5, 55, 0], count: 1 }] },
      ferries: { count: 1, shards: [{ path: 'ferries/28_35.json', bounds: [50, -5, 55, 0], count: 1 }] },
      tss: {
        count: 2,
        shards: [
          { path: 'tss/28_35.json', bounds: [50, -5, 55, 0], count: 1 },
          { path: 'tss/29_35.json', bounds: [55, -5, 60, 0], count: 1 },
        ],
      },
    },
  };

  const tssFeature = {
    id: 'tss:w1',
    type: 'separation_lane',
    name: 'Surviving lane',
    bounds: [54, -2, 54.2, -1.8],
    path: [
      [54, -2],
      [54.2, -1.8],
    ],
  };

  const markFeature = {
    id: 'osm:node/1',
    type: 'lateral_port',
    name: 'Buoy',
    bounds: [54, -2, 54, -2],
    path: [[54, -2]],
    navaid: { id: 'osm:node/1', lat: 54, lon: -2, category: 'lateral_port' },
  };

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  const stubFetch = (handler: (url: string, attempt: Record<string, number>) => Promise<Response>) => {
    const attempts: Record<string, number> = {};
    const mock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      attempts[url] = (attempts[url] ?? 0) + 1;
      return handler(url, attempts);
    });
    vi.stubGlobal('fetch', mock);
    return { mock, attempts };
  };

  afterEach(() => {
    clearMarineManifestCache();
    vi.unstubAllGlobals();
  });

  it('keeps the lanes and marks that did load when one shard keeps failing', async () => {
    const { attempts } = stubFetch(async (url) => {
      if (url.endsWith('/manifest.json')) return json(shardManifest);
      if (url.includes('tss/28_35.json')) return json({ features: [tssFeature] });
      if (url.includes('tss/29_35.json')) return json({ error: 'busy' }, 503);
      if (url.includes('navaids/28_35.json')) return json({ features: [markFeature] });
      return json({ features: [] });
    });

    const data = await loadMarineData([54, -2, 56, -1]);

    expect(data.tss.map((feature) => feature.id)).toEqual(['tss:w1']);
    expect(data.navaids.map((mark) => mark.id)).toEqual(['osm:node/1']);
    // The failing shard is retried once, then skipped instead of emptying the view.
    expect(attempts['/marine-db/tss/29_35.json']).toBe(2);
  });

  it('recovers a shard that fails once', async () => {
    const { attempts } = stubFetch(async (url, counts) => {
      if (url.endsWith('/manifest.json')) return json(shardManifest);
      if (url.includes('tss/28_35.json')) return json({ features: [tssFeature] });
      if (url.includes('tss/29_35.json')) return counts[url] === 1 ? json({}, 500) : json({ features: [] });
      return json({ features: [] });
    });

    const data = await loadMarineData([54, -2, 56, -1]);

    expect(data.tss.map((feature) => feature.id)).toEqual(['tss:w1']);
    expect(attempts['/marine-db/tss/29_35.json']).toBe(2);
  });

  it('keeps a wide view down to a bounded number of requests in flight', async () => {
    // A view wide enough to touch many cells used to fire every shard at once,
    // which starved the browser's connection pool and timed requests out.
    const shards = Array.from({ length: 40 }, (_unused, index) => ({
      path: `tss/grid_${index}.json`,
      bounds: [50 + index * 0.01, -5, 50 + index * 0.01 + 0.01, -4],
      count: 1,
    }));
    const wideManifest = {
      ...shardManifest,
      layers: {
        navaids: { count: 0, shards: [] },
        ferries: { count: 0, shards: [] },
        tss: { count: shards.length, shards },
      },
    };
    let inFlight = 0;
    let peak = 0;
    stubFetch(async (url) => {
      if (url.endsWith('/manifest.json')) return json(wideManifest);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return json({ features: [] });
    });

    await loadMarineData([50, -5, 51, -4]);

    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(SHARD_CONCURRENCY);
  });

  it('reads the archive index once and reuses it for later views', async () => {
    const { attempts } = stubFetch(async (url) => {
      if (url.endsWith('/manifest.json')) return json(shardManifest);
      return json({ features: [] });
    });

    await loadMarineData([54, -2, 55, -1]);
    await loadMarineData([55, -2, 56, -1]);

    expect(attempts['/marine-db/manifest.json']).toBe(1);
  });
});
