import { describe, expect, it } from 'vitest';
import { buildChartAreaQuery, buildChartBridgeQuery, buildChartFeatureQuery } from '../../server/overpassProxy';

const view: [number, number, number, number] = [50.88, -1.42, 50.93, -1.34];

describe('split chart-feature query', () => {
  it('asks for bridges and the water they cross without the marine areas', () => {
    const query = buildChartBridgeQuery(view);
    expect(query).toContain('nwr["bridge"]["bridge"!="no"](50.88,-1.42,50.93,-1.34)');
    // The water classes are one scan over `water`, `waterway` and `natural`;
    // separate scans for each cost about a fifth of the answer time.
    expect(query).toContain('nwr[~"^(water|waterway|natural)$"~"^(sea|tidal|estuary|lagoon|harbour');
    // Lakes are fetched too, as direct crossing targets — a lake is water a
    // bridge can span regardless of tides (see overpass.ts isLakeWater).
    expect(query).toContain('fjord|strait|lake)');
    expect(query).toContain('nwr[~"^(tidal|tidal:range)$"~"."](50.88,-1.42,50.93,-1.34)');
    expect(query).not.toContain('boundary');
    expect(query).not.toContain('military');
  });

  it('asks for marine areas without the bridge and water shapes', () => {
    const query = buildChartAreaQuery(view);
    expect(query).toContain('boundary');
    expect(query).toContain('military');
    expect(query).not.toContain('nwr["bridge"]');
    expect(query).not.toContain('nwr[~"^(water|waterway|natural)$"');
  });

  it('keeps a valid combined query for a caller that asks for no part', () => {
    const query = buildChartFeatureQuery(view);
    expect(query.match(/\[out:json\]/g)).toHaveLength(1);
    expect(query.match(/out body geom;/g)).toHaveLength(1);
    expect(query).toContain('nwr["bridge"]');
    expect(query).toContain('boundary');
  });

  it('gives each half its own request, so one cannot hold the other back', () => {
    expect(buildChartBridgeQuery(view)).not.toEqual(buildChartAreaQuery(view));
  });
});
