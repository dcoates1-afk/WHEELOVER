import { describe, expect, it } from 'vitest';
import { bridgeCrossesWater, chartFeatureProperties, isTidalWater } from './overpass';

describe('water-crossing bridge detection', () => {
  it('does not treat a charted bridge over untidal water as a tidal bridge', () => {
    expect(bridgeCrossesWater(
      { type: 'way', tags: { 'seamark:type': 'bridge' }, geometry: [{ lat: 51, lon: -1 }, { lat: 51.001, lon: -1 }] },
      [{ type: 'way', tags: { waterway: 'river' }, geometry: [{ lat: 51, lon: -1 }, { lat: 51.001, lon: -1 }] }],
    )).toBe(false);
  });

  it('keeps bridges crossing explicitly tidal water', () => {
    expect(bridgeCrossesWater(
      { type: 'way', tags: { bridge: 'yes' }, geometry: [{ lat: 51, lon: -1 }, { lat: 51.001, lon: -1 }] },
      [{ type: 'way', tags: { waterway: 'river', tidal: 'yes' }, geometry: [{ lat: 51, lon: -1.0003 }, { lat: 51.001, lon: -1.0003 }] }],
    )).toBe(true);
  });

  it('keeps bridges crossing a mapped tidal channel', () => {
    expect(bridgeCrossesWater(
      { type: 'way', tags: { bridge: 'yes' }, geometry: [{ lat: 51, lon: -1 }, { lat: 51.001, lon: -1 }] },
      [{ type: 'way', tags: { waterway: 'tidal_channel' }, geometry: [{ lat: 51.0003, lon: -1.0003 }, { lat: 51.0007, lon: -1.0003 }] }],
    )).toBe(true);
  });

  it('does not include bridges over rivers that lack tidal tags', () => {
    expect(bridgeCrossesWater(
      { type: 'way', tags: { bridge: 'yes' }, geometry: [{ lat: 51, lon: -1 }, { lat: 51.001, lon: -1 }] },
      [{ type: 'way', tags: { waterway: 'river' }, geometry: [{ lat: 51.0003, lon: -1.0003 }, { lat: 51.0007, lon: -1.0003 }] }],
    )).toBe(false);
  });

  it('does not match a nearby inland canal even with imperfect geometry', () => {
    expect(bridgeCrossesWater(
      { type: 'way', tags: { bridge: 'yes' }, geometry: [{ lat: 51, lon: -1 }, { lat: 51.001, lon: -1 }] },
      [{ type: 'way', tags: { waterway: 'canal' }, geometry: [{ lat: 51, lon: -1.0003 }, { lat: 51.001, lon: -1.0003 }] }],
    )).toBe(false);
  });

  it('treats a mapped bay, strait or harbour as tidal water', () => {
    expect(isTidalWater({ natural: 'bay' })).toBe(true);
    expect(isTidalWater({ natural: 'strait' })).toBe(true);
    expect(isTidalWater({ water: 'sea' })).toBe(true);
    expect(isTidalWater({ water: 'estuary' })).toBe(true);
    expect(isTidalWater({ 'seamark:type': 'harbour_basin' })).toBe(true);
    expect(isTidalWater({ harbour: 'yes' })).toBe(true);
    expect(isTidalWater({ waterway: 'river' })).toBe(false);
    expect(isTidalWater({ natural: 'water', water: 'lake' })).toBe(false);
    expect(isTidalWater(undefined)).toBe(false);
  });

  it('keeps a bridge crossing an estuary mapped only as a bay', () => {
    expect(bridgeCrossesWater(
      { type: 'way', tags: { bridge: 'yes' }, geometry: [{ lat: 50.1, lon: -3.2 }, { lat: 50.12, lon: -3.2 }] },
      [{
        type: 'way',
        tags: { natural: 'bay', name: 'Estuary mouth' },
        geometry: [
          { lat: 50.0, lon: -3.4 }, { lat: 50.0, lon: -3.0 },
          { lat: 50.3, lon: -3.0 }, { lat: 50.3, lon: -3.4 }, { lat: 50.0, lon: -3.4 },
        ],
      }],
    )).toBe(true);
  });

  it('keeps a bridge inside a mapped harbour basin', () => {
    expect(bridgeCrossesWater(
      { type: 'way', tags: { bridge: 'yes' }, geometry: [{ lat: 50.9, lon: -1.4 }, { lat: 50.9, lon: -1.38 }] },
      [{
        type: 'way',
        tags: { 'seamark:type': 'harbour_basin', name: 'Inner harbour' },
        geometry: [
          { lat: 50.89, lon: -1.41 }, { lat: 50.89, lon: -1.37 },
          { lat: 50.91, lon: -1.37 }, { lat: 50.91, lon: -1.41 }, { lat: 50.89, lon: -1.41 },
        ],
      }],
    )).toBe(true);
  });

  it('keeps a bridge crossing a water body mapped as a multipolygon relation', () => {
    expect(bridgeCrossesWater(
      { type: 'way', tags: { bridge: 'yes' }, geometry: [{ lat: 50.1, lon: -3.2 }, { lat: 50.12, lon: -3.2 }] },
      [{
        type: 'relation',
        tags: { natural: 'bay', name: 'Estuary mouth' },
        members: [
          { geometry: [{ lat: 50.0, lon: -3.4 }, { lat: 50.0, lon: -3.0 }, { lat: 50.3, lon: -3.0 }] },
          { geometry: [{ lat: 50.3, lon: -3.0 }, { lat: 50.3, lon: -3.4 }, { lat: 50.0, lon: -3.4 }] },
        ],
      }],
    )).toBe(true);
  });

  it('keeps a bridge that is itself mapped only as relation members', () => {
    expect(bridgeCrossesWater(
      {
        type: 'relation',
        tags: { bridge: 'yes' },
        members: [
          { geometry: [{ lat: 51, lon: -1 }, { lat: 51.0005, lon: -1 }] },
          { geometry: [{ lat: 51.0005, lon: -1 }, { lat: 51.001, lon: -1 }] },
        ],
      },
      [{ type: 'way', tags: { water: 'estuary' }, geometry: [{ lat: 51, lon: -1.0003 }, { lat: 51.001, lon: -1.0003 }] }],
    )).toBe(true);
  });

  it('does not accept ordinary bridges far from mapped water', () => {
    expect(bridgeCrossesWater(
      { type: 'way', tags: { bridge: 'yes' }, geometry: [{ lat: 51, lon: -1 }, { lat: 51.001, lon: -1 }] },
      [{ type: 'way', tags: { waterway: 'river' }, geometry: [{ lat: 51, lon: -1.01 }, { lat: 51.001, lon: -1.01 }] }],
    )).toBe(false);
  });
});

describe('chart feature popup data', () => {
  it('reads the designation and operator before the incidental tags', () => {
    const properties = chartFeatureProperties({
      website: 'https://example.org',
      designation: 'Special Area of Conservation',
      name: 'Example site',
      operator: 'Nature agency',
      protection_title: 'Marine protected area',
      access: 'no',
    });
    expect(Object.keys(properties).slice(0, 4)).toEqual(['name', 'designation', 'protection_title', 'operator']);
    expect(properties.website).toBe('https://example.org');
    expect(properties.access).toBe('no');
  });

  it('drops blank and oversized values', () => {
    const properties = chartFeatureProperties({ name: '  ', note: 'x'.repeat(500), operator: 'Agency' });
    expect(properties).toEqual({ operator: 'Agency' });
  });
});
