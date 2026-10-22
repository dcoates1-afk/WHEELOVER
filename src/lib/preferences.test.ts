import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREFERENCES,
  readChartPreferences,
  sanitizePreferences,
  writeChartPreferences,
} from './chartPreferences';
import { GPS_DEFAULT, parseGpsMode, readGpsMode, writeGpsMode } from './gpsPreference';
import {
  WEEK_MS,
  boundsIntersect,
  regionForPoint,
  shardsForBounds,
  shouldRevalidate,
  validateManifest,
} from './navaidDb';

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

describe('chart preferences', () => {
  it('falls back to defaults for junk input', () => {
    expect(sanitizePreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(sanitizePreferences({ base: 'nope', overlays: { navaids: 'yes' } })).toEqual(DEFAULT_PREFERENCES);
  });

  it('accepts every chart base and defaults the new overlays off', () => {
    for (const base of ['nautical', 'relief', 'noaa', 'rnc'] as const) {
      expect(sanitizePreferences({ base }).base).toBe(base);
    }
    expect(sanitizePreferences({ base: 'chart' }).base).toBe('osm');
    expect(DEFAULT_PREFERENCES.overlays.contours).toBe(false);
    expect(DEFAULT_PREFERENCES.overlays.soundings).toBe(false);
    expect(DEFAULT_PREFERENCES.overlays.depthLabels).toBe(false);
    expect(DEFAULT_PREFERENCES.overlays.pois).toBe(false);
    expect(
      sanitizePreferences({ overlays: { contours: true, soundings: true, depthLabels: true, pois: true } })
        .overlays,
    ).toMatchObject({
      contours: true,
      soundings: true,
      depthLabels: true,
      pois: true,
    });
  });

  it('drops the removed USACE base and depth overlay from saved preferences', () => {
    const old = sanitizePreferences({
      base: 'usace',
      overlays: { depth: true, contours: true, tss: true },
    } as unknown);
    expect(old.base).toBe('osm');
    expect(old.overlays.contours).toBe(true);
    expect(old.overlays.soundings).toBe(false);
    expect(old.overlays.depthLabels).toBe(false);
    expect('depth' in old.overlays).toBe(false);
  });

  it('fills missing overlay keys from an older saved preference', () => {
    const old = sanitizePreferences({ base: 'noaa', overlays: { tss: true } });
    expect(old.overlays.contours).toBe(false);
    expect(old.overlays.soundings).toBe(false);
    expect(old.overlays.depthLabels).toBe(false);
    expect(old.overlays.pois).toBe(false);
    expect(old.overlays.tss).toBe(true);
    expect(old.overlays.openseamap).toBe(true);
  });

  it('defaults the display theme to day and rejects unknown themes', () => {
    expect(DEFAULT_PREFERENCES.theme).toBe('day');
    expect(sanitizePreferences({ theme: 'laser' }).theme).toBe('day');
    expect(sanitizePreferences({ theme: 'night' }).theme).toBe('night');
    expect(sanitizePreferences({ theme: 'red' }).theme).toBe('red');
  });

  it('keeps valid values and persists them', () => {
    const sanitized = sanitizePreferences({
      base: 'satellite',
      overlays: { tss: true, navaids: false },
      showAllMarks: true,
      showPosition: true,
      theme: 'red',
    });
    expect(sanitized.base).toBe('satellite');
    expect(sanitized.overlays.tss).toBe(true);
    expect(sanitized.overlays.navaids).toBe(false);
    expect(sanitized.overlays.ferries).toBe(false);
    expect(sanitized.showAllMarks).toBe(true);
    expect(sanitized.theme).toBe('red');

    const storage = fakeStorage();
    writeChartPreferences(storage, sanitized);
    expect(readChartPreferences(storage)).toEqual(sanitized);
  });

  it('remembers which NAVAID classes the user switched off', () => {
    const sanitized = sanitizePreferences({ hiddenGroups: ['anchorage', 'nope', 'anchorage', 42] });
    expect(sanitized.hiddenGroups).toEqual(['anchorage']);
    expect(sanitizePreferences({ hiddenGroups: 'all' }).hiddenGroups).toEqual([]);

    const storage = fakeStorage();
    writeChartPreferences(storage, sanitized);
    expect(readChartPreferences(storage).hiddenGroups).toEqual(['anchorage']);
  });

  it('remembers which public-place classes the user switched off', () => {
    const sanitized = sanitizePreferences({
      hiddenPoiGroups: ['food', 'nope', 'food', 42, 'marina'],
    });
    expect(sanitized.hiddenPoiGroups).toEqual(['marina', 'food']);
    expect(sanitizePreferences({ hiddenPoiGroups: 'all' }).hiddenPoiGroups).toEqual([]);
  });

  it('imports settings saved under both previous prefixes and persists to WHEELOVER storage', () => {
    const leewardStorage = fakeStorage({
      'leeward:chart-prefs': JSON.stringify({ base: 'relief', theme: 'red' }),
    });
    const fromLeeward = readChartPreferences(leewardStorage);
    expect(fromLeeward.base).toBe('relief');
    expect(fromLeeward.theme).toBe('red');

    const storage = fakeStorage({
      'marnav:chart-prefs': JSON.stringify({ base: 'satellite', theme: 'night' }),
    });
    const loaded = readChartPreferences(storage);
    expect(loaded.base).toBe('satellite');
    expect(loaded.theme).toBe('night');
    writeChartPreferences(storage, loaded);
    expect(storage.getItem('wheel-over:chart-prefs')).toContain('satellite');
  });

  it('survives blocked storage', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(() => writeChartPreferences(blocked, DEFAULT_PREFERENCES)).not.toThrow();
    expect(readChartPreferences(blocked)).toEqual(DEFAULT_PREFERENCES);
  });
});

describe('GPS preference', () => {
  it('defaults to on and only accepts an explicit off', () => {
    expect(GPS_DEFAULT).toBe('on');
    expect(parseGpsMode('off')).toBe('off');
    expect(parseGpsMode('on')).toBe('on');
    expect(parseGpsMode('anything')).toBe('on');
    expect(parseGpsMode(null)).toBe('on');
  });

  it('reads choices from previous prefixes and writes to WHEELOVER storage', () => {
    expect(readGpsMode(fakeStorage({ 'leeward:gps-mode': 'off' }))).toBe('off');
    const storage = fakeStorage({ 'marnav:gps-mode': 'off' });
    expect(readGpsMode(storage)).toBe('off');
    writeGpsMode(storage, 'on');
    expect(storage.getItem('wheel-over:gps-mode')).toBe('on');
  });

  it('persists the choice and tolerates missing storage', () => {
    const storage = fakeStorage();
    writeGpsMode(storage, 'off');
    expect(readGpsMode(storage)).toBe('off');
    writeGpsMode(storage, 'on');
    expect(readGpsMode(storage)).toBe('on');
    expect(readGpsMode(null)).toBe('on');
  });
});

describe('weekly database revalidation', () => {
  it('is due when no stamp exists or the stamp is a week old', () => {
    const now = Date.UTC(2026, 9, 18);
    expect(shouldRevalidate(null, now)).toBe(true);
    expect(shouldRevalidate(now - WEEK_MS + 60_000, now)).toBe(false);
    expect(shouldRevalidate(now - WEEK_MS, now)).toBe(true);
    expect(shouldRevalidate(now - WEEK_MS - 1, now)).toBe(true);
  });

  it('can be forced', () => {
    const now = Date.UTC(2026, 9, 18);
    expect(shouldRevalidate(now, now, 0)).toBe(true);
  });
});

const manifest = {
  schema: 2,
  version: '20261018120000-abc',
  generatedAt: '2026-10-18T12:00:00.000Z',
  cellSize: 0.25,
  regions: [
    {
      id: 'solent',
      name: 'Solent',
      bounds: [50.55, -1.85, 51.05, -0.75],
      count: 120,
      sources: ['osm'],
      shards: [
        { path: 'solent/202_-5.json', bounds: [50.5, -1.25, 50.75, -1.0], count: 80 },
        { path: 'solent/203_-5.json', bounds: [50.75, -1.25, 51.0, -1.0], count: 40 },
      ],
    },
    {
      id: 'ny-harbor',
      name: 'New York',
      bounds: [40.45, -74.3, 40.95, -73.7],
      count: 90,
      sources: ['osm'],
      shards: [{ path: 'ny-harbor/161_-297.json', bounds: [40.25, -74.25, 40.5, -74.0], count: 90 }],
    },
  ],
  sources: [{ id: 'osm', name: 'OpenStreetMap seamarks' }],
  stats: { rawRecords: 400, uniqueAids: 210, duplicatesRemoved: 12 },
};

describe('manifest validation', () => {
  it('accepts a well-formed manifest', () => {
    const parsed = validateManifest(manifest);
    expect(parsed?.version).toBe(manifest.version);
    expect(parsed?.regions).toHaveLength(2);
    expect(parsed?.stats.uniqueAids).toBe(210);
  });

  it('rejects other schema versions and empty region lists', () => {
    expect(validateManifest({ ...manifest, schema: 1 })).toBeNull();
    expect(validateManifest({ ...manifest, regions: [] })).toBeNull();
    expect(validateManifest(null)).toBeNull();
  });
});

describe('viewport selection', () => {
  it('detects intersecting bounds', () => {
    expect(boundsIntersect([50.5, -1.5, 51.0, -1.0], [50.6, -1.2, 50.8, -1.1])).toBe(true);
    expect(boundsIntersect([50.5, -1.5, 51.0, -1.0], [51.2, -1.2, 51.4, -1.1])).toBe(false);
  });

  it('selects only the shards that intersect the view', () => {
    const parsed = validateManifest(manifest)!;
    const selection = shardsForBounds(parsed, [50.6, -1.2, 50.7, -1.1]);
    expect(selection).toHaveLength(1);
    expect(selection[0].region.id).toBe('solent');
    expect(selection[0].shards.map((shard) => shard.path)).toEqual(['solent/202_-5.json']);
  });

  it('includes every shard a viewport straddles', () => {
    const parsed = validateManifest(manifest)!;
    const selection = shardsForBounds(parsed, [50.6, -1.2, 50.8, -1.1]);
    expect(selection[0].shards.map((shard) => shard.path)).toEqual([
      'solent/202_-5.json',
      'solent/203_-5.json',
    ]);
  });

  it('resolves the containing region for a point', () => {
    const parsed = validateManifest(manifest)!;
    expect(regionForPoint(parsed, 50.8, -1.2)?.id).toBe('solent');
    expect(regionForPoint(parsed, 40.7, -74.0)?.id).toBe('ny-harbor');
    expect(regionForPoint(parsed, 35.0, 139.0)).toBeNull();
  });
});
