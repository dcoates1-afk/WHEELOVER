import { describe, expect, it } from 'vitest';
import { checkRouteAirDraft } from './routeAirDraft';
import type {
  ClearanceDatasets,
  CoastPilotClearanceRecord,
  NoaaClearanceRecord,
  UsaceClearanceRecord,
} from './clearances';
import type { ChartFeature } from './overpass';

function bridge(
  id: string,
  lat: number,
  path: [number, number][],
  properties: Record<string, string> = {},
): ChartFeature {
  return {
    id,
    type: 'bridge',
    name: 'Test Bridge',
    lat,
    lon: path[0][1],
    path,
    paths: [],
    properties,
    sourceUrl: '',
  };
}

function emptyDatasets(): ClearanceDatasets {
  return {
    manifest: { generatedAt: '2026-01-01', sources: {}, incomplete: [] },
    noaa: [],
    usace: [],
    euris: [],
    danube: [],
    coastpilot: [],
    eaheadway: [],
  };
}

function noaa(lat: number, lon: number, standing: number | null, closed: number | null, open: number | null): NoaaClearanceRecord {
  return { la: lat, lo: lon, n: 'Test Bridge', v: standing, c: closed, o: open, h: null, d: '16', k: null, s: null };
}

function usace(lat: number, lon: number, standing: number): UsaceClearanceRecord {
  return { la: lat, lo: lon, n: 'Test Bridge', v: standing, c: null, o: null, h: null, k: null, s: null };
}

function coastPilotLeast(value: number): CoastPilotClearanceRecord {
  return {
    n: 'Test Bridge',
    w: 'Test River',
    la: null,
    lo: null,
    v: [value],
    c: true,
    o: null,
    h: null,
    d: 'MHW',
    least: true,
    g: 'highway',
    t: null,
    ch: 'test',
  };
}

// The route crosses the bridge line exactly on a sample: leg
// (50.695, -1.195) -> (50.705, -1.195) samples every ~100 m, and sample 6
// sits at (50.7, -1.195), on the bridge path.
const LEG = [
  { lat: 50.695, lon: -1.195 },
  { lat: 50.705, lon: -1.195 },
];
const BRIDGE_PATH: [number, number][] = [
  [50.7, -1.2],
  [50.7, -1.19],
];

describe('checkRouteAirDraft', () => {
  it('fails when the lowest exact figure is under air draft plus margin', () => {
    const datasets = emptyDatasets();
    datasets.noaa = [noaa(50.7, -1.195, 8, null, null)];
    const { checks } = checkRouteAirDraft({
      waypoints: LEG,
      bridges: [bridge('b1', 50.7, BRIDGE_PATH)],
      datasets,
      airDraftM: 10,
      marginM: 1,
    });
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({
      legIndex: 0,
      verdict: 'fail',
      clearanceM: 8,
      requiredM: 11,
      datum: 'MHW',
      sources: ['NOAA ENC'],
    });
  });

  it('passes when the lowest exact figure clears air draft plus margin', () => {
    const datasets = emptyDatasets();
    datasets.noaa = [noaa(50.7, -1.195, 20, null, null)];
    const { checks } = checkRouteAirDraft({
      waypoints: LEG,
      bridges: [bridge('b1', 50.7, BRIDGE_PATH)],
      datasets,
      airDraftM: 5,
      marginM: 1,
    });
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ verdict: 'pass', clearanceM: 20 });
  });

  it('counts the margin in the requirement', () => {
    const datasets = emptyDatasets();
    datasets.noaa = [noaa(50.7, -1.195, 10.5, null, null)];
    const failing = checkRouteAirDraft({
      waypoints: LEG,
      bridges: [bridge('b1', 50.7, BRIDGE_PATH)],
      datasets,
      airDraftM: 10,
      marginM: 1,
    });
    expect(failing.checks[0].verdict).toBe('fail');
    const passing = checkRouteAirDraft({
      waypoints: LEG,
      bridges: [bridge('b1', 50.7, BRIDGE_PATH)],
      datasets,
      airDraftM: 10,
      marginM: 0,
    });
    expect(passing.checks[0].verdict).toBe('pass');
  });

  it('never passes on a datum-unknown figure, however high', () => {
    const datasets = emptyDatasets();
    datasets.usace = [usace(50.7, -1.195, 20)];
    const { checks } = checkRouteAirDraft({
      waypoints: LEG,
      bridges: [bridge('b1', 50.7, BRIDGE_PATH)],
      datasets,
      airDraftM: 5,
      marginM: 1,
    });
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({
      verdict: 'unverified',
      clearanceM: null,
      hasDatumUnknown: true,
      sources: ['USACE Inland ENC'],
    });
  });

  it('reports a crossed bridge with no figures as unverified', () => {
    const { checks } = checkRouteAirDraft({
      waypoints: LEG,
      bridges: [bridge('b1', 50.7, BRIDGE_PATH)],
      datasets: emptyDatasets(),
      airDraftM: 5,
      marginM: 1,
    });
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ verdict: 'unverified', clearanceM: null, sources: [] });
  });

  it('passes on a group least at or over the requirement', () => {
    const datasets = emptyDatasets();
    datasets.coastpilot = [coastPilotLeast(15)];
    const { checks } = checkRouteAirDraft({
      waypoints: LEG,
      bridges: [
        bridge('b1', 50.7, BRIDGE_PATH, { highway: 'primary', 'water crossed': 'Test River' }),
      ],
      datasets,
      airDraftM: 5,
      marginM: 1,
    });
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ verdict: 'pass', clearanceM: 15, least: true });
  });

  it('does not fail on a group least under the requirement', () => {
    const datasets = emptyDatasets();
    datasets.coastpilot = [coastPilotLeast(5)];
    const { checks } = checkRouteAirDraft({
      waypoints: LEG,
      bridges: [
        bridge('b1', 50.7, BRIDGE_PATH, { highway: 'primary', 'water crossed': 'Test River' }),
      ],
      datasets,
      airDraftM: 5,
      marginM: 1,
    });
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ verdict: 'unverified', clearanceM: 5, least: true });
  });

  it('fails on the closed figure but reports the open figure for a movable bridge', () => {
    const datasets = emptyDatasets();
    datasets.noaa = [noaa(50.7, -1.195, null, 8, 20)];
    const { checks } = checkRouteAirDraft({
      waypoints: LEG,
      bridges: [bridge('b1', 50.7, BRIDGE_PATH)],
      datasets,
      airDraftM: 10,
      marginM: 1,
    });
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ verdict: 'fail', clearanceM: 8, openM: 20 });
  });

  it('ignores bridges off the route and non-bridge features on it', () => {
    const far: ChartFeature = bridge('far', 50.72, [
      [50.72, -1.2],
      [50.72, -1.19],
    ]);
    const area: ChartFeature = {
      ...bridge('area', 50.7, BRIDGE_PATH),
      type: 'protected_area',
    };
    const { checks } = checkRouteAirDraft({
      waypoints: LEG,
      bridges: [far, area],
      datasets: emptyDatasets(),
      airDraftM: 5,
      marginM: 1,
    });
    expect(checks).toHaveLength(0);
  });

  it('attributes each crossed bridge to its own leg', () => {
    const datasets = emptyDatasets();
    datasets.noaa = [noaa(50.7, -1.195, 20, null, null), noaa(50.71, -1.195, 20, null, null)];
    const waypoints = [
      { lat: 50.695, lon: -1.195 },
      { lat: 50.705, lon: -1.195 },
      { lat: 50.715, lon: -1.195 },
    ];
    const { checks } = checkRouteAirDraft({
      waypoints,
      bridges: [
        bridge('b1', 50.7, BRIDGE_PATH),
        bridge('b2', 50.71, [
          [50.71, -1.2],
          [50.71, -1.19],
        ]),
      ],
      datasets,
      airDraftM: 5,
      marginM: 1,
    });
    expect(checks).toHaveLength(2);
    expect(checks.map((check) => check.legIndex)).toEqual([0, 1]);
  });

  it('returns nothing for fewer than two waypoints', () => {
    const { checks } = checkRouteAirDraft({
      waypoints: [{ lat: 50.7, lon: -1.195 }],
      bridges: [bridge('b1', 50.7, BRIDGE_PATH)],
      datasets: emptyDatasets(),
      airDraftM: 5,
      marginM: 1,
    });
    expect(checks).toHaveLength(0);
  });
});
