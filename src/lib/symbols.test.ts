import { describe, expect, it } from 'vitest';
import { minZoomFor, priorityFor } from '../../shared/navaid-core.mjs';
import { quickInfo, symbolFor } from './navaids';
import type { Navaid } from './navaidTypes';

describe('light symbols', () => {
  it('draws major and minor lights as different shapes', () => {
    const major = symbolFor('major_light', 'A').svg;
    const minor = symbolFor('light', 'A').svg;

    expect(major).not.toBe(minor);
    // Major lights carry an 8-ray star burst; minor lights only four stubs.
    expect((major.match(/<line/g) ?? []).length).toBe(8);
    expect((minor.match(/<line/g) ?? []).length).toBe(4);
    expect(minor).toContain('r="9.4"');
  });

  it('uses distinct colours for the two light classes', () => {
    expect(symbolFor('major_light', 'A').svg).toContain('#ff43d0');
    expect(symbolFor('light', 'A').svg).toContain('#d9a6ff');
    expect(symbolFor('light', 'A').svg).not.toContain('#ff43d0');
  });

  it('labels the two classes differently', () => {
    expect(symbolFor('major_light', 'A').label).toBe('Major light');
    expect(symbolFor('light', 'A').label).toBe('Minor light');
  });
});

describe('lateral colours', () => {
  it('follows IALA region A and B', () => {
    expect(symbolFor('lateral_port', 'A').svg).toContain('#e23b3b');
    expect(symbolFor('lateral_starboard', 'A').svg).toContain('#26a65b');
    expect(symbolFor('lateral_port', 'B').svg).toContain('#26a65b');
    expect(symbolFor('lateral_starboard', 'B').svg).toContain('#e23b3b');
  });
});

describe('bifurcation marks', () => {
  it('are a banded can and cone, not a sphere like safe water', () => {
    const port = symbolFor('preferred_channel_port', 'A').svg;
    const starboard = symbolFor('preferred_channel_starboard', 'A').svg;
    const safeWater = symbolFor('safe_water', 'A').svg;

    expect(port).not.toBe(starboard);
    // Port bifurcation is a can (rectangle), starboard a cone (triangle).
    expect(port).toContain('<rect x="8" y="8"');
    expect(starboard).toContain('M16 6 L25 26 H7 Z');
    // Neither may reuse the safe-water ball.
    expect(port).not.toContain('cx="16" cy="17" r="9.5"');
    expect(starboard).not.toContain('cx="16" cy="17" r="9.5"');
    expect(safeWater).toContain('cx="16" cy="17" r="9.5"');
    // Both carry the wide white band that marks a preferred channel.
    expect(port).toContain('#f4f7f8');
    expect(starboard).toContain('#f4f7f8');
  });

  it('follows the IALA lateral colours and is labelled as bifurcation', () => {
    expect(symbolFor('preferred_channel_port', 'A').svg).toContain('#e23b3b');
    expect(symbolFor('preferred_channel_starboard', 'A').svg).toContain('#26a65b');
    expect(symbolFor('preferred_channel_starboard', 'B').svg).toContain('#e23b3b');
    expect(symbolFor('preferred_channel_port', 'A').label).toContain('bifurcation');
  });

  it('appears earlier than lateral buoys so junction marks are not culled', () => {
    expect(minZoomFor('preferred_channel_starboard')).toBeLessThanOrEqual(11);
    expect(minZoomFor('preferred_channel_port')).toBeLessThanOrEqual(11);
  });
});

describe('anchorage marks', () => {
  it('draws an anchorage ground with an anchor, not a generic disc', () => {
    const svg = symbolFor('anchorage', 'A').svg;
    expect(svg).toContain('stroke-dasharray');
    expect(svg).toContain('M16 10.5 V21.5');
    expect(svg).toContain('#ff43d0');
  });

  it('survives declutter against generic hazards and shows from z12', () => {
    expect(priorityFor('anchorage')).toBeGreaterThan(priorityFor('hazard'));
    expect(priorityFor('anchorage')).toBeGreaterThan(priorityFor('special_purpose'));
    expect(minZoomFor('anchorage')).toBeLessThanOrEqual(12);
  });
});

describe('anchor and calling-in symbols', () => {
  it('draws an anchor berth differently from an anchorage ground', () => {
    const berth = symbolFor('anchor_berth', 'A').svg;
    const ground = symbolFor('anchorage', 'A').svg;
    expect(berth).not.toBe(ground);
    // The ground is a dashed circle; the berth a dashed square.
    expect(ground).toContain('stroke-dasharray="3 2"');
    expect(berth).toContain('stroke-dasharray="4 2.5"');
    expect(berth).toContain('M16 11.5');
  });

  it('draws a calling-in point as a radio, not a seamark', () => {
    const spec = symbolFor('calling_in_point', 'A');
    expect(spec.svg).toContain('#3dd6ff');
    expect(spec.svg).toContain('A6.5 6.5');
    expect(spec.label).toBe('Calling-in point');
  });

  it('draws a reporting area with a radio-area symbol and chart-scale visibility', () => {
    const symbol = symbolFor('communication_area', 'A');
    expect(symbol.svg).toContain('#3dd6ff');
    expect(symbol.label).toBe('Vessel reporting / communication area');
    expect(minZoomFor('communication_area')).toBeLessThanOrEqual(12);
  });

  it('shows calling-in points before anchorages and berths at chart scale', () => {
    expect(minZoomFor('calling_in_point')).toBeLessThanOrEqual(12);
    expect(minZoomFor('anchor_berth')).toBeLessThanOrEqual(12);
    expect(priorityFor('calling_in_point')).toBeGreaterThan(priorityFor('anchorage'));
    expect(priorityFor('anchor_berth')).toBeGreaterThan(priorityFor('hazard'));
  });

  it('names the VHF channel in the quick info', () => {
    const calling: Navaid = {
      id: 'osm:way/256521658',
      lat: 49.0262,
      lon: -123.6586,
      category: 'calling_in_point',
      form: 'mark',
      name: '13 - West Porlier Pass',
      light: null,
      colour: null,
      shape: null,
      height: null,
      range: null,
      path: null,
      transitBearing: null,
      transitDistanceM: null,
      transitPartner: null,
      transitPartnerName: null,
      channel: '11A',
      callsign: 'PORT RADIO',
      description: null,
      lit: false,
      priority: 76,
      source: 'osm',
      updated: null,
      region: null,
    };
    expect(quickInfo(calling, 'B')).toContain('Calling-in point · 13 - West Porlier Pass · VHF Ch 11A · Call PORT RADIO');
  });
});

describe('transit symbols', () => {
  it('fills the dot at this end of the leading line', () => {
    const front = symbolFor('transit_front', 'A').svg;
    const rear = symbolFor('transit_rear', 'A').svg;
    expect(front).not.toBe(rear);
    // The front light fills the lower dot, the rear light the upper one.
    expect(front).toContain('cy="21.5" r="3.9" fill="#ff43d0"');
    expect(rear).toContain('cy="9.5" r="3.4" fill="#ff43d0"');
    // Both are drawn as a pair on a dashed sight line.
    expect(front).toContain('stroke-dasharray="2 2.6"');
    expect(rear).toContain('stroke-dasharray="2 2.6"');
  });

  it('labels the two ends of the transit', () => {
    expect(symbolFor('transit_front', 'A').label).toBe('Transit front (lower)');
    expect(symbolFor('transit_rear', 'A').label).toBe('Transit rear (higher)');
  });

  it('appears earlier than lateral buoys so leading lines are not culled', () => {
    expect(minZoomFor('transit_front')).toBeLessThanOrEqual(11);
    expect(minZoomFor('transit_rear')).toBeLessThanOrEqual(11);
    expect(priorityFor('transit_front')).toBeGreaterThan(priorityFor('lateral_starboard'));
  });
});

describe('wreck symbols', () => {
  it('draws a hull, not the hazard ball or the danger cross', () => {
    const wreck = symbolFor('wreck', 'A').svg;
    const hazard = symbolFor('hazard', 'A').svg;
    const danger = symbolFor('hazard_danger', 'A').svg;

    expect(wreck).not.toBe(hazard);
    expect(wreck).not.toBe(danger);
    // A listing hull with broken timbers standing out of it.
    expect(wreck).toContain('M4.2 21.6');
    expect(wreck).toContain('M15.6 20.2 L15 11.6');
    // The generic hazard is a black-banded sphere; the wreck must not reuse it.
    expect(hazard).toContain('cy="17" r="9.5"');
    expect(wreck).not.toContain('cy="17" r="9.5"');
    expect(symbolFor('wreck', 'A').label).toBe('Wreck');
  });

  it('shows from z12 and outranks generic hazards', () => {
    expect(minZoomFor('wreck')).toBeLessThanOrEqual(12);
    expect(priorityFor('wreck')).toBeGreaterThan(priorityFor('hazard'));
    expect(priorityFor('wreck')).toBeLessThan(priorityFor('hazard_danger'));
  });
});

describe('quick info', () => {
  it('distinguishes a major light from a minor light in the tooltip', () => {
    const base: Navaid = {
      id: 'osm:node/1',
      lat: 50.76,
      lon: -1.2,
      category: 'major_light',
      form: 'light',
      name: 'Spit Sand Fort',
      light: 'Fl red 5s',
      colour: 'red',
      shape: null,
      height: null,
      range: null,
      path: null,
      transitBearing: null,
      transitDistanceM: null,
      transitPartner: null,
      transitPartnerName: null,
      channel: null,
      callsign: null,
      description: null,
      lit: true,
      priority: 100,
      source: 'osm',
      updated: null,
      region: 'solent',
    };
    expect(quickInfo(base, 'A')).toContain('Major light · Spit Sand Fort');
    expect(quickInfo({ ...base, category: 'light', name: 'Inner Beacon' }, 'A')).toContain(
      'Minor light · Inner Beacon',
    );
  });
});
