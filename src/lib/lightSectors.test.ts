import { describe, expect, it } from 'vitest';
import type { Navaid } from './navaidTypes';
import {
  applyLightSectorIndex,
  applyLightSectors,
  lightSectorCellsForBounds,
  loadLightSectors,
  standaloneLightMarks,
  validateLightSectorCell,
  validateLightSectorManifest,
  type LightSectorEntry,
  type LightSectorManifest,
} from './lightSectors';

const manifest: LightSectorManifest = {
  schema: 1,
  generatedAt: '2026-07-16T00:00:00.000Z',
  sourceTimestamp: '2026-07-15T15:22:01Z',
  count: 2,
  cells: [
    { path: 'light-sectors/51_70.json', bounds: [50, -10, 55, -5], count: 1 },
    { path: 'light-sectors/10_21.json', bounds: [-40, -75, -35, -70], count: 1 },
  ],
};

function mark(overrides: Partial<Navaid> = {}): Navaid {
  return {
    id: 'osm:way/128637893',
    lat: 50.7,
    lon: -1.55,
    category: 'landmark',
    form: 'landmark',
    name: 'Test light',
    light: null,
    colour: null,
    shape: null,
    height: null,
    range: null,
    path: null,
    transitBearing: null,
    transitDistanceM: null,
    transitPartner: null,
    transitPartnerName: null,
    channel: null,
    description: null,
    lit: false,
    priority: 44,
    source: 'osm',
    updated: null,
    region: null,
    ...overrides,
  };
}

const entry: LightSectorEntry = {
  sectors: [
    { sector: 1, character: 'Fl', colour: 'white', start: '080', end: '104', range: '13' },
    { sector: 2, character: 'Iso', colour: 'green', category: 'directional', orientation: '39.8', range: '17' },
  ],
  character: 'Fl',
  colour: 'white',
};

describe('light sector manifest', () => {
  it('accepts a shaped manifest and rejects other schemas', () => {
    expect(validateLightSectorManifest(manifest)?.cells).toHaveLength(2);
    expect(validateLightSectorManifest({ ...manifest, schema: 2 })).toBeNull();
    expect(validateLightSectorManifest({ ...manifest, cells: [] })).toBeNull();
  });

  it('selects only the cells that meet the viewport', () => {
    const cellIds = lightSectorCellsForBounds(validateLightSectorManifest(manifest)!, [48, -7, 52, -4])
      .map((cell) => cell.path);
    expect(cellIds).toEqual(['light-sectors/51_70.json']);
  });
});

describe('light sector cell', () => {
  it('keeps valid records and drops ones without a sector number', () => {
    const cells = validateLightSectorCell({
      lights: {
        'osm:node/1': { sectors: [{ sector: 1, start: '10', end: '20' }, { character: 'Fl' }] },
        'osm:node/2': { sectors: [] },
      },
    });
    expect(cells?.size).toBe(1);
    expect(cells?.get('osm:node/1')?.sectors).toHaveLength(1);
  });

  it('rejects a payload without lights', () => {
    expect(validateLightSectorCell({})).toBeNull();
    expect(validateLightSectorCell(null)).toBeNull();
  });
});

describe('attaching sectors to archive marks', () => {
  it('adds the sectors and reranks an unlit landmark as a sector beacon', () => {
    const next = applyLightSectors(mark(), entry);
    expect(next.lightSectors).toHaveLength(2);
    expect(next.lit).toBe(true);
    expect(next.category).toBe('sector_beacon');
    expect(next.priority).toBe(100);
    expect(next.lightCharacter).toBe('Fl');
    expect(next.lightColour).toBe('white');
  });

  it('ranks a short-range landmark light as a sector beacon', () => {
    const next = applyLightSectors(mark(), {
      sectors: [{ sector: 1, character: 'Fl', colour: 'red', start: '10', end: '20', range: '3' }],
    });
    expect(next.category).toBe('sector_beacon');
    expect(next.priority).toBe(66);
  });

  it('keeps regional sector bearings and leaves the class alone', () => {
    const regional = mark({
      category: 'major_light',
      lit: true,
      lightSectors: [{ sector: 1, start: '1', end: '2' }],
    });
    const next = applyLightSectors(regional, entry);
    expect(next.category).toBe('major_light');
    expect(next.lightSectors?.[0].start).toBe('1');
    expect(next.lightSectors?.[0].end).toBe('2');
    expect(next.lightSectors?.[0].character).toBe('Fl');
  });

  it('fills the directional detail an archive sector record drops', () => {
    const archive = mark({
      category: 'major_light',
      lit: true,
      lightSectors: [
        { sector: 1, start: '080', end: '104', character: 'Fl', colour: 'white' },
        { sector: 2, character: 'Iso', colour: 'green', range: '17' },
      ],
    });
    const next = applyLightSectors(archive, entry);
    expect(next).not.toBe(archive);
    expect(next.lightSectors?.[1]).toMatchObject({ category: 'directional', orientation: '39.8' });
    expect(next.lightSectors?.[0].start).toBe('080');
  });

  it('returns the same mark when the index adds nothing to settled sectors', () => {
    const settled = mark({
      category: 'major_light',
      lit: true,
      lightSectors: [
        { sector: 1, start: '080', end: '104', character: 'Fl', colour: 'white', range: '13' },
        { sector: 2, character: 'Iso', colour: 'green', range: '17', category: 'directional', orientation: '39.8' },
      ],
    });
    expect(applyLightSectors(settled, entry)).toBe(settled);
  });

  it('leaves a lit mark without class change intact but fills its missing light details', () => {
    const next = applyLightSectors(mark({ category: 'lateral_port', form: 'buoy', lit: false }), entry);
    expect(next.category).toBe('lateral_port');
    expect(next.lit).toBe(true);
    expect(next.lightSectors).toHaveLength(2);
  });

  it('returns the same array when no mark matches', () => {
    const marks = [mark()];
    expect(applyLightSectorIndex(marks, new Map())).toBe(marks);
    expect(applyLightSectorIndex(marks, new Map([['osm:node/9', entry]]))).toBe(marks);
  });

  it('attaches a multipolygon light to the structure mark it sits on', () => {
    const structure = mark({ id: 'osm:way/50.701890/-1.551000', lat: 50.70189, lon: -1.551, category: 'light', lit: true });
    const relation: LightSectorEntry = { ...entry, type: 'light_minor', lat: 50.70189, lon: -1.551 };
    const [next] = applyLightSectorIndex([structure], new Map([['osm:relation/7', relation]]));
    expect(next.lightSectors).toHaveLength(2);
    expect(next.lightCharacter).toBe('Fl');
  });

  it('leaves a distant mark alone and never claims two marks with one light', () => {
    const near = mark({ id: 'osm:node/1', lat: 50.7, lon: -1.55, category: 'light', lit: true });
    const far = mark({ id: 'osm:node/2', lat: 50.72, lon: -1.55, category: 'light', lit: true });
    const other = mark({ id: 'osm:node/3', lat: 50.7001, lon: -1.55, category: 'light', lit: true });
    const relation: LightSectorEntry = { ...entry, type: 'light_minor', lat: 50.7, lon: -1.55 };
    const [first, second, third] = applyLightSectorIndex([near, far, other], new Map([['osm:relation/7', relation]]));
    expect(first.lightSectors).toHaveLength(2);
    expect(second.lightSectors).toBeUndefined();
    expect(third.lightSectors).toBeUndefined();
  });

  it('draws a light mark for an indexed light the archive has no mark for', () => {
    const standalone: LightSectorEntry = {
      ...entry,
      type: 'light_minor',
      name: 'Gasfeten',
      lat: 56.12185,
      lon: 15.2237,
      standalone: true,
    };
    const drawn = standaloneLightMarks(new Map([['osm:node/1534552368', standalone]]), []);
    expect(drawn).toHaveLength(1);
    expect(drawn[0]).toMatchObject({
      id: 'osm:node/1534552368',
      name: 'Gasfeten',
      lat: 56.12185,
      lon: 15.2237,
      form: 'light',
      category: 'sector_beacon',
      lit: true,
      lightCharacter: 'Fl',
      lightColour: 'white',
      range: '17',
    });
    expect(drawn[0].lightSectors).toHaveLength(2);
  });

  it('fills a missing racon or sound signal on a mark that already has sectors', () => {
    const signalled: LightSectorEntry = {
      ...entry,
      fogSignal: true,
      fogSignalCategory: 'bell',
      fogSignalGroup: '2',
      fogSignalPeriod: '20',
      radarTransponderCategory: 'racon',
      radarTransponderGroup: 'G',
      radarTransponderPeriod: '30',
    };
    const existing = mark({
      category: 'major_light',
      priority: 100,
      lit: true,
      lightSectors: [{ sector: 1, start: '1', end: '2' }],
    });
    const next = applyLightSectors(existing, signalled);
    expect(next).not.toBe(existing);
    // A light whose class and sectors were already settled keeps them.
    expect(next.category).toBe('major_light');
    expect(next.priority).toBe(100);
    expect(next.lightSectors?.[0]).toMatchObject({ sector: 1, start: '1', end: '2' });
    expect(next.fogSignal).toBe(true);
    expect(next.fogSignalCategory).toBe('bell');
    expect(next.radarTransponderCategory).toBe('racon');
    expect(next.radarTransponderGroup).toBe('G');
    expect(next.radarTransponderPeriod).toBe('30');
  });

  it('keeps the signals a mark already reports', () => {
    const existing = mark({
      category: 'major_light',
      lit: true,
      lightSectors: [{ sector: 1, start: '1', end: '2' }],
      fogSignal: true,
      fogSignalCategory: 'horn',
      radarTransponderCategory: 'responder',
      radarTransponderGroup: 'X',
    });
    const next = applyLightSectors(existing, {
      ...entry,
      fogSignal: true,
      fogSignalCategory: 'bell',
      radarTransponderCategory: 'racon',
      radarTransponderGroup: 'G',
    });
    expect(next.fogSignalCategory).toBe('horn');
    expect(next.radarTransponderCategory).toBe('responder');
    expect(next.radarTransponderGroup).toBe('X');
    expect(next.lightSectors?.[0]).toMatchObject({ sector: 1, start: '1', end: '2' });
  });

  it('keeps a standalone light signal so its mark draws the bell or racon', () => {
    const signalled: LightSectorEntry = {
      sectors: [{ sector: 1, character: 'LFl', colour: 'red', start: '267', end: '297', range: '7' }],
      type: 'beacon',
      name: 'Gasfeten',
      lat: 56.12185,
      lon: 15.2237,
      standalone: true,
      fogSignal: true,
      fogSignalCategory: 'bell',
      fogSignalGroup: '2',
      fogSignalPeriod: '20',
      radarTransponderCategory: 'racon',
      radarTransponderGroup: 'G',
      radarTransponderPeriod: '30',
    };
    const [drawn] = standaloneLightMarks(new Map([['osm:node/1534552368', signalled]]), []);
    expect(drawn.fogSignal).toBe(true);
    expect(drawn.fogSignalCategory).toBe('bell');
    expect(drawn.fogSignalGroup).toBe('2');
    expect(drawn.radarTransponderCategory).toBe('racon');
    expect(drawn.radarTransponderGroup).toBe('G');
    expect(drawn.radarTransponderPeriod).toBe('30');
  });

  it('ranks a standalone light by its charted reach', () => {
    const longRange: LightSectorEntry = {
      sectors: [{ sector: 1, character: 'Fl', colour: 'white', start: '10', end: '40', range: '20' }],
      type: 'beacon',
      lat: 39.14,
      lon: 20.24,
      standalone: true,
    };
    const drawn = standaloneLightMarks(new Map([['osm:way/97595085', longRange]]), []);
    expect(drawn[0].category).toBe('sector_beacon');
    expect(drawn[0].priority).toBe(100);
  });

  it('never doubles up a light the archive already plots, or an unflagged one', () => {
    const standalone: LightSectorEntry = {
      ...entry,
      type: 'light_minor',
      lat: 50.7,
      lon: -1.55,
      standalone: true,
    };
    const plotted = [mark({ id: 'osm:way/50.700000/-1.550000', lat: 50.7, lon: -1.55, category: 'light', lit: true })];
    expect(standaloneLightMarks(new Map([['osm:node/7', standalone]]), plotted)).toEqual([]);
    expect(standaloneLightMarks(new Map([['osm:node/7', { ...standalone, standalone: false }]]), [])).toEqual([]);
  });

  it('does not attach a non-light, such as a warning signal, by proximity', () => {
    const target = mark({ id: 'osm:node/4', lat: 50.7, lon: -1.55, category: 'landmark', lit: false });
    const signal: LightSectorEntry = { ...entry, type: 'signal_station_warning', lat: 50.7, lon: -1.55 };
    const marks = [target];
    expect(applyLightSectorIndex(marks, new Map([['osm:node/99', signal]]))).toBe(marks);
  });
});

describe('loading the sector index', () => {
  it('keeps the cells it could read when one cell fails', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('light-sectors/manifest.json')) {
        return new Response(JSON.stringify(manifest), { status: 200 });
      }
      if (url.endsWith('light-sectors/51_70.json')) {
        return new Response(JSON.stringify({ lights: { 'osm:node/1': entry } }), { status: 200 });
      }
      // The second cell, and any retry of it, is unavailable.
      return new Response('', { status: 503 });
    }) as typeof fetch;
    try {
      const sectors = await loadLightSectors([-40, -75, 55, -5]);
      expect([...sectors.keys()]).toEqual(['osm:node/1']);
    } finally {
      globalThis.fetch = original;
    }
  });
});
