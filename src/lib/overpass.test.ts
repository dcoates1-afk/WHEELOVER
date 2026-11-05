import { describe, expect, it, vi } from 'vitest';
import { bridgeCrossesWater, chartFeatureCacheKey, chartFeatureProperties, chartFeaturesFromElements, CHART_FEATURE_FILTER_VERSION, coalesceBridges, isTidalWater, queryChartFeaturePart, queryChartFeaturePartWithBackgroundRetry, type ChartFeature } from './overpass';

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
    expect(isTidalWater({ water: 'estuary', tidal: 'no' })).toBe(false);
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
    tags: { waterway: 'river' },
    geometry: [{ lat, lon: -1.0003 }, { lat: lat + 0.001, lon: -1.0003 }],
  });

  const bridgeAt = (lat: number) => ({
    type: 'way' as const,
    tags: { bridge: 'yes' },
    geometry: [{ lat, lon: -1.001 }, { lat: lat + 0.001, lon: -0.999 }],
  });

  it('keeps a tidal river reach that carries no tidal tag but runs into open tidal water', () => {
    // The reach chains into the harbour: its last segment ends inside the
    // harbour polygon, so the along-water distance from the crossing to the
    // tide is the short run down the reach itself.
    const reach = {
      type: 'way' as const,
      tags: { waterway: 'river' },
      geometry: [{ lat: 51, lon: -1.0003 }, { lat: 51.006, lon: -1.0003 }],
    };
    expect(bridgeCrossesWater(bridgeAt(51), [reach, harbour(51.015, -1)])).toBe(true);
  });

  it('does not treat a river reach gapped from tidal water as tidal', () => {
    // The old straight-line rule kept this: the reach sits 440 m from the
    // harbour, inside the two-kilometre reach. Along the water there is no
    // connection at all — a gap in the mapping, not a mouth — so it drops.
    expect(bridgeCrossesWater(bridgeAt(51), [riverReach(51), harbour(51.015, -1)])).toBe(false);
  });

  it('does not let a bridge past the tidal reach stay when the river runs long', () => {
    // A river chaining south from the harbour: two 1.1 km reaches, so the
    // far bridge sits 2.2 km along the water from the tide. The old
    // straight-line rule kept it too (1.1 km from the harbour's edge as the
    // crow flies, via the near reach); along the water it is out of reach.
    const upper = {
      type: 'way' as const,
      tags: { waterway: 'river' },
      geometry: [{ lat: 51.005, lon: -1.0003 }, { lat: 50.995, lon: -1.0003 }],
    };
    const lower = {
      type: 'way' as const,
      tags: { waterway: 'river' },
      geometry: [{ lat: 50.995, lon: -1.0003 }, { lat: 50.985, lon: -1.0003 }],
    };
    const farBridge = {
      type: 'way' as const,
      tags: { bridge: 'yes' },
      geometry: [{ lat: 50.985, lon: -1.001 }, { lat: 50.986, lon: -0.999 }],
    };
    expect(bridgeCrossesWater(farBridge, [upper, lower, harbour(51.015, -1)])).toBe(false);
    // The near bridge, halfway down the same chain, stays.
    const nearBridge = {
      type: 'way' as const,
      tags: { bridge: 'yes' },
      geometry: [{ lat: 50.995, lon: -1.001 }, { lat: 50.996, lon: -0.999 }],
    };
    expect(bridgeCrossesWater(nearBridge, [upper, lower, harbour(51.015, -1)])).toBe(true);
  });

  it('keeps a tributary bridge within along-water reach of the tide', () => {
    // The main river is split at the confluence, as OSM splits it: the
    // tributary joins at a shared node, and the run from its bridge to the
    // harbour is the tributary plus the main's upper reach, well inside
    // two kilometres.
    const mainLower = {
      type: 'way' as const,
      tags: { waterway: 'river' },
      geometry: [{ lat: 51, lon: -1.0003 }, { lat: 51.0005, lon: -1.0003 }],
    };
    const mainUpper = {
      type: 'way' as const,
      tags: { waterway: 'river' },
      geometry: [{ lat: 51.0005, lon: -1.0003 }, { lat: 51.006, lon: -1.0003 }],
    };
    const tributary = {
      type: 'way' as const,
      tags: { waterway: 'river' },
      geometry: [{ lat: 50.999, lon: -1.002 }, { lat: 51.0005, lon: -1.0003 }],
    };
    const tributaryBridge = {
      type: 'way' as const,
      tags: { bridge: 'yes' },
      geometry: [{ lat: 50.9995, lon: -1.0015 }, { lat: 51.0005, lon: -1.0005 }],
    };
    expect(bridgeCrossesWater(tributaryBridge, [mainLower, mainUpper, tributary, harbour(51.015, -1)])).toBe(true);
  });

  it('does not let an intermittent basin make a river tidal', () => {
    // The reach runs into the basin, so it would be tidal if the basin
    // counted as a seed — but an intermittent pond says nothing about the
    // tide, so the bridge drops. The same basin without the intermittent
    // tag seeds the reach and the bridge stays.
    const basin = (intermittent: boolean) => ({
      type: 'way' as const,
      tags: {
        natural: 'water', water: 'basin', name: 'Creekside basin',
        ...(intermittent ? { intermittent: 'yes' } : {}),
      },
      geometry: harbour(51.015, -1).geometry,
    });
    const reach = {
      type: 'way' as const,
      tags: { waterway: 'river' },
      geometry: [{ lat: 51, lon: -1.0003 }, { lat: 51.006, lon: -1.0003 }],
    };
    expect(bridgeCrossesWater(bridgeAt(51), [reach, basin(true)])).toBe(false);
    expect(bridgeCrossesWater(bridgeAt(51), [reach, basin(false)])).toBe(true);
  });

  it('does not treat an untagged river reach 7 km from tidal water as tidal', () => {
    // The old twelve-kilometre inference kept reaches like this — and with
    // them whole creek chains like the Colquitz. Two kilometres does not.
    expect(bridgeCrossesWater(bridgeAt(51), [riverReach(51), harbour(51.06, -1)])).toBe(false);
  });

  it('does not let a river reach tagged tidal=no count even within tidal reach', () => {
    const untidalReach = {
      type: 'way' as const,
      tags: { water: 'river', natural: 'water', tidal: 'no' },
      geometry: [{ lat: 51, lon: -1.0003 }, { lat: 51.001, lon: -1.0003 }],
    };
    expect(bridgeCrossesWater(bridgeAt(51), [untidalReach, harbour(51.015, -1)])).toBe(false);
  });

  it('does not let a big sea polygon\'s bounding box make inland reaches tidal', () => {
    // A U-shaped bay: water along the west, north and east edges, land in
    // the south-centre pocket. The pocket sits inside the bay's bounding
    // box, so a box test read every reach there as tidal — Haro Strait's
    // box covers the whole Colquitz valley the same way. The reach must be
    // judged by its distance to actual water, not to the box.
    const bay = {
      type: 'way' as const,
      tags: { natural: 'water', water: 'bay' },
      geometry: [
        { lat: 51.0, lon: -1.0 }, { lat: 52.0, lon: -1.0 }, { lat: 52.0, lon: 0.0 },
        { lat: 51.5, lon: 0.0 }, { lat: 51.5, lon: -0.5 }, { lat: 51.0, lon: -0.5 },
        { lat: 51.0, lon: -1.0 },
      ],
    };
    // Reach in the middle of the pocket, ~14 km from the nearest water.
    const pocketReach = {
      type: 'way' as const,
      tags: { waterway: 'river' },
      geometry: [{ lat: 51.25, lon: -0.30 }, { lat: 51.25, lon: -0.20 }],
    };
    const pocketBridge = {
      type: 'way' as const,
      tags: { bridge: 'yes', highway: 'secondary' },
      geometry: [{ lat: 51.24, lon: -0.25 }, { lat: 51.26, lon: -0.25 }],
    };
    expect(bridgeCrossesWater(pocketBridge, [pocketReach, bay])).toBe(false);
    // Same pocket, but the reach runs 700 m from the bay's edge. The old
    // straight-line rule kept it — inside the two-kilometre reach. Along
    // the water there is no connection: an isolated reach near a bay is not
    // a mouth, so its bridge drops.
    const nearReach = {
      type: 'way' as const,
      tags: { waterway: 'river' },
      geometry: [{ lat: 51.25, lon: -0.49 }, { lat: 51.25, lon: -0.40 }],
    };
    const nearBridge = {
      type: 'way' as const,
      tags: { bridge: 'yes', highway: 'secondary' },
      geometry: [{ lat: 51.24, lon: -0.45 }, { lat: 51.26, lon: -0.45 }],
    };
    expect(bridgeCrossesWater(nearBridge, [nearReach, bay])).toBe(false);
    // And a reach inside the bay itself stays tidal, however far it runs
    // from the boundary.
    const insideReach = {
      type: 'way' as const,
      tags: { waterway: 'river' },
      geometry: [{ lat: 51.25, lon: -0.60 }, { lat: 51.25, lon: -0.55 }],
    };
    const insideBridge = {
      type: 'way' as const,
      tags: { bridge: 'yes', highway: 'secondary' },
      geometry: [{ lat: 51.24, lon: -0.575 }, { lat: 51.26, lon: -0.575 }],
    };
    expect(bridgeCrossesWater(insideBridge, [insideReach, bay])).toBe(true);
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

  it('does not count a footway lying inside a water polygon as a span', () => {
    const basin = {
      type: 'way' as const,
      tags: { 'seamark:type': 'harbour_basin', name: 'Inner harbour' },
      geometry: [
        { lat: 50.89, lon: -1.41 }, { lat: 50.89, lon: -1.37 },
        { lat: 50.91, lon: -1.37 }, { lat: 50.91, lon: -1.41 }, { lat: 50.89, lon: -1.41 },
      ],
    };
    // A walkway along the shore inside the basin polygon: it touches water
    // all along, but never goes from one side to the other.
    expect(bridgeCrossesWater(
      { type: 'way', tags: { bridge: 'yes', highway: 'footway' }, geometry: [{ lat: 50.9, lon: -1.4 }, { lat: 50.9, lon: -1.38 }] },
      [basin],
    )).toBe(false);
    // The same geometry without a light highway tag keeps the lenient rule.
    expect(bridgeCrossesWater(
      { type: 'way', tags: { bridge: 'yes' }, geometry: [{ lat: 50.9, lon: -1.4 }, { lat: 50.9, lon: -1.38 }] },
      [basin],
    )).toBe(true);
  });

  it('does not count a footway finger that ends inside a water polygon', () => {
    expect(bridgeCrossesWater(
      { type: 'way', tags: { bridge: 'yes', highway: 'footway' }, geometry: [{ lat: 50.9, lon: -1.42 }, { lat: 50.9, lon: -1.39 }] },
      [{
        type: 'way',
        tags: { 'seamark:type': 'harbour_basin', name: 'Inner harbour' },
        geometry: [
          { lat: 50.89, lon: -1.41 }, { lat: 50.89, lon: -1.37 },
          { lat: 50.91, lon: -1.37 }, { lat: 50.91, lon: -1.41 }, { lat: 50.89, lon: -1.41 },
        ],
      }],
    )).toBe(false);
  });

  it('keeps a footway that cuts a water polygon twice', () => {
    expect(bridgeCrossesWater(
      { type: 'way', tags: { bridge: 'yes', highway: 'footway' }, geometry: [{ lat: 50.9, lon: -1.42 }, { lat: 50.9, lon: -1.36 }] },
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

  it('does not count a footway weaving along a wobbly shoreline as a span', () => {
    // The basin's east edge zigzags a few metres either side of the footway,
    // so the footway cuts the boundary four times — the old cut-count rule
    // drew it as a bridge. But it never gets more than a few metres inside
    // the water: it runs along the shore, not across the basin.
    const basin = {
      type: 'way' as const,
      tags: { 'seamark:type': 'harbour_basin', name: 'Inner harbour' },
      geometry: [
        { lat: 50.89, lon: -1.41 }, { lat: 50.89, lon: -1.36995 },
        { lat: 50.895, lon: -1.37005 }, { lat: 50.90, lon: -1.36995 },
        { lat: 50.905, lon: -1.37005 }, { lat: 50.91, lon: -1.36995 },
        { lat: 50.91, lon: -1.41 }, { lat: 50.89, lon: -1.41 },
      ],
    };
    expect(bridgeCrossesWater(
      { type: 'way', tags: { bridge: 'yes', highway: 'footway' }, geometry: [{ lat: 50.892, lon: -1.37 }, { lat: 50.908, lon: -1.37 }] },
      [basin],
    )).toBe(false);
  });

  it('does not count a steep crossing of a sliver of mapped water as a span', () => {
    // A footway crossing a seven-metre strip of mapped harbour water
    // squarely: the geometry is a crossing, but at that width it is
    // indistinguishable from the polygon edge jutting across the path, so
    // the strict rule drops it. The same footway over a fifteen-metre
    // channel stays. Widths are in degrees of longitude (~70 m per 0.001
    // at this latitude): 0.0001 is ~7 m, 0.00022 is ~15 m.
    const narrow = {
      type: 'way' as const,
      tags: { 'seamark:type': 'harbour_basin', name: 'Narrow channel' },
      geometry: [
        { lat: 50.89, lon: -1.37005 }, { lat: 50.89, lon: -1.36995 },
        { lat: 50.91, lon: -1.36995 }, { lat: 50.91, lon: -1.37005 },
        { lat: 50.89, lon: -1.37005 },
      ],
    };
    const wide = {
      type: 'way' as const,
      tags: { 'seamark:type': 'harbour_basin', name: 'Wide channel' },
      geometry: [
        { lat: 50.89, lon: -1.37011 }, { lat: 50.89, lon: -1.36989 },
        { lat: 50.91, lon: -1.36989 }, { lat: 50.91, lon: -1.37011 },
        { lat: 50.89, lon: -1.37011 },
      ],
    };
    const footway = {
      type: 'way' as const,
      tags: { bridge: 'yes', highway: 'footway' },
      geometry: [{ lat: 50.9, lon: -1.371 }, { lat: 50.9, lon: -1.369 }],
    };
    expect(bridgeCrossesWater(footway, [narrow])).toBe(false);
    expect(bridgeCrossesWater(footway, [wide])).toBe(true);
  });

  it('does not count a footway running parallel to a tidal centreline', () => {
    const channel = {
      type: 'way' as const,
      tags: { waterway: 'river', tidal: 'yes', name: 'River Itchen' },
      geometry: [{ lat: 51, lon: -1 }, { lat: 51.001, lon: -1 }],
    };
    // A riverside path about 5 m east of the centreline, running alongside it.
    expect(bridgeCrossesWater(
      { type: 'way', tags: { bridge: 'yes', highway: 'footway' }, geometry: [{ lat: 51.0002, lon: -1.00008 }, { lat: 51.0008, lon: -1.00008 }] },
      [channel],
    )).toBe(false);
  });

  it('keeps a footway crossing a tidal centreline at an angle despite a small mapping offset', () => {
    const channel = {
      type: 'way' as const,
      tags: { waterway: 'river', tidal: 'yes', name: 'River Itchen' },
      geometry: [{ lat: 51, lon: -1 }, { lat: 51.001, lon: -1 }],
    };
    // The footway runs square to the channel but stops about 5 m short of the
    // mapped line: a real crossing drawn slightly off, not a parallel path.
    expect(bridgeCrossesWater(
      { type: 'way', tags: { bridge: 'yes', highway: 'footway' }, geometry: [{ lat: 51.0005, lon: -1.001 }, { lat: 51.0005, lon: -1.00008 }] },
      [channel],
    )).toBe(true);
  });

  it('keeps a road bridge within tolerance of a water polygon under the lenient rule', () => {
    expect(bridgeCrossesWater(
      { type: 'way', tags: { bridge: 'yes', highway: 'secondary' }, geometry: [{ lat: 50.9, lon: -1.41008 }, { lat: 50.905, lon: -1.41008 }] },
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

  it('drops real Victoria harbour walkway segments inside the Wharf Street Marina bounds', () => {
    // Real OSM geometry (Nov 2026): Wharf Street Marina relation bounds, and
    // two footway bridge segments mapped inside them on the marina walkway.
    // A seed nearby makes the marina water eligible, as the surrounding
    // tidal water does on the real chart.
    const marina = {
      type: 'way' as const,
      tags: { leisure: 'marina', 'seamark:type': 'harbour', 'seamark:harbour:category': 'marina', name: 'Wharf Street Marina' },
      geometry: [
        { lat: 48.42423, lon: -123.37190 }, { lat: 48.42423, lon: -123.37020 },
        { lat: 48.42603, lon: -123.37020 }, { lat: 48.42603, lon: -123.37190 }, { lat: 48.42423, lon: -123.37190 },
      ],
    };
    const seed = {
      type: 'way' as const,
      tags: { 'seamark:type': 'harbour_basin', name: 'Inner harbour' },
      geometry: [
        { lat: 48.42, lon: -123.38 }, { lat: 48.42, lon: -123.36 },
        { lat: 48.44, lon: -123.36 }, { lat: 48.44, lon: -123.38 }, { lat: 48.42, lon: -123.38 },
      ],
    };
    // Each walkway is asserted directly: a mixed-shape array would widen
    // the first element's tags with `name?: undefined`, which is not a
    // Record<string, string> and breaks the build's typecheck.
    expect(bridgeCrossesWater(
      { type: 'way', tags: { bridge: 'yes', highway: 'footway' }, geometry: [{ lat: 48.42432, lon: -123.37084 }, { lat: 48.42432, lon: -123.37095 }] },
      [marina, seed],
    )).toBe(false);
    expect(bridgeCrossesWater(
      { type: 'way', tags: { bridge: 'yes', highway: 'footway', name: 'Walk Downtown Victoria' }, geometry: [{ lat: 48.42446, lon: -123.37029 }, { lat: 48.42457, lon: -123.37031 }, { lat: 48.42485, lon: -123.37036 }] },
      [marina, seed],
    )).toBe(false);
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
  it('versions the cache key with the filter version', () => {
    // A rule change must make old device cells miss, not serve bridges
    // drawn under older rules.
    const key = chartFeatureCacheKey('bridges', [51, -1, 52, 0]);
    expect(key).toContain(`v${CHART_FEATURE_FILTER_VERSION}`);
    expect(key).toContain('bridges');
    expect(chartFeatureCacheKey('areas', [51, -1, 52, 0])).not.toBe(key);
  });

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

  it('uses drawn features when the proxy sends them instead of raw elements', async () => {
    const feature = {
      id: 'bridge-1',
      type: 'bridge',
      name: 'Test Bridge',
      lat: 51.11,
      lon: -1.58,
      path: [[51.11, -1.58]],
      paths: [[[51.11, -1.58]]],
      properties: {},
      sourceUrl: 'https://example.invalid/1',
    };
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ features: [feature] }) }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const result = await queryChartFeaturePart([51.101, -1.601, 51.129, -1.561], 'bridges');
      expect(result.features).toEqual([feature]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('reuses one cell answer for nearby views instead of refetching', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ elements: [] }) }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await queryChartFeaturePart([50.901, -1.401, 50.929, -1.361], 'bridges');
      const second = await queryChartFeaturePart([50.905, -1.405, 50.925, -1.365], 'bridges');
      expect(second.cached).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('chart feature background retry', () => {
  const feature = {
    id: 'bridge-1',
    type: 'bridge',
    name: 'Test Bridge',
    lat: 52.11,
    lon: -2.58,
    path: [[52.11, -2.58]],
    paths: [[[52.11, -2.58]]],
    properties: {},
    sourceUrl: 'https://example.invalid/1',
  };

  it('resolves on the first round without any background wait', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ features: [feature] }) }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const result = await queryChartFeaturePartWithBackgroundRetry([52.0, -2.6, 52.03, -2.56], 'bridges');
      expect(result.features).toEqual([feature]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('recovers when a background round succeeds after the foreground attempts exhaust', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => {
      if (fetchMock.mock.calls.length <= 3) {
        return { ok: false, status: 502, json: async () => ({ error: 'overpass unavailable' }) };
      }
      return { ok: true, json: async () => ({ features: [feature] }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const promise = queryChartFeaturePartWithBackgroundRetry([52.1, -2.7, 52.13, -2.66], 'bridges', { backgroundDelaysMs: [5000] });
      await vi.advanceTimersByTimeAsync(30000);
      const result = await promise;
      expect(result.features).toEqual([feature]);
      expect(fetchMock).toHaveBeenCalledTimes(4);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('stops at once on a rate limit instead of retrying in the background', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => ({ ok: false, status: 429, json: async () => ({ error: 'rate limited' }) }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const promise = queryChartFeaturePartWithBackgroundRetry([52.2, -2.8, 52.23, -2.76], 'bridges', { backgroundDelaysMs: [5000] });
      promise.catch(() => {});
      await vi.advanceTimersByTimeAsync(30000);
      await expect(promise).rejects.toThrow('rate limited');
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('stops at once on a hard denial instead of retrying in the background', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: 'forbidden' }) }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const promise = queryChartFeaturePartWithBackgroundRetry([52.3, -2.9, 52.33, -2.86], 'bridges', { backgroundDelaysMs: [5000] });
      promise.catch(() => {});
      await vi.advanceTimersByTimeAsync(30000);
      await expect(promise).rejects.toThrow('forbidden');
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('gives up once the background delays run out', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => ({ ok: false, status: 502, json: async () => ({ error: 'overpass unavailable' }) }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const promise = queryChartFeaturePartWithBackgroundRetry([52.4, -3.0, 52.43, -2.96], 'bridges', { backgroundDelaysMs: [1000, 2000] });
      promise.catch(() => {});
      await vi.advanceTimersByTimeAsync(30000);
      await expect(promise).rejects.toThrow('overpass unavailable');
      expect(fetchMock).toHaveBeenCalledTimes(9);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('an aborted signal stops the chain without another round', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => ({ ok: false, status: 502, json: async () => ({ error: 'overpass unavailable' }) }));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    try {
      const promise = queryChartFeaturePartWithBackgroundRetry([52.5, -3.1, 52.53, -3.06], 'bridges', { signal: controller.signal, backgroundDelaysMs: [60000] });
      promise.catch(() => {});
      await vi.advanceTimersByTimeAsync(2000);
      controller.abort();
      await expect(promise).rejects.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});
