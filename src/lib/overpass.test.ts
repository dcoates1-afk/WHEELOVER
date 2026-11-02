import { describe, expect, it, vi } from 'vitest';
import { bridgeCrossesWater, chartFeatureProperties, chartFeaturesFromElements, coalesceBridges, isTidalWater, queryChartFeaturePart, type ChartFeature } from './overpass';

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

  it('keeps Cobden Bridge over the Itchen on its real mapped geometry', () => {
    // Real OSM geometry (Nov 2026): Cobden Bridge way 4605583 and the tidal
    // River Itchen centreline way 311105586. The bridge segment crosses the
    // centreline between its second and third points, so the water test must
    // keep it — its absence from the chart is a fetch problem, not a
    // matching problem.
    expect(bridgeCrossesWater(
      {
        type: 'way',
        tags: { bridge: 'yes', highway: 'primary', name: 'Cobden Bridge', 'bridge:name': 'Cobden Bridge' },
        geometry: [{ lat: 50.9244172, lon: -1.3776270 }, { lat: 50.9244527, lon: -1.3793024 }],
      },
      [{
        type: 'way',
        tags: { waterway: 'river', tidal: 'yes', name: 'River Itchen' },
        geometry: [
          { lat: 50.9249631, lon: -1.3786785 },
          { lat: 50.9246088, lon: -1.3784284 },
          { lat: 50.9241774, lon: -1.3782821 },
          { lat: 50.9237947, lon: -1.3781562 },
        ],
      }],
    )).toBe(true);
  });

  it('keeps the West Coastway Line crossing over the Itchen on its real mapped geometry', () => {
    expect(bridgeCrossesWater(
      {
        type: 'way',
        tags: { bridge: 'yes', railway: 'rail', name: 'West Coastway Line' },
        geometry: [{ lat: 50.9212482, lon: -1.3801931 }, { lat: 50.9204602, lon: -1.3793580 }],
      },
      [{
        type: 'way',
        tags: { waterway: 'river', tidal: 'yes', name: 'River Itchen' },
        geometry: [
          { lat: 50.9219445, lon: -1.3780507 },
          { lat: 50.9215512, lon: -1.3782771 },
          { lat: 50.9211970, lon: -1.3787993 },
          { lat: 50.9209040, lon: -1.3794704 },
          { lat: 50.9207122, lon: -1.3800984 },
        ],
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

  it('keeps Cobden Bridge and the West Coastway crossing through the full chart pipeline', () => {
    // Real Itchen geometry (Nov 2026): the tidal centreline way 311105586
    // plus Cobden Bridge way 4605583 and a West Coastway span, run through
    // the same pipeline the chart uses. If these survive here, a deployed
    // absence is a fetch problem, not a matching problem.
    const centreline = {
      type: 'way',
      id: 311105586,
      tags: { waterway: 'river', tidal: 'yes', name: 'River Itchen' },
      geometry: [
        { lat: 50.9249631, lon: -1.3786785 },
        { lat: 50.9246088, lon: -1.3784284 },
        { lat: 50.9241774, lon: -1.3782821 },
        { lat: 50.9237947, lon: -1.3781562 },
        { lat: 50.9219445, lon: -1.3780507 },
        { lat: 50.9215512, lon: -1.3782771 },
        { lat: 50.9211970, lon: -1.3787993 },
        { lat: 50.9209040, lon: -1.3794704 },
        { lat: 50.9207122, lon: -1.3800984 },
      ],
    };
    const cobden = {
      type: 'way',
      id: 4605583,
      tags: { bridge: 'yes', highway: 'primary', name: 'Cobden Bridge', 'bridge:name': 'Cobden Bridge' },
      geometry: [{ lat: 50.9244172, lon: -1.3776270 }, { lat: 50.9244527, lon: -1.3793024 }],
    };
    const coastway = {
      type: 'way',
      id: 24299041,
      tags: { bridge: 'yes', railway: 'rail', name: 'West Coastway Line' },
      geometry: [{ lat: 50.9212482, lon: -1.3801931 }, { lat: 50.9204602, lon: -1.3793580 }],
    };
    const { bridges } = chartFeaturesFromElements([centreline, cobden, coastway]);
    expect(bridges.map((bridge) => bridge.name).sort()).toEqual(['Cobden Bridge', 'West Coastway Line']);
    for (const bridge of bridges) expect(bridge.properties['water crossed']).toBe('River Itchen');
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

  it('folds approach segments that meet across a street-name change', () => {
    // Johnson Street Bridge: the road becomes Pandora Avenue east of the
    // bridge and Esquimalt Road west of it, each tagged bridge=yes under its
    // own name. The segments meet end to end, cross the same water, and carry
    // the same road class, so they are one crossing.
    const deck = feature({
      id: 'osm:way/10',
      name: 'Johnson Street',
      lat: 48.4255,
      lon: -123.37,
      path: [[48.4255, -123.371], [48.4255, -123.369]] as [number, number][],
      paths: [[[48.4255, -123.371], [48.4255, -123.369]]] as [number, number][][],
      properties: { highway: 'secondary', 'water crossed': 'Victoria Upper Harbour' },
      sourceUrl: 'https://www.openstreetmap.org/way/10',
    });
    const east = feature({
      id: 'osm:way/11',
      name: 'Pandora Avenue',
      lat: 48.4255,
      lon: -123.3685,
      path: [[48.4255, -123.369], [48.4255, -123.368]] as [number, number][],
      paths: [[[48.4255, -123.369], [48.4255, -123.368]]] as [number, number][][],
      properties: { highway: 'secondary', 'water crossed': 'Victoria Upper Harbour' },
      sourceUrl: 'https://www.openstreetmap.org/way/11',
    });
    const merged = coalesceBridges([deck, east]);
    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe('Johnson Street');
    expect(merged[0].sourceUrls).toEqual([
      'https://www.openstreetmap.org/way/10',
      'https://www.openstreetmap.org/way/11',
    ]);
  });

  it('does not fold connected segments that cross different water or carry a different class', () => {
    const deck = feature({
      id: 'osm:way/10',
      name: 'Johnson Street',
      lat: 48.4255,
      lon: -123.37,
      path: [[48.4255, -123.371], [48.4255, -123.369]] as [number, number][],
      paths: [[[48.4255, -123.371], [48.4255, -123.369]]] as [number, number][][],
      properties: { highway: 'secondary', 'water crossed': 'Victoria Upper Harbour' },
      sourceUrl: 'https://www.openstreetmap.org/way/10',
    });
    const otherWater = feature({
      id: 'osm:way/12',
      name: 'Pandora Avenue',
      lat: 48.4255,
      lon: -123.3685,
      path: [[48.4255, -123.369], [48.4255, -123.368]] as [number, number][],
      paths: [[[48.4255, -123.369], [48.4255, -123.368]]] as [number, number][][],
      properties: { highway: 'secondary', 'water crossed': 'Victoria Harbour' },
      sourceUrl: 'https://www.openstreetmap.org/way/12',
    });
    expect(coalesceBridges([deck, otherWater])).toHaveLength(2);
    const footway = feature({
      id: 'osm:way/13',
      name: 'Harbour Walk',
      lat: 48.4255,
      lon: -123.3685,
      path: [[48.4255, -123.369], [48.4255, -123.368]] as [number, number][],
      paths: [[[48.4255, -123.369], [48.4255, -123.368]]] as [number, number][][],
      properties: { highway: 'footway', 'water crossed': 'Victoria Upper Harbour' },
      sourceUrl: 'https://www.openstreetmap.org/way/13',
    });
    expect(coalesceBridges([deck, footway])).toHaveLength(2);
  });

  it('folds a road running inside a bridge outline into the outline', () => {
    // Point Ellice Bridge: the outline is named for the bridge, the road
    // over it is named Bay Street. The road's line runs inside the outline's
    // ring, so the chart shows one card titled for the bridge.
    const ring: [number, number][] = [[50.0, -1.0], [50.0, -1.002], [50.002, -1.002], [50.002, -1.0], [50.0, -1.0]];
    const outline = feature({
      id: 'osm:way/20',
      name: 'Point Ellice Bridge',
      lat: 50.001,
      lon: -1.001,
      path: ring,
      paths: [ring],
      rings: [ring],
      properties: { 'water crossed': 'Gorge Waterway' },
      sourceUrl: 'https://www.openstreetmap.org/way/20',
    });
    const road = feature({
      id: 'osm:way/21',
      name: 'Bay Street',
      lat: 50.001,
      lon: -1.001,
      path: [[50.001, -1.0018], [50.001, -1.0002]] as [number, number][],
      paths: [[[50.001, -1.0018], [50.001, -1.0002]]] as [number, number][][],
      properties: { highway: 'secondary', 'water crossed': 'Gorge Waterway' },
      sourceUrl: 'https://www.openstreetmap.org/way/21',
    });
    const merged = coalesceBridges([outline, road]);
    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe('Point Ellice Bridge');
    expect(merged[0].sourceUrls).toEqual([
      'https://www.openstreetmap.org/way/20',
      'https://www.openstreetmap.org/way/21',
    ]);
  });

  it('does not fold a road that only touches a bridge outline at its end', () => {
    const ring: [number, number][] = [[50.0, -1.0], [50.0, -1.002], [50.002, -1.002], [50.002, -1.0], [50.0, -1.0]];
    const outline = feature({
      id: 'osm:way/20',
      name: 'Point Ellice Bridge',
      lat: 50.001,
      lon: -1.001,
      path: ring,
      paths: [ring],
      rings: [ring],
      properties: { 'water crossed': 'Gorge Waterway' },
      sourceUrl: 'https://www.openstreetmap.org/way/20',
    });
    const approach = feature({
      id: 'osm:way/22',
      name: 'Bay Street',
      lat: 50.001,
      lon: -1.003,
      path: [[50.001, -1.002], [50.001, -1.004]] as [number, number][],
      paths: [[[50.001, -1.002], [50.001, -1.004]]] as [number, number][][],
      properties: { highway: 'secondary', 'water crossed': 'Gorge Waterway' },
      sourceUrl: 'https://www.openstreetmap.org/way/22',
    });
    expect(coalesceBridges([outline, approach])).toHaveLength(2);
  });

  it('does not fold a road inside an outline when they cross different water', () => {
    const ring: [number, number][] = [[50.0, -1.0], [50.0, -1.002], [50.002, -1.002], [50.002, -1.0], [50.0, -1.0]];
    const outline = feature({
      id: 'osm:way/20',
      name: 'Point Ellice Bridge',
      lat: 50.001,
      lon: -1.001,
      path: ring,
      paths: [ring],
      rings: [ring],
      properties: { 'water crossed': 'Gorge Waterway' },
      sourceUrl: 'https://www.openstreetmap.org/way/20',
    });
    const road = feature({
      id: 'osm:way/21',
      name: 'Bay Street',
      lat: 50.001,
      lon: -1.001,
      path: [[50.001, -1.0018], [50.001, -1.0002]] as [number, number][],
      paths: [[[50.001, -1.0018], [50.001, -1.0002]]] as [number, number][][],
      properties: { highway: 'secondary', 'water crossed': 'Other Water' },
      sourceUrl: 'https://www.openstreetmap.org/way/21',
    });
    expect(coalesceBridges([outline, road])).toHaveLength(2);
  });

  it('keeps the road name when a wide unnamed outline leaves the road standing apart', () => {
    // A wide unnamed outline whose road sits far from its centre and its
    // sides: too far for the name and proximity passes, so only the outline
    // pass folds it, and the group takes the road's name.
    const ring: [number, number][] = [[50.0, -1.0], [50.0, -1.004], [50.004, -1.004], [50.004, -1.0], [50.0, -1.0]];
    const outline = feature({
      id: 'osm:way/23',
      name: 'Bridge',
      lat: 50.002,
      lon: -1.002,
      path: ring,
      paths: [ring],
      rings: [ring],
      properties: { 'water crossed': 'Gorge Waterway' },
      sourceUrl: 'https://www.openstreetmap.org/way/23',
    });
    const road = feature({
      id: 'osm:way/24',
      name: 'Gorge Road East',
      lat: 50.0035,
      lon: -1.002,
      path: [[50.0035, -1.0028], [50.0035, -1.0012]] as [number, number][],
      paths: [[[50.0035, -1.0028], [50.0035, -1.0012]]] as [number, number][][],
      properties: { highway: 'secondary', 'water crossed': 'Gorge Waterway' },
      sourceUrl: 'https://www.openstreetmap.org/way/24',
    });
    const merged = coalesceBridges([outline, road]);
    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe('Gorge Road East');
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
      paths: [[[50.924, -1.4], [50.924, -1.38]]] as [number, number][][],
      sourceUrl: 'https://www.openstreetmap.org/way/2',
    });
    expect(coalesceBridges([first, second])).toHaveLength(2);
  });

  it('merges parallel directions whose mapped nodes do not line up', () => {
    // One direction runs the bridge span only; the other runs on past it,
    // so their centres sit ~350 m apart and no node of one falls within
    // 35 m of a node of the other — yet the lines themselves run ~11 m
    // apart over the shared span. Node distance split this into one
    // overlay per direction; line distance folds it into one.
    const eastbound = feature({
      id: 'osm:way/1',
      name: 'Test Bridge',
      lat: 50.914,
      lon: -1.39,
      path: [[50.914, -1.4], [50.914, -1.39], [50.914, -1.38]] as [number, number][],
      paths: [[[50.914, -1.4], [50.914, -1.39], [50.914, -1.38]]] as [number, number][][],
      properties: { highway: 'primary' },
    });
    const westbound = feature({
      id: 'osm:way/2',
      name: 'Test Bridge',
      lat: 50.9141,
      lon: -1.385,
      path: [[50.9141, -1.405], [50.9141, -1.385], [50.9141, -1.365]] as [number, number][],
      paths: [[[50.9141, -1.405], [50.9141, -1.385], [50.9141, -1.365]]] as [number, number][][],
      properties: { highway: 'primary' },
      sourceUrl: 'https://www.openstreetmap.org/way/2',
    });
    expect(coalesceBridges([eastbound, westbound])).toHaveLength(1);
  });

  it('folds a parallel footway and cycleway into the road bridge card', () => {
    const road = feature({ id: 'osm:way/1', name: 'Test Bridge', properties: { highway: 'primary' } });
    // Unnamed, offset nodes, and a longer extent that shifts the centre
    // ~350 m along the crossing, so neither centre nor node distance
    // connects these to the road — only the lines themselves run together.
    const footway = feature({
      id: 'osm:way/2',
      name: '',
      lat: 50.9139,
      lon: -1.385,
      path: [[50.9139, -1.405], [50.9139, -1.385], [50.9139, -1.365]] as [number, number][],
      paths: [[[50.9139, -1.405], [50.9139, -1.385], [50.9139, -1.365]]] as [number, number][][],
      properties: { highway: 'footway' },
      sourceUrl: 'https://www.openstreetmap.org/way/2',
    });
    const cycleway = feature({
      id: 'osm:way/3',
      name: '',
      lat: 50.9142,
      lon: -1.395,
      path: [[50.9142, -1.405], [50.9142, -1.395], [50.9142, -1.385]] as [number, number][],
      paths: [[[50.9142, -1.405], [50.9142, -1.395], [50.9142, -1.385]]] as [number, number][][],
      properties: { highway: 'cycleway' },
      sourceUrl: 'https://www.openstreetmap.org/way/3',
    });
    const merged = coalesceBridges([road, footway, cycleway]);
    expect(merged).toHaveLength(1);
    expect(merged[0].properties.highway).toBe('primary');
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

describe('chart feature fetching', () => {
  it('retries a failed part fetch before giving up', async () => {
    const fetchMock = vi.fn(async () => {
      if (fetchMock.mock.calls.length === 1) {
        return { ok: false, status: 502, json: async () => ({ error: 'overpass unavailable' }) };
      }
      return { ok: true, json: async () => ({ elements: [] }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const result = await queryChartFeaturePart([50.9, -1.4, 50.93, -1.36], 'bridges');
      expect(result.features).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('gives up after three failed attempts', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 502, json: async () => ({ error: 'overpass unavailable' }) }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(queryChartFeaturePart([50.8, -1.5, 50.83, -1.46], 'bridges')).rejects.toThrow('overpass unavailable');
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
