import { describe, expect, it, vi, afterEach } from 'vitest';
import { mergeNavaidSources } from '../../shared/navaid-core.mjs';
import { loadUscgLights, uscgRecordToNavaid, type UscgLightRecord } from './uscgLights';
import type { Navaid } from './navaidTypes';

afterEach(() => {
  vi.unstubAllGlobals();
});

function mark(overrides: Partial<Navaid>): Navaid {
  return {
    id: 'osm:node/1',
    lat: 44.9418,
    lon: -72.2157,
    category: 'light',
    form: 'light',
    name: null,
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
    lit: false,
    priority: 66,
    source: 'osm',
    ...overrides,
  } as Navaid;
}

const record: UscgLightRecord = {
  v: '01',
  no: 40095,
  name: 'Lake Memphremagog Lighted Buoy 2',
  lat: 44.9419,
  lon: -72.2156,
  light: 'Fl R 4s',
  character: 'Fl',
  colour: 'red',
  period: '4',
  group: null,
  range: '5',
  focal: '35 ft',
  desc: 'Lake Memphremagog · Red nun. · Private Aid.',
  src: 'lightListD01_1.geojson',
};

describe('uscgRecordToNavaid', () => {
  it('maps a USCG record to a light mark', () => {
    const navaid = uscgRecordToNavaid(record);
    expect(navaid.id).toBe('uscg:01:40095');
    expect(navaid.category).toBe('light');
    expect(navaid.light).toBe('Fl R 4s');
    expect(navaid.lightCharacter).toBe('Fl');
    expect(navaid.lightColour).toBe('red');
    expect(navaid.lightPeriod).toBe('4');
    expect(navaid.height).toBe('35 ft');
    expect(navaid.range).toBe('5');
    expect(navaid.source).toBe('uscg');
    expect(navaid.sourceCitation).toBe('USCG Light List');
    expect(navaid.sourceUrl).toBe(
      'https://navcen.uscg.gov/sites/default/files/msi/lightListD01_1.geojson',
    );
  });
});

describe('USCG merge smoke test', () => {
  it('merges a USCG light onto its unlit OSM twin', () => {
    const osm = mark({
      name: 'Lake Memphremagog Lighted Buoy 2',
      light: null,
      lit: false,
      source: 'osm',
    });
    const uscg = uscgRecordToNavaid(record);
    const { navaids } = mergeNavaidSources([osm, uscg]) as { navaids: Navaid[]; removed: number };
    expect(navaids).toHaveLength(1);
    expect(navaids[0].id).toBe('osm:node/1');
    expect(navaids[0].lat).toBe(44.9418);
    expect(navaids[0].light).toBe('Fl R 4s');
    expect(navaids[0].sources).toEqual(['osm', 'uscg']);
  });
});

describe('loadUscgLights', () => {
  it('combines the volume files and skips a failed volume', async () => {
    const byVolume: Record<string, UscgLightRecord[]> = {
      '01': [record],
      '02': [{ ...record, v: '02', no: 123 }],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        const volume = url.match(/uscg-lights-(\d+)\.json/)?.[1] ?? '';
        if (volume === '03') return Promise.resolve({ ok: false, status: 500 } as Response);
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ records: byVolume[volume] ?? [] }),
        } as Response);
      }),
    );
    const records = await loadUscgLights();
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.v).sort()).toEqual(['01', '02']);
  });
});
