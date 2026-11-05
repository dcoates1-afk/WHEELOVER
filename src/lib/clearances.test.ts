import { describe, expect, it } from 'vitest';
import {
  clearanceAtLevel,
  clearancesForFeature,
  decidingClearance,
  normalizeBridgeName,
  type BridgeClearance,
  type ClearanceDatasets,
} from './clearances';

const datasets = (overrides: Partial<ClearanceDatasets> = {}): ClearanceDatasets => ({
  manifest: { generatedAt: '2026-11-02', sources: {}, incomplete: [] },
  noaa: [],
  usace: [],
  euris: [],
  danube: [],
  ...overrides,
});

const bayBridge = {
  name: 'San Francisco-Oakland Bay Bridge',
  lat: 37.82,
  lon: -122.35,
  path: [[37.82, -122.38], [37.82, -122.32]] as [number, number][],
  properties: { 'water crossed': 'San Francisco Bay' },
};

describe('normalizeBridgeName', () => {
  it('drops accents, parentheticals and generic bridge words', () => {
    expect(normalizeBridgeName('Maximilianbrücke (Kelheim)')).toBe('maximilian');
    expect(normalizeBridgeName('San Francisco-Oakland Bay Bridge')).toBe('san francisco oakland bay');
    expect(normalizeBridgeName('Drumski most Smederevo-Kovin')).toBe('drumski smederevo kovin');
  });
});

describe('clearancesForFeature', () => {
  it('decodes a VERDAT code instead of repeating it, and marks closed figures', () => {
    const found = clearancesForFeature(bayBridge, datasets({
      noaa: [
        { la: 37.82, lo: -122.35, n: null, v: null, c: 7.6, o: null, h: 28, d: '12', k: 'bascule bridge', s: null },
      ],
    }));
    expect(found).toHaveLength(1);
    expect(found[0].datum).toBe('MLLW');
    expect(found[0].closed).toBe(true);
    expect(found[0].values).toEqual([7.6]);
  });

  it('decodes VERDAT 24 as a local datum, never as MHW', () => {
    const found = clearancesForFeature(bayBridge, datasets({
      noaa: [
        { la: 37.82, lo: -122.35, n: 'Test Bridge', v: 51.8, c: null, o: null, h: null, d: '24', k: 'fixed bridge', s: null },
      ],
    }));
    expect(found).toHaveLength(1);
    expect(found[0].datum).toBe('local datum');
    expect(found[0].values).toEqual([51.8]);
  });

  it('joins a nearby NOAA record and merges spans of one crossing', () => {
    const found = clearancesForFeature(bayBridge, datasets({
      noaa: [
        { la: 37.82, lo: -122.36, n: 'San Francisco-Oakland Bay Bridge', v: 67.0, c: null, o: null, h: null, d: null, k: null, s: null },
        { la: 37.82, lo: -122.34, n: 'San Francisco-Oakland Bay Bridge', v: 62.1, c: null, o: null, h: null, d: null, k: null, s: null },
        { la: 37.9, lo: -122.2, n: 'Far Away Bridge', v: 10, c: null, o: null, h: null, d: null, k: null, s: null },
      ],
    }));
    expect(found).toHaveLength(1);
    expect(found[0].source).toBe('NOAA ENC');
    expect(found[0].values).toEqual([62.1, 67.0]);
    expect(found[0].datum).toBe('MHW');
    expect(found[0].retrieved).toBe('2026-11-02');
  });

  it('keeps a USACE figure datum-not-stated', () => {
    const found = clearancesForFeature(bayBridge, datasets({
      usace: [
        { la: 37.82, lo: -122.35, n: null, v: 13.9, c: null, o: null, h: 120.3, k: 'Fixed Bridge', s: '20140805' },
      ],
    }));
    expect(found).toHaveLength(1);
    expect(found[0].source).toBe('USACE Inland ENC');
    expect(found[0].values).toEqual([13.9]);
    expect(found[0].datum).toBeNull();
    expect(found[0].horizontal).toBe(120.3);
  });

  it('joins EuRIS by name plus waterway, not by name alone', () => {
    const danubeBridge = {
      name: 'Nibelungenbrücke',
      lat: 49.02,
      lon: 12.1,
      path: [[49.02, 12.09], [49.02, 12.11]] as [number, number][],
      properties: { 'water crossed': 'Danube' },
    };
    const matched = clearancesForFeature(danubeBridge, datasets({
      euris: [
        { n: 'Nibelungenbrücke', w: 'Danube', hm: '1234', c: 6.95, o: null, wd: 50.2, a: null, l: null },
        { n: 'Nibelungenbrücke', w: 'Rhine', hm: '567', c: 8.0, o: null, wd: null, a: null, l: null },
      ],
    }));
    expect(matched).toHaveLength(1);
    expect(matched[0].source).toBe('EuRIS');
    expect(matched[0].values).toEqual([6.95]);
    expect(matched[0].datum).toBeNull();
  });

  it('keeps one labelled EuRIS row per matched record, collapsing exact duplicates', () => {
    const bridge = {
      name: 'Cernavoda Bridge',
      lat: 44.34,
      lon: 28.03,
      path: [[44.34, 28.02], [44.34, 28.04]] as [number, number][],
      properties: { 'water crossed': 'Danube' },
    };
    const matched = clearancesForFeature(bridge, datasets({
      euris: [
        { n: 'Cernavoda Bridge', w: 'Danube', hm: '3001', c: 24.9, o: null, wd: null, a: null, l: null },
        { n: 'Cernavoda Bridge', w: 'Danube', hm: '3001', c: 24.9, o: null, wd: null, a: null, l: null },
        { n: 'Cernavoda Bridge', w: 'Danube', hm: '603', c: 23.0, o: null, wd: null, a: null, l: null },
      ],
    }));
    expect(matched).toHaveLength(2);
    expect(matched).toContainEqual(expect.objectContaining({ values: [24.9], datumNote: 'river km 300.1' }));
    expect(matched).toContainEqual(expect.objectContaining({ values: [23], datumNote: 'river km 60.3' }));
  });

  it('joins the Danube list by name on a Danube crossing, with its gauge', () => {
    const kelheim = {
      name: 'Maximilianbrücke',
      lat: 48.92,
      lon: 11.87,
      path: [[48.92, 11.86], [48.92, 11.88]] as [number, number][],
      properties: { 'water crossed': 'Danube' },
    };
    const found = clearancesForFeature(kelheim, datasets({
      danube: [
        { km: 2414.25, rb: 'DE', n: 'Maximilianbrücke (Kelheim)', use: 'Road', h1: 5.25, w1: 17.25, d1: 'D+U', h2: null, w2: null, d2: '', g: '540 cm Kelheim', nt: '' },
      ],
    }));
    expect(found).toHaveLength(1);
    expect(found[0].source).toBe('viadonau Danube list');
    expect(found[0].values).toEqual([5.25]);
    expect(found[0].datum).toBe('HNWL');
    expect(found[0].datumNote).toBe('reference gauge 540 cm Kelheim');
  });

  it('does not join the Danube list to a bridge over other water', () => {
    const other = { ...bayBridge, properties: { 'water crossed': 'San Francisco Bay' } };
    const found = clearancesForFeature(other, datasets({
      danube: [
        { km: 2414.25, rb: 'DE', n: 'San Francisco-Oakland Bay Bridge', use: 'Road', h1: 5.25, w1: 17.25, d1: 'D+U', h2: null, w2: null, d2: '', g: '', nt: '' },
      ],
    }));
    expect(found).toEqual([]);
  });
});

describe('clearanceAtLevel', () => {
  it('subtracts water above the datum and gives back water below it', () => {
    expect(clearanceAtLevel(10, 0.5)).toBeCloseTo(9.5);
    expect(clearanceAtLevel(10, -0.8)).toBeCloseTo(10.8);
  });
});

describe('decidingClearance', () => {
  const row = (overrides: Partial<BridgeClearance> & { source: string; values: number[] }): BridgeClearance => ({
    closed: false,
    openValues: [],
    horizontal: null,
    datum: 'MHW',
    datumNote: null,
    retrieved: '2026-11-02',
    ...overrides,
  });

  it('uses the lower of two close but conflicting datum-stated figures', () => {
    // Halifax MacKay/Macdonald: CHS Sailing Directions ATL 105 says 49 m
    // above Higher High Water, Large Tides; the operator says 46.9 m at
    // centre span at high water. Doug's rule: the lower one decides.
    expect(decidingClearance([
      row({ source: 'CHS Sailing Directions ATL 105', values: [49], datum: 'Higher High Water, Large Tides' }),
      row({ source: 'Halifax Harbour Bridges', values: [46.9], datum: 'high water level' }),
    ])).toEqual({ value: 46.9, datum: 'high water level', least: false, source: 'Halifax Harbour Bridges' });
    // Golden Gate: NOAA ENC 71 m, Coast Pilot 70 m above MHW.
    expect(decidingClearance([
      row({ source: 'NOAA ENC', values: [71], datum: 'MHW' }),
      row({ source: 'NOAA Coast Pilot', values: [70], datum: 'MHW' }),
    ])).toEqual({ value: 70, datum: 'MHW', least: false, source: 'NOAA Coast Pilot' });
  });

  it('prefers an exact figure over a lower group least, and a least only when no exact exists', () => {
    expect(decidingClearance([
      row({ source: 'NOAA Coast Pilot', values: [15], datum: 'MHW', least: true }),
      row({ source: 'NOAA ENC', values: [20], datum: 'MHW' }),
    ])).toEqual({ value: 20, datum: 'MHW', least: false, source: 'NOAA ENC' });
    expect(decidingClearance([
      row({ source: 'NOAA Coast Pilot', values: [15], datum: 'MHW', least: true }),
    ])).toEqual({ value: 15, datum: 'MHW', least: true, source: 'NOAA Coast Pilot' });
  });

  it('never decides on a datum-unknown figure', () => {
    expect(decidingClearance([
      row({ source: 'OSM seamark', values: [5], datum: null }),
    ])).toBeNull();
    expect(decidingClearance([])).toBeNull();
  });
});
