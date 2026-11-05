import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __resetNoaaEncCache,
  getNoaaEncManifest,
  loadNoaaEncManifest,
  loadNoaaEncMarks,
} from './noaaEnc';
import type { Navaid } from './navaidTypes';

function mark(overrides: Partial<Navaid> & { id: string }): Navaid {
  return {
    lat: 0, lon: 0, category: 'light', form: 'light', name: null, colour: null,
    shape: null, lit: true, priority: 60, source: 'noaa-enc',
    path: null, paths: null, transitBearing: null, transitDistanceM: null,
    transitPartner: null, transitPartnerName: null, channel: null, updated: null,
    region: null, light: null, ...overrides,
  } as Navaid;
}

const manifest = {
  schema: 2,
  version: '20261105000000-test',
  generatedAt: '2026-11-05T00:00:00.000Z',
  cellSize: 0.25,
  regions: [{
    id: 'noaa-enc-us',
    name: 'NOAA ENC (US waters)',
    bounds: [13, -180, 72, 180],
    count: 3,
    shards: [
      { path: '232_-608.json', bounds: [58, -152, 58.25, -151.75], count: 2 },
      { path: '200_-300.json', bounds: [50, -75, 50.25, -74.75], count: 1 },
    ],
    sources: ['noaa-enc'],
  }],
  sources: [{ id: 'noaa-enc', name: 'NOAA ENC Direct to GIS' }],
  stats: { rawRecords: 3, uniqueAids: 3, duplicatesRemoved: 0 },
};

const shards: Record<string, { navaids: Navaid[] }> = {
  '232_-608.json': {
    navaids: [
      mark({ id: 'noaa-enc:Light:1', lat: 58.1, lon: -151.9, name: 'Entrance Light' }),
      mark({ id: 'noaa-enc:Light:2', lat: 58.2, lon: -151.8, name: 'Harbour Light', category: 'sector_beacon' }),
    ],
  },
  '200_-300.json': {
    navaids: [mark({ id: 'noaa-enc:Light:3', lat: 50.1, lon: -74.9, name: 'Far Light' })],
  },
};

function mockFetch() {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    calls.push(url);
    if (url === '/noaa-enc-marks/manifest.json') {
      return { ok: true, json: async () => manifest } as Response;
    }
    const path = url.replace('/noaa-enc-marks/', '');
    const payload = shards[path];
    if (!payload) return { ok: false, json: async () => ({}) } as Response;
    return { ok: true, json: async () => payload } as Response;
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  __resetNoaaEncCache();
});

describe('NOAA ENC loader', () => {
  it('loads the manifest once and caches it', async () => {
    const calls = mockFetch();
    const first = await loadNoaaEncManifest();
    const second = await loadNoaaEncManifest();
    expect(first?.version).toBe('20261105000000-test');
    expect(second).toBe(first);
    expect(getNoaaEncManifest()?.version).toBe('20261105000000-test');
    expect(calls.filter((url) => url.includes('manifest.json'))).toHaveLength(1);
  });
  it('fetches only the shards intersecting the viewport', async () => {
    const calls = mockFetch();
    const marks = await loadNoaaEncMarks([58, -152, 58.25, -151.75]);
    expect(marks).toHaveLength(2);
    expect(marks.map((m) => m.id)).toEqual(['noaa-enc:Light:1', 'noaa-enc:Light:2']);
    expect(calls).toContain('/noaa-enc-marks/232_-608.json');
    expect(calls).not.toContain('/noaa-enc-marks/200_-300.json');
  });
  it('caches shards in memory across loads', async () => {
    const calls = mockFetch();
    await loadNoaaEncMarks([58, -152, 58.25, -151.75]);
    await loadNoaaEncMarks([58, -152, 58.25, -151.75]);
    expect(calls.filter((url) => url.endsWith('.json') && !url.includes('manifest'))).toHaveLength(1);
  });
  it('returns nothing when the manifest fails to load', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, json: async () => ({}) }) as Response);
    expect(await loadNoaaEncMarks([58, -152, 58.25, -151.75])).toEqual([]);
  });
  it('returns nothing for a view with no ENC shards', async () => {
    mockFetch();
    // Solent: inside the region's longitude span, but no US shard intersects.
    expect(await loadNoaaEncMarks([50.7, -1.6, 50.9, -1.2])).toEqual([]);
  });
});
