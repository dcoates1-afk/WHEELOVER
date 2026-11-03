import { describe, expect, it } from 'vitest';
import { checkRouteHazards, type RouteHazardInput } from './routeHazards';
import type { ChartFeature } from './overpass';
import type { ProtectedAreaFeature } from './protectedAreas';
import type { MarineFeature } from './marineDb';

const squareRing: [number, number][] = [
  [0, 0],
  [0, 1],
  [1, 1],
  [1, 0],
];

function areaFeature(name = 'Test reef', group = 'reef'): ChartFeature {
  return {
    id: 'area:1',
    type: 'protected_area',
    name,
    lat: 0.5,
    lon: 0.5,
    path: [],
    paths: [],
    rings: [squareRing],
    areaGroup: group as never,
    areaLabel: 'Test reef area',
    properties: {},
    sourceUrl: '',
  };
}

function laneFeature(name: string, path: [number, number][]): MarineFeature {
  return {
    id: `lane:${name}`,
    type: 'ferry_route',
    name,
    bounds: [-1, -1, 1, 1] as never,
    path,
  };
}

function base(overrides: Partial<RouteHazardInput> = {}): RouteHazardInput {
  return {
    waypoints: [],
    areas: [],
    protectedAreas: [],
    ferries: [],
    tss: [],
    ...overrides,
  };
}

describe('checkRouteHazards', () => {
  it('flags a leg crossing a mapped area', () => {
    const legs = checkRouteHazards(
      base({
        waypoints: [
          { lat: -0.5, lon: 0.5 },
          { lat: 1.5, lon: 0.5 },
        ],
        areas: [areaFeature()],
      }),
    );
    expect(legs).toHaveLength(1);
    expect(legs[0].hazards).toEqual([{ kind: 'area', name: 'Test reef', group: 'reef' }]);
  });

  it('reports no hazards for a leg clear of everything', () => {
    const legs = checkRouteHazards(
      base({
        waypoints: [
          { lat: 5, lon: 5 },
          { lat: 6, lon: 5 },
        ],
        areas: [areaFeature()],
        ferries: [laneFeature('Harbour ferry', [[0, -1], [0, 1]])],
      }),
    );
    expect(legs[0].hazards).toEqual([]);
  });

  it('flags a leg passing a ferry lane within 50 m', () => {
    const legs = checkRouteHazards(
      base({
        waypoints: [
          { lat: -0.5, lon: 0 },
          { lat: 0.5, lon: 0 },
        ],
        ferries: [laneFeature('Harbour ferry', [[0, -1], [0, 1]])],
      }),
    );
    expect(legs[0].hazards).toEqual([{ kind: 'lane', name: 'Harbour ferry', group: 'Ferry route' }]);
  });

  it('does not flag a lane 20 km away', () => {
    const legs = checkRouteHazards(
      base({
        waypoints: [
          { lat: 0.2, lon: -0.5 },
          { lat: 0.2, lon: 0.5 },
        ],
        ferries: [laneFeature('Harbour ferry', [[0, -1], [0, 1]])],
      }),
    );
    expect(legs[0].hazards).toEqual([]);
  });

  it('counts a hazard once per leg even when the whole leg sits inside it', () => {
    const legs = checkRouteHazards(
      base({
        waypoints: [
          { lat: 0.2, lon: 0.2 },
          { lat: 0.8, lon: 0.8 },
        ],
        areas: [areaFeature()],
      }),
    );
    expect(legs[0].hazards).toHaveLength(1);
  });

  it('reads GeoJSON protected-area polygons in [lon, lat] order', () => {
    const protectedArea = {
      id: 'natura:1',
      name: 'Test SAC',
      bounds: [0, 0, 1, 1],
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
            [0, 0],
          ],
        ],
      },
      properties: {},
      sourceUrl: '',
    } as unknown as ProtectedAreaFeature;
    const legs = checkRouteHazards(
      base({
        waypoints: [
          { lat: -0.5, lon: 0.5 },
          { lat: 1.5, lon: 0.5 },
        ],
        protectedAreas: [protectedArea],
      }),
    );
    expect(legs[0].hazards).toEqual([{ kind: 'area', name: 'Test SAC', group: 'Protected area' }]);
  });

  it('ignores rings without an area class (bridge outlines are not hazards)', () => {
    const outline = areaFeature();
    delete (outline as Partial<ChartFeature>).areaGroup;
    delete (outline as Partial<ChartFeature>).areaLabel;
    const legs = checkRouteHazards(
      base({
        waypoints: [
          { lat: -0.5, lon: 0.5 },
          { lat: 1.5, lon: 0.5 },
        ],
        areas: [outline],
      }),
    );
    expect(legs[0].hazards).toEqual([]);
  });

  it('returns nothing for fewer than two waypoints', () => {
    expect(checkRouteHazards(base({ waypoints: [{ lat: 0, lon: 0 }] }))).toEqual([]);
  });
});
