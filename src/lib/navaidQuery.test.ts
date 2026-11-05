import { describe, expect, it } from 'vitest';
import { buildOverpassQuery } from '../../server/overpassProxy';

const view: [number, number, number, number] = [50.6, -0.4, 50.8, -0.1];

describe('navaid query', () => {
  it('fetches offshore structures alongside seamarks', () => {
    const query = buildOverpassQuery(view);
    expect(query).toContain('node["power"="generator"]["generator:source"="wind"](50.6,-0.4,50.8,-0.1)');
    expect(query).toContain('nwr["man_made"="offshore_platform"](50.6,-0.4,50.8,-0.1)');
    expect(query).toContain('node["power"="plant"]["plant:source"="wind"](50.6,-0.4,50.8,-0.1)');
  });

  it('fetches lights mapped on structure ways, not just light nodes', () => {
    const query = buildOverpassQuery(view);
    const centreBlock = query.split('out center tags;')[0];
    expect(centreBlock).toContain('way["seamark:light:character"](50.6,-0.4,50.8,-0.1)');
    expect(centreBlock).toContain('way["seamark:light:1:character"](50.6,-0.4,50.8,-0.1)');
    expect(centreBlock).toContain('way["seamark:light:colour"](50.6,-0.4,50.8,-0.1)');
    expect(centreBlock).toContain('way["seamark:light:1:colour"](50.6,-0.4,50.8,-0.1)');
  });

  it('fetches farm areas with geometry, not as centre points', () => {
    const query = buildOverpassQuery(view);
    const centreBlock = query.split('out center tags;')[0];
    // Node farms are points; way/relation farms must not also appear in the
    // centre block, or each farm would draw twice.
    expect(centreBlock).toContain('node["power"="plant"]');
    expect(centreBlock).not.toContain('way["power"="plant"]');
    expect(centreBlock).not.toContain('relation["power"="plant"]');
    expect(query).toContain('way["power"="plant"]["plant:source"="wind"](50.6,-0.4,50.8,-0.1)');
    expect(query).toContain('relation["power"="plant"]["plant:source"="wind"](50.6,-0.4,50.8,-0.1)');
    // The farm geometry block comes after the communication-area geometry.
    expect(query.indexOf('way["power"="plant"]')).toBeGreaterThan(query.indexOf('relation["seamark:type"="communication_area"]'));
  });

  it('fetches cable lines with geometry, not as centre points', () => {
    const query = buildOverpassQuery(view);
    const centreBlock = query.split('out center tags;')[0];
    // The centre block holds the generic way selector, but the cable line
    // itself must not appear there, or each cable would draw twice.
    expect(centreBlock).not.toContain('way["seamark:type"="cable_overhead"]');
    expect(query).toContain('way["seamark:type"="cable_overhead"](50.6,-0.4,50.8,-0.1)');
    // The cable geometry block comes after the calling-in-point geometry.
    expect(query.indexOf('way["seamark:type"="cable_overhead"]')).toBeGreaterThan(
      query.indexOf('way["seamark:type"="calling-in_point"](50.6,-0.4,50.8,-0.1)'),
    );
  });
});
