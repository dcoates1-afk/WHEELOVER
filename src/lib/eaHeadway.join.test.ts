import { describe, expect, it } from 'vitest';
import {
  type ClearanceDatasets,
  clearancesForFeature,
  type EaHeadwayRecord,
  type JoinableBridgeFeature,
} from './clearances';

const EMPTY: ClearanceDatasets = {
  manifest: { generatedAt: '2026-11-03', sources: {}, incomplete: [] },
  noaa: [],
  usace: [],
  euris: [],
  danube: [],
  coastpilot: [],
  eaheadway: [],
};

function ea(record: Partial<EaHeadwayRecord> & { n: string }): EaHeadwayRecord {
  return {
    w: null,
    v: [],
    c: true,
    d: 'standard water level (approximate)',
    note: null,
    pg: 'River Thames',
    ...record,
  };
}

function feature(
  name: string,
  crossed: string,
  extra: Record<string, string> = {},
): JoinableBridgeFeature {
  return {
    name,
    lat: 51.7,
    lon: -1.6,
    path: [
      [51.7, -1.6],
      [51.701, -1.599],
    ],
    properties: { 'water crossed': crossed, ...extra },
  };
}

function eaRows(f: JoinableBridgeFeature, rows: EaHeadwayRecord[]) {
  return clearancesForFeature(f, { ...EMPTY, eaheadway: rows }).filter(
    (c) => c.source === 'Environment Agency',
  );
}

describe('EA headway joins', () => {
  it('joins a named bridge on its river with datum and reach note', () => {
    const rows = eaRows(feature('Radcot Bridge', 'River Thames'), [
      ea({ n: 'Radcot Bridge', w: 'River Thames', v: [3.45] }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].values).toEqual([3.45]);
    expect(rows[0].datum).toBe('standard water level (approximate)');
    expect(rows[0].closed).toBe(true);
  });

  it('carries the reach note for Great Ouse rows', () => {
    const rows = eaRows(feature('Wicken Road Bridge', 'Old West'), [
      ea({ n: 'Wicken Road Bridge', w: 'Old West', v: [3.2], note: 'Old West' }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].datumNote).toBe('Old West');
  });

  it('never joins a generic name, even on the right river', () => {
    const rows = eaRows(feature('Road Bridge', 'River Thames'), [
      ea({ n: 'Road Bridge', w: 'River Thames', v: [3.71] }),
      ea({ n: 'Footbridge', w: 'River Thames', v: [2.9] }),
      ea({ n: 'Railway Bridge', w: 'River Thames', v: [2.6] }),
    ]);
    expect(rows).toHaveLength(0);
  });

  it('never lets a qualified row land on the plain kind', () => {
    const rows = eaRows(feature('Road Bridge', 'River Great Ouse'), [
      ea({ n: 'Road Bridge (GT Barford)', w: 'River Great Ouse', v: [3.0] }),
    ]);
    expect(rows).toHaveLength(0);
  });

  it('gates on the waterway', () => {
    const rows = eaRows(feature('Radcot Bridge', 'River Nene'), [
      ea({ n: 'Radcot Bridge', w: 'River Thames', v: [3.45] }),
    ]);
    expect(rows).toHaveLength(0);
  });

  it('keeps both figures for a twice-listed bridge', () => {
    const rows = eaRows(feature('Dimmocks Cote Road Bridge', 'River Cam'), [
      ea({ n: 'Dimmocks Cote Road Bridge', w: 'River Cam', v: [3.7] }),
      ea({ n: 'Dimmocks Cote Road Bridge', w: 'River Cam', v: [3.1] }),
    ]);
    expect(rows.flatMap((r) => r.values).sort()).toEqual([3.1, 3.7]);
  });
});
