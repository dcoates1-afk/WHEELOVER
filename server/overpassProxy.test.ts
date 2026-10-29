import { describe, expect, it } from 'vitest';
import { buildChartFeatureQuery, buildOverpassQuery } from './overpassProxy';

describe('Overpass chart context query', () => {
  it('fetches navigation bridge and protected-area feature types with geometry', () => {
    const query = buildChartFeatureQuery([49, -124, 50, -123]);
    expect(query).toContain('nwr["seamark:type"="bridge"](49,-124,50,-123)');
    expect(query).toContain('nwr["bridge"]["bridge"!="no"](49,-124,50,-123)');
    expect(query).toContain('nwr["tidal"="yes"](49,-124,50,-123)');
    expect(query).toContain('nwr["tidal:range"](49,-124,50,-123)');
    expect(query).toContain('nwr["water"="tidal"](49,-124,50,-123)');
    expect(query).toContain('nwr["waterway"="tidal_channel"](49,-124,50,-123)');
    expect(query).toContain('nwr["boundary"="protected_area"](49,-124,50,-123)');
    expect(query).toContain('nwr["leisure"="nature_reserve"](49,-124,50,-123)');
    expect(query).not.toContain('nwr["waterway"~');
    expect(query).not.toContain('nwr["natural"="water"]');
    expect(query).toContain('out geom tags;');
  });
});


describe('Overpass NAVAID query', () => {
  it('requests calling-in lines and communication-area geometries within the viewport', () => {
    const query = buildOverpassQuery([49, -124, 50, -123]);
    expect(query).toContain('node["seamark:type"](49,-124,50,-123)');
    expect(query).toContain('way["seamark:type"="calling-in_point"](49,-124,50,-123)');
    expect(query).toContain('way["seamark:type"="communication_area"](49,-124,50,-123)');
    expect(query).toContain('relation["seamark:type"="communication_area"](49,-124,50,-123)');
    expect(query.match(/out geom;/g)).toHaveLength(2);
  });
});
