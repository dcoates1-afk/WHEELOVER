import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { mergeNavaidSources } from '../../shared/navaid-core.mjs';
import {
  loadUscgLights,
  uscgRecordToNavaid,
  uscgVolumesForBounds,
  USCG_VOLUME_BOUNDS,
  USCG_VOLUMES,
  type UscgLightRecord,
} from './uscgLights';
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
  it('maps a red nun buoy record to a lateral buoy, not a minor light', () => {
    const navaid = uscgRecordToNavaid(record);
    expect(navaid.id).toBe('uscg:01:40095');
    expect(navaid.category).toBe('lateral_other');
    expect(navaid.form).toBe('buoy');
    expect(navaid.colour).toBe('red');
    expect(navaid.shape).toBe('conical');
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
    const requested: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        requested.push(url);
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
    // One request per volume, so the caller can pass a subset and pay only for it.
    expect(requested.sort()).toEqual(USCG_VOLUMES.map((volume) => `/uscg-lights-${volume}.json`));
  });

});

describe('uscgVolumesForBounds', () => {
  it('asks for nothing where no volume reaches', () => {
    // The Solent is the startup view, so a default load now downloads no USCG data.
    expect(uscgVolumesForBounds([50.6, -1.6, 50.9, -1.0])).toEqual([]);
  });

  it('picks the volume covering the view', () => {
    expect(uscgVolumesForBounds([42.2, -71.1, 42.5, -70.8])).toContain('01'); // Boston
    expect(uscgVolumesForBounds([25.7, -80.2, 26.0, -80.0])).toContain('03'); // Miami
  });

  it('treats volume 06 as the Pacific, not the whole planet', () => {
    expect(uscgVolumesForBounds([50.6, -1.6, 50.9, -1.0])).not.toContain('06');
    expect(uscgVolumesForBounds([47.5, -122.5, 47.8, -122.2])).toContain('06'); // Seattle
  });

  it('still covers the far side of the antimeridian', () => {
    expect(uscgVolumesForBounds([13.3, 144.6, 13.6, 144.9])).toContain('06'); // Guam
  });

  it('handles a view that itself straddles the antimeridian', () => {
    expect(uscgVolumesForBounds([20, 179, 21, -179])).toEqual(['06']);
  });
});

describe('USCG_VOLUME_BOUNDS', () => {
  it('covers every record of every shipped volume', () => {
    // Guards the gate against a dataset rebuild that moves a volume: a box that
    // no longer contains its records would silently hide lights.
    for (const volume of USCG_VOLUMES) {
      const file = JSON.parse(
        readFileSync(resolve('public', `uscg-lights-${volume}.json`), 'utf8'),
      ) as { records: UscgLightRecord[] };
      const boxes = USCG_VOLUME_BOUNDS[volume];
      expect(boxes, `no bounds declared for volume ${volume}`).toBeDefined();
      const outside = (file.records ?? []).filter(
        (record) =>
          // The generator may express a volume's longitudes in the compact
          // Pacific frame, so compare modulo 360 the way boundsIntersect does.
          ![-360, 0, 360].some((shift) =>
            boxes.some(
              ([south, west, north, east]) =>
                record.lat >= south &&
                record.lat <= north &&
                record.lon + shift >= west &&
                record.lon + shift <= east,
            ),
          ),
      );
      expect(outside.map((record) => record.no)).toEqual([]);
    }
  });
});
