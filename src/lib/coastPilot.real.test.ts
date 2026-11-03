import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clearancesForFeature, type ClearanceDatasets } from './clearances';
import { coalesceBridges, type ChartFeature } from './overpass';

const dir = dirname(fileURLToPath(import.meta.url));

function realCoastPilotDatasets(): ClearanceDatasets {
  const read = (name: string) => JSON.parse(readFileSync(join(dir, '../../public/bridge-clearances', name), 'utf8'));
  return {
    manifest: read('manifest.json'),
    noaa: read('noaa.json'),
    usace: [],
    euris: [],
    danube: [],
    coastpilot: read('coastpilot.json'),
  };
}

describe('San Francisco Bay bridges against the real Coast Pilot dataset', () => {
  it('shows the Coast Pilot Golden Gate figure alongside the ENC figure', () => {
    const proxy = JSON.parse(readFileSync(join(dir, '__fixtures__/sf-bay-bridges.json'), 'utf8'));
    const bridges = coalesceBridges(proxy.features as ChartFeature[]);
    const datasets = realCoastPilotDatasets();
    const goldenGate = bridges.filter((b) => /golden gate/i.test(b.name));
    expect(goldenGate.length).toBeGreaterThanOrEqual(1);
    const rows = goldenGate.flatMap((b) => clearancesForFeature(b, datasets));
    const pilot = rows.filter((c) => c.source === 'US Coast Pilot');
    expect(pilot.flatMap((c) => c.values)).toContain(70.4);
    expect(pilot[0].datum).toBe('MHW');
    const noaa = rows.filter((c) => c.source === 'NOAA ENC');
    expect(noaa.flatMap((c) => c.values)).toContain(70.5);
  });

  it('gives the Tidal Canal highway bridges the group least row, and no one else', () => {
    const proxy = JSON.parse(readFileSync(join(dir, '__fixtures__/sf-bay-bridges.json'), 'utf8'));
    const bridges = coalesceBridges(proxy.features as ChartFeature[]);
    const datasets = realCoastPilotDatasets();
    const tidalHighway = bridges.filter((b) => /park street|high street|miller-sweeney/i.test(b.name));
    expect(tidalHighway.length).toBeGreaterThanOrEqual(1);
    for (const feature of tidalHighway) {
      const least = clearancesForFeature(feature, datasets).filter(
        (c) => c.source === 'US Coast Pilot' && c.least,
      );
      expect(least.flatMap((c) => c.values)).toContain(4.6);
      expect(least[0].datumNote).toContain('three highway drawbridges across Tidal Canal');
    }
    // The kind filter is safety-critical: a group least row must only ever
    // land on a feature carrying the group's kind tag.
    for (const feature of bridges) {
      const least = clearancesForFeature(feature, datasets).filter(
        (c) => c.source === 'US Coast Pilot' && c.least,
      );
      if (least.length > 0) expect(feature.properties.highway).toBeTruthy();
    }
  });
});
