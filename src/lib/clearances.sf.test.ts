import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clearancesForFeature, type ClearanceDatasets } from './clearances';
import { coalesceBridges, type ChartFeature } from './overpass';

const dir = dirname(fileURLToPath(import.meta.url));

function realDatasets(): ClearanceDatasets {
  const read = (name: string) => JSON.parse(readFileSync(join(dir, '../../public/bridge-clearances', name), 'utf8'));
  return {
    manifest: read('manifest.json'),
    noaa: read('noaa.json'),
    usace: read('usace.json'),
    euris: read('euris.json'),
    danube: read('danube.json'),
  };
}

describe('San Francisco Bay bridges against the real clearance dataset', () => {
  it('joins Golden Gate and Bay Bridge figures through the browser pipeline', () => {
    const proxy = JSON.parse(readFileSync(join(dir, '__fixtures__/sf-bay-bridges.json'), 'utf8'));
    const features = proxy.features as ChartFeature[];
    const bridges = coalesceBridges(features);
    const datasets = realDatasets();

    const goldenGate = bridges.filter((b) => /golden gate/i.test(b.name));
    expect(goldenGate.length).toBeGreaterThanOrEqual(1);
    const goldenGateClearances = goldenGate.flatMap((b) => clearancesForFeature(b, datasets));
    const goldenGateNoaa = goldenGateClearances.filter((c) => c.source === 'NOAA ENC');
    expect(goldenGateNoaa.flatMap((c) => c.values)).toContain(70.5);

    const bayBridge = bridges.filter((b) => /bay bridge|oakland/i.test(b.name));
    expect(bayBridge.length).toBeGreaterThanOrEqual(1);
    const bayNoaa = bayBridge
      .flatMap((b) => clearancesForFeature(b, datasets))
      .filter((c) => c.source === 'NOAA ENC');
    const bayValues = bayNoaa.flatMap((c) => c.values);
    expect(bayValues).toContain(62.1);
    expect(bayValues).toContain(67);
  });
});
