import { describe, expect, it } from 'vitest';
import { buildOverpassQuery } from './overpassProxy';

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
