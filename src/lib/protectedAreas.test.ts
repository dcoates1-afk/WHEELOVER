import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearProtectedAreaCache, loadNatura2000 } from './protectedAreas';

function featureCollection(features: unknown[]) {
  return new Response(JSON.stringify({ type: 'FeatureCollection', features }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubFetch(payload: Response) {
  const realFetch = globalThis.fetch.bind(globalThis);
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
    String(input).startsWith('/api/natura2000') ? Promise.resolve(payload.clone()) : realFetch(input, init),
  );
}

afterEach(() => {
  clearProtectedAreaCache();
  vi.restoreAllMocks();
});

describe('conservation site loading', () => {
  it('accepts both EMODnet layers, one labelled record per site', async () => {
    stubFetch(featureCollection([
      {
        id: 'natura2000areas.12',
        properties: { sitename: 'Baie de Seine occidentale', designation_layer: 'Natura 2000 site', directive: 'Habitats' },
        geometry: { type: 'Polygon', coordinates: [[[-1.2, 49.4], [-1.0, 49.4], [-1.0, 49.6], [-1.2, 49.4]]] },
      },
      {
        id: 'marineprotectedareas.486',
        properties: {
          name: 'SOLENT &amp; ISLE OF WIGHT LAGOONS',
          designation_layer: 'Marine protected area',
          designatio: 'Marine protected area (OSPAR)',
          country: 'United Kingdom',
        },
        geometry: {
          type: 'MultiPolygon',
          coordinates: [[[[-1.35, 50.7], [-1.3, 50.7], [-1.3, 50.75], [-1.35, 50.7]]]],
        },
      },
      { id: 'marineprotectedareas.7', properties: { name: 'No geometry' }, geometry: null },
    ]));

    const features = await loadNatura2000([50.6, -1.4, 50.8, -1.2]);
    expect(features.map((feature) => feature.name)).toEqual(['Baie de Seine occidentale', 'SOLENT & ISLE OF WIGHT LAGOONS']);
    expect(features[0].properties).toEqual({ 'Designation layer': 'Natura 2000 site', Directive: 'Habitats' });
    expect(features[1].properties).toEqual({
      'Designation layer': 'Marine protected area',
      Designation: 'Marine protected area (OSPAR)',
      Country: 'United Kingdom',
    });
    expect(features[1].bounds).toEqual([50.7, -1.35, 50.75, -1.3]);
  });

  it('reads bounds from a ring with far more points than the spread operator allows', async () => {
    const ring: number[][] = [];
    for (let index = 0; index < 200_000; index += 1) {
      ring.push([-1.3 + index * 1e-6, 50.7 + (index % 1000) * 1e-6]);
    }
    ring.push(ring[0]);
    stubFetch(featureCollection([
      { id: 'mpa.huge', properties: { name: 'Dense survey' }, geometry: { type: 'Polygon', coordinates: [ring] } },
    ]));
    const features = await loadNatura2000([50.6, -1.4, 50.8, -1.2]);
    expect(features).toHaveLength(1);
    expect(features[0].bounds[1]).toBeCloseTo(-1.3, 6);
    expect(features[0].bounds[2]).toBeCloseTo(50.700999, 6);
  });
});
