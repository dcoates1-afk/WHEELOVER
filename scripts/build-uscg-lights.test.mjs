import { describe, expect, it } from 'vitest';
import { dedupeUscg, featureToRecord, parseLightChar } from './build-uscg-lights.mjs';

describe('parseLightChar', () => {
  it('splits simple characters', () => {
    expect(parseLightChar('Fl G 4s')).toEqual({
      light: 'Fl G 4s', character: 'Fl', colour: 'green', period: '4', group: null,
    });
    expect(parseLightChar('Q R')).toEqual({
      light: 'Q R', character: 'Q', colour: 'red', period: null, group: null,
    });
    expect(parseLightChar('Iso W 6s')).toEqual({
      light: 'Iso W 6s', character: 'Iso', colour: 'white', period: '6', group: null,
    });
  });

  it('keeps groups on the character in OSM/CCG style', () => {
    expect(parseLightChar('Fl (2)R 5s').character).toBe('Fl(2)');
    expect(parseLightChar('Fl (2)R 5s').group).toBe('2');
    expect(parseLightChar('Fl (2+1)G 6s').group).toBe('2+1');
    expect(parseLightChar('Fl (1+4+3)W 45s').group).toBe('1+4+3');
    expect(parseLightChar('Fl(4+5) G 30s').group).toBe('4+5');
    expect(parseLightChar('FL (2) R 12s').character).toBe('Fl(2)');
    expect(parseLightChar('Fl (5) W 20S').period).toBe('20');
    expect(parseLightChar('Fl (5) W 20S').group).toBe('5');
  });

  it('handles colours before the group and multi-colour lights', () => {
    const sector = parseLightChar('Fl G (2)W 10s');
    expect(sector.group).toBe('2');
    expect(sector.colour).toBe('green');
    expect(parseLightChar('Al RG 20s').colour).toBe('red');
    expect(parseLightChar('F R W G').colour).toBe('red');
    expect(parseLightChar('Oc WRG 6s').colour).toBe('white');
  });

  it('folds Morse letters into the character, not the group', () => {
    expect(parseLightChar('Mo (U) W 20s')).toEqual({
      light: 'Mo (U) W 20s', character: 'Mo(U)', colour: 'white', period: '20', group: null,
    });
    expect(parseLightChar('Mo (A) W').character).toBe('Mo(A)');
  });

  it('keeps fixed-flashing and strobe characters', () => {
    expect(parseLightChar('FFl W 30s').character).toBe('FFl');
    expect(parseLightChar('STROBE')).toEqual({
      light: 'STROBE', character: 'STROBE', colour: null, period: null, group: null,
    });
    expect(parseLightChar(null).light).toBeNull();
  });
});

const feature = (overrides = {}) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [-72.2157, 44.9418] },
  properties: {
    LIGHT_LIST_NUMBER: 40095,
    VOLUME_NUMBER: '01',
    NAME: 'Lake Memphremagog Lighted Buoy 2',
    LIGHT_CHAR: 'Fl R 4s',
    LIGHT_NOM_RANGE: 5,
    LIGHT_NOM_RANGE_UNIT: 'NAUT MI',
    LIGHT_FOCAL_PLANE: 35,
    LIGHT_FOCAL_PLANE_UNIT: 'FT',
    HWATERWAY_NAME: 'Lake Memphremagog',
    STRUCTURE_REMARK: 'Red nun.',
    REMARK: 'Private Aid.',
    MODIFIED_DATE: 1770122101000,
    INACTIVE: '0',
    ...overrides,
  },
});

describe('featureToRecord', () => {
  it('trims a lit aid to the app record shape', () => {
    const { record, skip } = featureToRecord(feature(), 'lightListD01_1.geojson');
    expect(skip).toBeNull();
    expect(record).toMatchObject({
      v: '01',
      no: 40095,
      name: 'Lake Memphremagog Lighted Buoy 2',
      light: 'Fl R 4s',
      character: 'Fl',
      colour: 'red',
      period: '4',
      range: '5',
      focal: '35 ft',
      desc: 'Lake Memphremagog · Red nun. · Private Aid.',
      src: 'lightListD01_1.geojson',
    });
  });

  it('skips unlit aids, placeholders and inactive aids', () => {
    expect(featureToRecord(feature({ LIGHT_CHAR: null }), 'f').skip).toBe('unlit');
    expect(featureToRecord(feature({ LIGHT_LIST_NUMBER: null }), 'f').skip).toBe('no-id');
    expect(featureToRecord(feature({ INACTIVE: '1' }), 'f').skip).toBe('inactive');
    expect(featureToRecord({ ...feature(), geometry: null }, 'f').skip).toBe('no-geometry');
  });

  it('omits non-nautical-mile ranges rather than converting them silently', () => {
    const { record } = featureToRecord(
      feature({ LIGHT_NOM_RANGE: 6, LIGHT_NOM_RANGE_UNIT: 'STAT MI' }),
      'f',
    );
    expect(record.range).toBeNull();
  });

  it('rounds positions to 6 decimals', () => {
    const long = {
      ...feature(),
      geometry: { type: 'Point', coordinates: [-72.21568999999994, 44.94183000000004] },
    };
    const { record } = featureToRecord(long, 'f');
    expect(record.lat).toBe(44.94183);
    expect(record.lon).toBe(-72.21569);
  });
});

describe('dedupeUscg', () => {
  it('keys on volume plus number, latest revision wins', () => {
    const oldEntry = featureToRecord(feature({ MODIFIED_DATE: 1000 }), 'a');
    const newEntry = featureToRecord(feature({ MODIFIED_DATE: 2000, NAME: 'Renamed Buoy 2' }), 'b');
    const otherVolume = featureToRecord(feature({ VOLUME_NUMBER: '05' }), 'c');
    const out = dedupeUscg([oldEntry, newEntry, otherVolume]);
    expect(out).toHaveLength(2);
    expect(out.find((r) => r.v === '01').name).toBe('Renamed Buoy 2');
    expect(out.find((r) => r.v === '05')).toBeTruthy();
  });
});
