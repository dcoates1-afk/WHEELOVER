import { describe, expect, it } from 'vitest';
import type { Navaid } from './navaidTypes';
import {
  applyMarkDetailIndex,
  applyMarkDetails,
  markDetailCellsForBounds,
  markDetailsFromTags,
  validateMarkDetailCell,
  validateMarkDetailManifest,
  type MarkDetailEntry,
  type MarkDetailManifest,
} from './markDetails';
import { markDetailRows } from '../../shared/mark-detail-core.mjs';

const manifest: MarkDetailManifest = {
  schema: 1,
  generatedAt: '2026-11-01T00:00:00.000Z',
  sourceTimestamp: '2026-11-01T17:57:55Z',
  count: 2,
  cells: [
    { path: 'mark-details/28_35.json', bounds: [50, -5, 55, 0], count: 1 },
    { path: 'mark-details/10_21.json', bounds: [-40, -75, -35, -70], count: 1 },
  ],
};

function mark(overrides: Partial<Navaid> = {}): Navaid {
  return {
    id: 'osm:way/128637893',
    lat: 50.708,
    lon: -1.55,
    category: 'major_light',
    form: 'landmark',
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
    channel: null,
    description: null,
    lit: true,
    priority: 100,
    source: 'osm',
    updated: null,
    region: null,
    ...overrides,
  };
}

const entry: MarkDetailEntry = {
  name: 'Hurst Point',
  markType: 'landmark',
  markCategory: 'tower',
  colour: 'white',
  topmarkShape: 'triangle',
  height: '23',
  details: { 'seamark:light:reference': 'A 0538.1', wikidata: 'Q2752732' },
  lat: 50.707951,
  lon: -1.550331,
};

describe('mark detail manifest', () => {
  it('accepts a shaped manifest and rejects other schemas', () => {
    expect(validateMarkDetailManifest(manifest)?.cells).toHaveLength(2);
    expect(validateMarkDetailManifest({ ...manifest, schema: 2 })).toBeNull();
    expect(validateMarkDetailManifest({ ...manifest, cells: [] })).toBeNull();
  });

  it('selects only the cells that meet the viewport', () => {
    expect(markDetailCellsForBounds(validateMarkDetailManifest(manifest)!, [49, -3, 52, 0]).map((cell) => cell.path))
      .toEqual(['mark-details/28_35.json']);
  });
});

describe('mark detail cell', () => {
  it('keeps string fields and drops unknown shapes', () => {
    const cells = validateMarkDetailCell({
      marks: {
        'osm:node/1': { colour: 'red', height: 12, details: { operator: 'Harbour board', note: '  ' } },
        'osm:node/2': { height: 12 },
      },
    });
    expect(cells?.get('osm:node/1')?.colour).toBe('red');
    expect(cells?.get('osm:node/1')?.height).toBeUndefined();
    expect(cells?.get('osm:node/1')?.details).toEqual({ operator: 'Harbour board' });
    expect(cells?.has('osm:node/2')).toBe(false);
  });

  it('rejects a payload without marks', () => {
    expect(validateMarkDetailCell({})).toBeNull();
    expect(validateMarkDetailCell(null)).toBeNull();
  });
});

describe('attaching detail to archive marks', () => {
  it('fills the blank fields and keeps the existing values', () => {
    const next = applyMarkDetails(mark({ name: 'Hurst Point Lighthouse', colour: 'grey' }), entry);
    expect(next.name).toBe('Hurst Point Lighthouse');
    expect(next.colour).toBe('grey');
    expect(next.topmarkShape).toBe('triangle');
    expect(next.height).toBe('23');
    expect(next.details).toEqual({ 'seamark:light:reference': 'A 0538.1', wikidata: 'Q2752732' });
  });

  it('returns the same mark when the index adds nothing', () => {
    const settled = mark({
      name: 'Hurst Point',
      markType: 'landmark',
      markCategory: 'tower',
      colour: 'white',
      topmarkShape: 'triangle',
      height: '23',
      details: { 'seamark:light:reference': 'A 0538.1', wikidata: 'Q2752732' },
    });
    expect(applyMarkDetails(settled, entry)).toBe(settled);
  });

  it('returns the same array when no mark matches', () => {
    const marks = [mark()];
    expect(applyMarkDetailIndex(marks, new Map())).toBe(marks);
    expect(applyMarkDetailIndex(marks, new Map([['osm:node/9', entry]]))).toBe(marks);
  });

  it('applies the index to the marks it has records for', () => {
    const [next] = applyMarkDetailIndex([mark()], new Map([[mark().id, entry]]));
    expect(next.name).toBe('Hurst Point');
  });
});

describe('detail taken from live tags', () => {
  it('maps the shared fields and keeps the rest as details', () => {
    const detail = markDetailsFromTags({
      'seamark:name': 'Hurst Point',
      'seamark:type': 'landmark',
      'seamark:landmark:category': 'tower',
      'seamark:topmark:shape': 'triangle',
      'seamark:light:reference': 'A 0538.1',
      'seamark:light:1:sector_start': '80',
      'wikipedia': 'en:Hurst Point Lighthouse',
      'building': 'yes',
    });
    expect(detail?.name).toBe('Hurst Point');
    expect(detail?.markCategory).toBe('tower');
    expect(detail?.topmarkShape).toBe('triangle');
    expect(detail?.details).toEqual({
      'seamark:light:reference': 'A 0538.1',
      wikipedia: 'en:Hurst Point Lighthouse',
      building: 'yes',
    });
  });

  it('returns null for a tag set with nothing usable', () => {
    expect(markDetailsFromTags({})).toBeNull();
    expect(markDetailsFromTags(undefined)).toBeNull();
  });

  it('labels detail rows for the card', () => {
    expect(markDetailRows({ 'seamark:light:reference': 'A 0538.1', 'bridge:movable': 'swing' })).toEqual([
      ['Bridge movable', 'swing'],
      ['Light reference', 'A 0538.1'],
    ]);
  });
});
