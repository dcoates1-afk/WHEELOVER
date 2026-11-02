import { describe, expect, it } from 'vitest';
import { bridgeCrossesWater, chartFeatureProperties, chartFeaturesFromElements, coalesceBridges, isTidalWater, type ChartFeature } from './overpass';

describe('water-crossing bridge detection', () => {
  it('does not treat a charted bridge over untidal water as a tidal bridge', () => {
    expect(bridgeCrossesWater(
      { type: 'way', tags: { 'seamark:type': 'bridge' }, geometry: [{ lat: 51, lon: -1 }, { lat: 51.001, lon: -1 }] },
      [{ type: 'way', tags: { waterway: 'river' }, geometry: [{ lat: 51, lon: -1 }, { lat: 51.001, lon: -1 }] }],
    )).toBe(false);
  });

  it('keeps bridges crossing explicitly tidal water', () => {
    expect(bridgeCrossesWater(
      { type: 'way', tags: { bridge: 'yes' }, geometry: [{ lat: 51, lon: -1.001 }, { lat: 51.001, lon: -0.999 }] },
      [{ type: 'way', tags: { waterway: 'river', tidal: 'yes' }, geometry: [{ lat: 51, lon: -1.0003 }, { lat: 51.001, lon: -1.0003 }] }],
    )).toBe(true);
  });

  it('keeps bridges crossing a mapped tidal channel', () => {
    expect(bridgeCrossesWater(
      { type: 'way', tags: { bridge: 'yes' }, geometry: [{ lat: 51, lon: -1.001 }, { lat: 51.001, lon: -0.999 }] },
      [{ type: 'way', tags: { waterway: 'tidal_channel' }, geometry: [{ lat: 51.0003, lon: -1.0003 }, { lat: 51.0007, lon: -1.0003 }] }],
    )).toBe(true);
  });

  it('does not count a bridge 50 m from tidal water as a water crossing', () => {
    expect(bridgeCrossesWater(
      { type: 'way', tags: { bridge: 'yes' }, geometry: [{ lat: 51, lon: -1 }, { lat: 51.001, lon: -1 }] },
      [{ type: 'way', tags: { waterway: 'river', tidal: 'yes' }, geometry: [{ lat: 51, lon: -1.00072 }, { lat: 51.001, lon: -1.00072 }] }],
    )).toBe(false);
  });

  it('still counts a bridge mapped 5 m short of tidal water', () => {
    expect(bridgeCrossesWater(
      { type: 'way', tags: { bridge: 'yes' }, geometry: [{ lat: 51, lon: -1 }, { lat: 51.001, lon: -1 }] },
      [{ type: 'way', tags: { waterway: 'river', tidal: 'yes' }, geometry: [{ lat: 51, lon: -1.00007 }, { lat: 51.001, lon: -1.00007 }] }],
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
          { geometry: [{ lat: 51, lon: -1.001 }, { lat: 51.0005, lon: -0.9995 }] },
          { geometry: [{ lat: 51.0005, lon: -0.9995 }, { lat: 51.001, lon: -1.001 }] },
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

  /** A tidal harbour polygon centred on `lat`, `lon`. */
  const harbour = (lat: number, lon: number, name = 'Harbour basin') => ({
    type: 'way' as const,
    tags: { 'seamark:type': 'harbour_basin', name },
    geometry: [
      { lat: lat - 0.01, lon: lon - 0.01 }, { lat: lat - 0.01, lon: lon + 0.01 },
      { lat: lat + 0.01, lon: lon + 0.01 }, { lat: lat + 0.01, lon: lon - 0.01 },
      { lat: lat - 0.01, lon: lon - 0.01 },
    ],
  });

  const riverReach = (lat: number) => ({
    type: 'way' as const,
    tags: { water: 'river', natural: 'water' },
    geometry: [{ lat, lon: -1.0003 }, { lat: lat + 0.001, lon: -1.0003 }],
  });

  const bridgeAt = (lat: number) => ({
    type: 'way' as const,
    tags: { bridge: 'yes' },
    geometry: [{ lat, lon: -1.001 }, { lat: lat + 0.001, lon: -0.999 }],
  });

  it('keeps a tidal river reach that carries no tidal tag but sits near open tidal water', () => {
    expect(bridgeCrossesWater(bridgeAt(51), [riverReach(51), harbour(51.06, -1)])).toBe(true);
  });

  it('does not treat a river far from any tidal water as tidal', () => {
    expect(bridgeCrossesWater(bridgeAt(51), [riverReach(51), harbour(51.3, -1)])).toBe(false);
  });

  it('does not let a river marina make the water it sits on tidal', () => {
    const marina = {
      type: 'way' as const,
      tags: { leisure: 'marina', natural: 'water', water: 'harbour', name: 'Riverside marina' },
      geometry: harbour(51.03, -1).geometry,
    };
    expect(bridgeCrossesWater(bridgeAt(51), [riverReach(51), marina])).toBe(false);
  });

  it('keeps a bridge crossing a long channel whose segments run well past it', () => {
    expect(bridgeCrossesWater(
      { type: 'way', tags: { bridge: 'yes' }, geometry: [{ lat: 51, lon: -0.9 }, { lat: 51, lon: -1.1 }] },
      [{
        type: 'way',
        tags: { waterway: 'tidal_channel', name: 'Long approach channel' },
        geometry: [{ lat: 49, lon: -1 }, { lat: 53, lon: -1 }],
      }],
    )).toBe(true);
  });
});

describe('bridge record merging', () => {
  // A tidal river crossing with a road bridge part and a parallel cycleway part,
  // which is how OSM maps Northam Bridge over the Itchen.
  const river = {
    type: 'way',
    id: 1,
    tags: { waterway: 'river', tidal: 'yes', name: 'River Itchen' },
    geometry: [{ lat: 50.9, lon: -1.39 }, { lat: 50.93, lon: -1.39 }],
  };
  const road = {
    type: 'way',
    id: 10,
    tags: { bridge: 'yes', name: 'Northam Bridge', highway: 'primary', 'seamark:bridge:clearance_height': '5.2' },
    geometry: [{ lat: 50.914, lon: -1.4 }, { lat: 50.914, lon: -1.38 }],
  };
  const cycleway = {
    type: 'way',
    id: 11,
    tags: { bridge: 'yes', name: 'Northam Bridge', highway: 'cycleway' },
    geometry: [{ lat: 50.9141, lon: -1.4 }, { lat: 50.9141, lon: -1.38 }],
  };

  it('keeps the road class and the water crossed when a footway part joins the bridge', () => {
    const { bridges } = chartFeaturesFromElements([river, road, cycleway]);
    expect(bridges).toHaveLength(1);
    expect(bridges[0].properties.highway).toBe('primary');
    expect(bridges[0].properties['water crossed']).toBe('River Itchen');
    expect(bridges[0].properties['seamark:bridge:clearance_height']).toBe('5.2');
  });

  it('does not let a cycleway part rename a bridge that crosses river water', () => {
    const { bridges } = chartFeaturesFromElements([river, cycleway, road]);
    expect(bridges).toHaveLength(1);
    expect(bridges[0].properties['water crossed']).toBe('River Itchen');
    expect(bridges[0].properties.highway).toBe('primary');
  });

  it('still merges two parts of the same footbridge into one chart mark', () => {
    const first = {
      type: 'way',
      id: 20,
      tags: { bridge: 'yes', name: 'Chantry Footbridge', highway: 'footway' },
      geometry: [{ lat: 50.900, lon: -1.4 }, { lat: 50.900, lon: -1.39 }],
    };
    const second = {
      type: 'way',
      id: 21,
      tags: { bridge: 'yes', name: 'Chantry Footbridge', highway: 'footway' },
      geometry: [{ lat: 50.900, lon: -1.39 }, { lat: 50.900, lon: -1.38 }],
    };
    const { bridges } = chartFeaturesFromElements([river, first, second]);
    expect(bridges).toHaveLength(1);
    expect(bridges[0].properties.highway).toBe('footway');
  });
});

describe('bridge overlay coalescing', () => {
  const feature = (overrides: Partial<ChartFeature>): ChartFeature => ({
    id: 'osm:way/1',
    type: 'bridge',
    waterCrossing: true,
    name: 'Test Bridge',
    lat: 50.914,
    lon: -1.39,
    path: [[50.914, -1.4], [50.914, -1.38]],
    paths: [[[50.914, -1.4], [50.914, -1.38]]],
    properties: {},
    sourceUrl: 'https://www.openstreetmap.org/way/1',
    ...overrides,
  });

  it('merges a named part with an unnamed part of the same crossing', () => {
    const named = feature({ id: 'osm:way/1', name: 'Test Bridge', properties: { highway: 'primary' } });
    const unnamed = feature({
      id: 'osm:way/2',
      name: 'Bridge',
      lat: 50.9141,
      lon: -1.39,
      path: [[50.9141, -1.4], [50.9141, -1.38]] as [number, number][],
      properties: { 'seamark:bridge:clearance_height': '5.2' },
      sourceUrl: 'https://www.openstreetmap.org/way/2',
    });
    const merged = coalesceBridges([named, unnamed]);
    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe('Test Bridge');
    expect(merged[0].properties.highway).toBe('primary');
    expect(merged[0].properties['seamark:bridge:clearance_height']).toBe('5.2');
    expect(merged[0].sourceUrls).toEqual([
      'https://www.openstreetmap.org/way/1',
      'https://www.openstreetmap.org/way/2',
    ]);
  });

  it('merges parts whose names differ only by case and a trailing generic word', () => {
    const first = feature({ id: 'osm:way/1', name: 'Test Bridge' });
    const second = feature({
      id: 'osm:way/2',
      name: 'TEST BRIDGE',
      lat: 50.9142,
      lon: -1.39,
      path: [[50.9142, -1.4], [50.9142, -1.38]] as [number, number][],
      sourceUrl: 'https://www.openstreetmap.org/way/2',
    });
    expect(coalesceBridges([first, second])).toHaveLength(1);
  });

  it('keeps every distinct mapped value instead of letting the last part win', () => {
    const first = feature({
      id: 'osm:way/1',
      properties: { 'seamark:bridge:clearance_height': '5.2', operator: 'City' },
    });
    const second = feature({
      id: 'osm:way/2',
      lat: 50.9141,
      lon: -1.39,
      path: [[50.9141, -1.4], [50.9141, -1.38]] as [number, number][],
      properties: { 'seamark:bridge:clearance_height': '4.8', operator: 'City' },
      sourceUrl: 'https://www.openstreetmap.org/way/2',
    });
    const merged = coalesceBridges([first, second]);
    expect(merged).toHaveLength(1);
    expect(merged[0].properties['seamark:bridge:clearance_height']).toBe('5.2 / 4.8');
    expect(merged[0].properties.operator).toBe('City');
  });

  it('does not merge two different bridges that share a name but sit apart', () => {
    const first = feature({ id: 'osm:way/1', name: 'Railway Bridge' });
    const second = feature({
      id: 'osm:way/2',
      name: 'Railway Bridge',
      lat: 50.924,
      lon: -1.39,
      path: [[50.924, -1.4], [50.924, -1.38]] as [number, number][],
      sourceUrl: 'https://www.openstreetmap.org/way/2',
    });
    expect(coalesceBridges([first, second])).toHaveLength(2);
  });

  it('does not rewrite the features handed in', () => {
    const first = feature({ id: 'osm:way/1', properties: { highway: 'primary' } });
    const second = feature({
      id: 'osm:way/2',
      lat: 50.9141,
      lon: -1.39,
      path: [[50.9141, -1.4], [50.9141, -1.38]] as [number, number][],
      properties: { 'seamark:bridge:clearance_height': '5.2' },
      sourceUrl: 'https://www.openstreetmap.org/way/2',
    });
    coalesceBridges([first, second]);
    expect(first.path).toHaveLength(2);
    expect(first.properties).toEqual({ highway: 'primary' });
    expect(first.sourceUrls).toBeUndefined();
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
