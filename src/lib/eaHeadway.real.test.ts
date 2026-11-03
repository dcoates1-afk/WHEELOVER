import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type ClearanceDatasets,
  clearancesForFeature,
  type EaHeadwayRecord,
  type JoinableBridgeFeature,
} from './clearances';

const dir = dirname(fileURLToPath(import.meta.url));

function realEa(): EaHeadwayRecord[] {
  return JSON.parse(
    readFileSync(join(dir, '../../public/bridge-clearances/ea-headway.json'), 'utf8'),
  );
}

function datasets(): ClearanceDatasets {
  return {
    manifest: { generatedAt: '2026-11-03', sources: {}, incomplete: [] },
    noaa: [],
    usace: [],
    euris: [],
    danube: [],
    coastpilot: [],
    eaheadway: realEa(),
  };
}

function feature(name: string, crossed: string): JoinableBridgeFeature {
  return {
    name,
    lat: 51.7,
    lon: -1.6,
    path: [
      [51.7, -1.6],
      [51.701, -1.599],
    ],
    properties: { 'water crossed': crossed },
  };
}

describe('EA headway dataset against real rows', () => {
  it('ships the four pages with no utility rows and no empty figures', () => {
    const rows = realEa();
    expect(rows).toHaveLength(206);
    expect(rows.some((r) => /pipe line/i.test(r.n))).toBe(false);
    expect(rows.every((r) => r.v.length > 0 && r.v.every((v) => v > 0 && v < 100))).toBe(
      true,
    );
    const byPage = new Map<string, number>();
    for (const r of rows) byPage.set(r.pg, (byPage.get(r.pg) ?? 0) + 1);
    expect(byPage.get('River Thames')).toBe(76);
    expect(byPage.get('River Great Ouse')).toBe(84);
    expect(byPage.get('River Nene')).toBe(25);
    expect(byPage.get('Rivers Welland and Glen')).toBe(21);
  });

  it('joins Halfpenny Bridge from the real table', () => {
    const rows = clearancesForFeature(
      feature('Halfpenny Bridge', 'River Thames'),
      datasets(),
    ).filter((c) => c.source === 'Environment Agency');
    expect(rows).toHaveLength(1);
    expect(rows[0].values).toEqual([4.73]);
    expect(rows[0].datum).toBe('standard water level (approximate)');
  });

  it('joins both Dimmocks Cote figures from the real table', () => {
    const rows = clearancesForFeature(
      feature('Dimmocks Cote Road Bridge', 'River Cam'),
      datasets(),
    ).filter((c) => c.source === 'Environment Agency');
    expect(rows.flatMap((r) => r.values).sort()).toEqual([3.1, 3.7]);
  });

  it('gives the generic Thames rows to nobody', () => {
    const rows = clearancesForFeature(feature('Road Bridge', 'River Thames'), datasets()).filter(
      (c) => c.source === 'Environment Agency',
    );
    expect(rows).toHaveLength(0);
  });
});
