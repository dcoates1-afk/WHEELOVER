import { describe, expect, it } from 'vitest';
import {
  detectDatum,
  extractRecords,
  ftToM,
  parseBridgeType,
  parseCoordinate,
  volumeDatum,
} from '../../scripts/coast-pilot-parse.mjs';

describe('coast pilot parser', () => {
  it('converts feet to metres to one decimal', () => {
    expect(ftToM(15)).toBe(4.6);
    expect(ftToM(231)).toBe(70.4);
    expect(ftToM(135)).toBe(41.1);
    expect(ftToM(13)).toBe(4.0);
  });

  it('uses MHW by default and LWD for the Great Lakes volume', () => {
    expect(volumeDatum('cp7')).toBe('MHW');
    expect(volumeDatum('cp6')).toBe('LWD');
    expect(detectDatum('a clearance of 26 feet above normal pool level', 'MHW')).toBe('normal pool');
  });

  it('parses degrees-decimal-minutes positions', () => {
    expect(parseCoordinate("PARK STREET BRIDGE 37° 46.3' N 122° 14.2' W")).toEqual({
      lat: 37.7717,
      lon: -122.2367,
    });
  });

  it('parses degrees-minutes-seconds positions', () => {
    expect(parseCoordinate('38°03\'55"N., 121°47\'09"W.')).toEqual({
      lat: 38.0653,
      lon: -121.7858,
    });
  });

  it('reads the waterway from crossing and over phrasing', () => {
    const text = [
      'The San Mateo-Hayward Bridge crossing the lower part of San Francisco Bay near San Mateo has a fixed span with a clearance of 135 feet over the main channel.',
    ].join('\n\n');
    const { records } = extractRecords(text, 'cp7', 'CP7 Ch.7');
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ n: 'San Mateo-Hayward Bridge', w: 'San Francisco Bay', v: [41.1] });
  });

  it('reads bridge kinds from passage wording', () => {
    expect(parseBridgeType('The vertical lift railroad bridge')).toBe('lift');
    expect(parseBridgeType('The bascule bridge')).toBe('bascule');
    expect(parseBridgeType('a fixed highway bridge')).toBe('fixed');
  });

  it('extracts a named fixed bridge passage', () => {
    const text = [
      'Golden Gate Bridge, crossing the Golden Gate (strait) from Fort Point to Lime Point,',
      'has a clearance of 231 feet at the center of the 4,028-foot-wide channel span.',
    ].join('\n');
    const { records, dropped } = extractRecords(text, 'cp7', 'CP7 Ch.7');
    expect(dropped).toEqual([]);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      n: 'Golden Gate Bridge',
      v: [70.4],
      c: true,
      o: null,
      d: 'MHW',
      least: false,
    });
  });

  it('extracts a group least statement as one group record', () => {
    const text = [
      'Oakland Inner Harbor is that part of Inner Harbor Channel extending E from San Francisco Bay to Tidal Canal.',
      'The three highway drawbridges across Tidal Canal have a least clearance of 15 feet.',
      'The vertical lift railroad bridge across Tidal Canal has a clearance of 13 feet down and 135 feet up.',
    ].join('\n\n');
    const { records } = extractRecords(text, 'cp7', 'CP7 Ch.7');
    const group = records.find((r) => r.least && r.g);
    expect(group).toMatchObject({
      n: null,
      w: 'Tidal Canal',
      v: [4.6],
      least: true,
      g: 'three highway drawbridges across Tidal Canal',
    });
    const lift = records.find((r) => r.o !== null);
    expect(lift).toMatchObject({ v: [4.0], o: [41.1], t: 'lift', w: 'Tidal Canal' });
  });

  it('reads a down, partially open and fully open lift bridge', () => {
    const text = [
      'The vertical lift railroad bridge across Tidal Canal has a clearance of 13 feet down, 80 feet partially open and 135 feet fully open.',
    ].join('\n\n');
    const { records } = extractRecords(text, 'cp7', 'CP7 Ch.7');
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ v: [4.0], o: [41.1], t: 'lift', w: 'Tidal Canal' });
  });

  it('drops a clearance that belongs to a cable, not a bridge', () => {
    const text = [
      'The power cable east of the bridge has a clearance of 108 feet.',
    ].join('\n\n');
    const { records, dropped } = extractRecords(text, 'cp7', 'CP7 Ch.7');
    expect(records).toEqual([]);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].reason).toBe('clearance subject is not a bridge');
  });

  it('inherits the paragraph crossing phrase as the waterway', () => {
    const text = [
      'The bridge crossing the Napa River is old and narrow.',
      'The Railroad Bridge has a clearance of 20 feet.',
    ].join(' ');
    const { records } = extractRecords(text, 'cp7', 'CP7 Ch.7');
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ n: 'Railroad Bridge', w: 'Napa River', v: [6.1] });
  });

  it('takes the vertical figure when horizontal is listed first', () => {
    const text = [
      'The bridge over the south channel has a fixed span with a horizontal clearance of 40 feet and a vertical clearance of 7 feet.',
    ].join('\n\n');
    const { records } = extractRecords(text, 'cp1', 'CP1 Ch.5');
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ v: [2.1], h: 12.2 });
  });

  it('drops a sentence with only a horizontal clearance', () => {
    const text = [
      'The bridge over the channel has a horizontal clearance of 40 feet.',
    ].join('\n\n');
    const { records } = extractRecords(text, 'cp1', 'CP1 Ch.5');
    expect(records).toEqual([]);
  });

  it('prefers a sentence position over the paragraph position', () => {
    const text = [
      'The A Bridge at 37°00\'N 122°00\'W has a clearance of 10 feet.',
      'The B Bridge at 38°00\'N 123°00\'W has a clearance of 20 feet.',
    ].join(' ');
    const { records } = extractRecords(text, 'cp7', 'CP7 Ch.7');
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ n: 'A Bridge', la: 37, lo: -122 });
    expect(records[1]).toMatchObject({ n: 'B Bridge', la: 38, lo: -123 });
  });

  it('truncates a heading run into the next sentence', () => {
    const text = [
      'Bridges The Peace Bridge has a clearance of 100 feet.',
    ].join('\n\n');
    const { records } = extractRecords(text, 'cp6', 'CP6 Ch.6');
    expect(records).toHaveLength(1);
    expect(records[0].n).toBe('Peace Bridge');
  });

  it('drops a clearance sentence it cannot attribute to one bridge', () => {
    const text = [
      'The 3rd and 4th Street bascule bridges across the canal have a least clearance of 1 foot.',
    ].join('\n\n');
    const { records, dropped } = extractRecords(text, 'cp7', 'CP7 Ch.7');
    expect(records).toEqual([]);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].reason).toBe('no bridge name');
  });
});
