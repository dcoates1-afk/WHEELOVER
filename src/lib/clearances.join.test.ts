import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  clearancesForFeature,
  type ClearanceDatasets,
  type JoinableBridgeFeature,
} from './clearances';

function loadJson(path: string): any {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Real-data join checks: the OSM features are verbatim proxy output for
 * Kelheim (Danube) and the Allegheny at Kittanning, and the datasets are
 * the built files in public/. No network, so these stay deterministic.
 */
function datasets(): ClearanceDatasets {
  return {
    manifest: { generatedAt: '2026-11-02', sources: {}, incomplete: [] },
    noaa: [],
    usace: loadJson('public/bridge-clearances/usace.json'),
    euris: [],
    danube: loadJson('public/bridge-clearances/danube.json'),
  };
}

describe('clearance join against real OSM features and datasets', () => {
  it('joins the USACE record to Kittanning by name despite the centroid offset', () => {
    const feature = loadJson('src/lib/__fixtures__/kittanning-bridge.json') as JoinableBridgeFeature;
    const found = clearancesForFeature(feature, datasets());
    const usace = found.find((row) => row.source === 'USACE Inland ENC');
    expect(usace).toBeDefined();
    expect(usace?.values).toEqual([13.9]);
    expect(usace?.horizontal).toBe(120.3);
    expect(usace?.datum).toBeNull();
  });

  it('joins the Danube list rows to the Kelheim OSM paths', () => {
    const fixtures = loadJson('src/lib/__fixtures__/kelheim-bridges.json') as Record<string, JoinableBridgeFeature>;
    // Maximilianbrücke is ambiguous by name (Kelheim and Deggendorf), so
    // the join keeps one labelled row per list entry instead of merging
    // another bridge's figure onto this card.
    const maxRows = clearancesForFeature(fixtures['Maximiliansbrücke'], datasets())
      .filter((row) => row.source === 'viadonau Danube list');
    expect(maxRows).toHaveLength(2);
    expect(maxRows).toContainEqual(expect.objectContaining({
      values: [5.25], datum: 'HNWL', datumNote: 'reference gauge 540 cm Kelheim',
    }));
    expect(maxRows).toContainEqual(expect.objectContaining({
      values: [8.6], datum: 'HNWL', datumNote: 'reference gauge 540 cm Deggendorf',
    }));
    const europa = clearancesForFeature(fixtures['Europabrücke'], datasets())
      .find((row) => row.source === 'viadonau Danube list');
    expect(europa).toBeDefined();
    expect(europa?.values).toEqual([6.8]);
  });

  it('does not join a same-named record from far away', () => {
    const feature = loadJson('src/lib/__fixtures__/kittanning-bridge.json') as JoinableBridgeFeature;
    const found = clearancesForFeature(feature, {
      manifest: { generatedAt: '2026-11-02', sources: {}, incomplete: [] },
      noaa: [],
      usace: [
        { la: 41.0, lo: -79.52, n: 'Kittanning Citizens Bridge', v: 13.9, c: null, o: null, h: 120.3, k: 'Fixed Bridge', s: null },
      ],
      euris: [],
      danube: [],
    });
    expect(found).toHaveLength(0);
  });
});
