import { describe, expect, it } from 'vitest';
import { describeBridge } from './bridges';
import {
  type ClearanceDatasets,
  type CoastPilotClearanceRecord,
  clearancesForFeature,
  type JoinableBridgeFeature,
} from './clearances';

const EMPTY: ClearanceDatasets = {
  manifest: { generatedAt: '2026-11-03', sources: {}, incomplete: [] },
  noaa: [],
  usace: [],
  euris: [],
  danube: [],
  coastpilot: [],
};

function cp(
  record: Partial<CoastPilotClearanceRecord> & { n: string | null },
): CoastPilotClearanceRecord {
  return {
    w: null,
    la: null,
    lo: null,
    v: [],
    c: true,
    o: null,
    h: null,
    d: 'MHW',
    least: false,
    g: null,
    t: null,
    ch: 'CP7 Ch.7',
    ...record,
  };
}

// Park Street (road, bascule) and the rail lift bridge both cross the
// Tidal Canal, about 800 m apart — the pair that decides whether a group
// least or a coordinate record lands on the wrong bridge.
const park: JoinableBridgeFeature = {
  name: 'Park Street Bridge',
  lat: 37.7732,
  lon: -122.2275,
  path: [
    [37.773, -122.228],
    [37.7735, -122.227],
  ],
  properties: { 'water crossed': 'Tidal Canal', highway: 'secondary', 'bridge:movable': 'bascule' },
};
const rail: JoinableBridgeFeature = {
  name: '',
  lat: 37.7717,
  lon: -122.2367,
  path: [
    [37.771, -122.237],
    [37.7725, -122.236],
  ],
  properties: { 'water crossed': 'Tidal Canal', railway: 'rail', 'bridge:movable': 'lift' },
};

const groupLeast = cp({
  n: null,
  w: 'Tidal Canal',
  v: [4.6],
  least: true,
  g: 'three highway drawbridges across Tidal Canal',
  t: 'drawbridge',
});

describe('coast pilot joins', () => {
  it('joins a group least to the highway bridge on its waterway, not the rail bridge', () => {
    const datasets = { ...EMPTY, coastpilot: [groupLeast] };
    const parkRows = clearancesForFeature(park, datasets);
    const railRows = clearancesForFeature(rail, datasets);
    expect(parkRows).toHaveLength(1);
    expect(parkRows[0]).toMatchObject({ source: 'US Coast Pilot', values: [4.6], least: true });
    expect(railRows).toHaveLength(0);
  });

  it('joins a named passage by name plus waterway without coordinates', () => {
    const named = cp({ n: 'Park Street Bridge', w: 'Tidal Canal', v: [4.9], t: 'bascule' });
    const datasets = { ...EMPTY, coastpilot: [named] };
    expect(clearancesForFeature(park, datasets)).toHaveLength(1);
    expect(clearancesForFeature(rail, datasets)).toHaveLength(0);
  });

  it('joins a coordinate passage by proximity, even with a generic name', () => {
    const lift = cp({
      n: 'vertical lift railroad bridge',
      w: 'Tidal Canal',
      la: 37.7717,
      lo: -122.2367,
      v: [4.0],
      o: [41.1],
      t: 'lift',
    });
    const datasets = { ...EMPTY, coastpilot: [lift] };
    const railRows = clearancesForFeature(rail, datasets);
    expect(railRows).toHaveLength(1);
    expect(railRows[0]).toMatchObject({ values: [4.0], openValues: [41.1] });
    expect(clearancesForFeature(park, datasets)).toHaveLength(0);
  });

  it('never joins a passage with neither coordinates nor waterway', () => {
    const orphan = cp({ n: 'Park Street Bridge', v: [4.9] });
    const datasets = { ...EMPTY, coastpilot: [orphan] };
    expect(clearancesForFeature(park, datasets)).toHaveLength(0);
  });

  it('does not put two adjacent bridges sharing one paragraph position on each other', () => {
    const shared = { la: 37.5022, lo: -122.2125 };
    const highwayFeature: JoinableBridgeFeature = {
      name: 'Dumbarton Highway Bridge',
      lat: 37.5022,
      lon: -122.2125,
      path: [
        [37.5022, -122.2125],
        [37.503, -122.21],
      ],
      properties: { 'water crossed': 'San Francisco Bay', highway: 'primary' },
    };
    const railroadFeature: JoinableBridgeFeature = {
      name: 'Dumbarton Railroad Bridge',
      lat: 37.502,
      lon: -122.2127,
      path: [
        [37.502, -122.2127],
        [37.5028, -122.2102],
      ],
      properties: { 'water crossed': 'San Francisco Bay', railway: 'rail', 'bridge:movable': 'swing' },
    };
    const datasets = {
      ...EMPTY,
      coastpilot: [
        cp({ n: 'Dumbarton Highway Bridge', ...shared, v: [25.9], t: 'fixed' }),
        cp({ n: 'Dumbarton Railroad Bridge', ...shared, v: [4.0], t: 'swing' }),
      ],
    };
    expect(clearancesForFeature(highwayFeature, datasets).map((r) => r.values)).toEqual([[25.9]]);
    expect(clearancesForFeature(railroadFeature, datasets).map((r) => r.values)).toEqual([[4.0]]);
  });

  it('collapses duplicate group rows to one', () => {
    const datasets = { ...EMPTY, coastpilot: [groupLeast, { ...groupLeast }] };
    expect(clearancesForFeature(park, datasets)).toHaveLength(1);
  });
});

describe('coast pilot card rendering', () => {
  it('renders a group least with a ≥ prefix and the group description', () => {
    const card = describeBridge(
      {
        name: 'Park Street Bridge',
        properties: { 'water crossed': 'Tidal Canal', highway: 'secondary', 'bridge:movable': 'bascule' },
        clearances: [
          {
            source: 'US Coast Pilot',
            values: [4.6],
            closed: true,
            openValues: [],
            horizontal: null,
            datum: 'MHW',
            datumNote: 'three highway drawbridges across Tidal Canal',
            least: true,
            retrieved: '2026-11-03',
          },
        ],
      },
      { depth: 'm', distance: 'm-nm' },
    );
    const section = card.sections.find((s) => s.title === 'Charted clearances');
    expect(section?.rows[0].value).toContain('≥ 4.6 m above MHW');
    expect(section?.rows[0].value).toContain('three highway drawbridges across Tidal Canal');
  });

  it('fills a missing Type and Operation from a passage kind', () => {
    const card = describeBridge(
      {
        name: 'Unmapped Bridge',
        properties: { 'water crossed': 'Tidal Canal', highway: 'secondary' },
        clearances: [
          {
            source: 'US Coast Pilot',
            values: [4.9],
            closed: true,
            openValues: [],
            horizontal: null,
            datum: 'MHW',
            datumNote: null,
            bridgeType: 'bascule',
            retrieved: '2026-11-03',
          },
        ],
      },
      { depth: 'm', distance: 'm-nm' },
    );
    expect(card.facts.find((f) => f.label === 'Type')?.value).toBe('Bascule bridge');
    expect(card.facts.find((f) => f.label === 'Operation')?.value).toBe('Raising');
  });

  it('never lets a passage kind override the mapped record', () => {
    const card = describeBridge(
      {
        name: 'Swing Bridge',
        properties: { 'water crossed': 'Tidal Canal', highway: 'primary', 'bridge:movable': 'swing' },
        clearances: [
          {
            source: 'US Coast Pilot',
            values: [4.9],
            closed: true,
            openValues: [],
            horizontal: null,
            datum: 'MHW',
            datumNote: null,
            bridgeType: 'bascule',
            retrieved: '2026-11-03',
          },
        ],
      },
      { depth: 'm', distance: 'm-nm' },
    );
    expect(card.facts.find((f) => f.label === 'Type')?.value).toBe('Swing bridge');
    expect(card.facts.find((f) => f.label === 'Operation')?.value).toBe('Rotating');
  });
});
