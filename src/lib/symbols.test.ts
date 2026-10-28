import { describe, expect, it } from 'vitest';
import { minZoomFor, priorityFor } from '../../shared/navaid-core.mjs';
import { quickInfo, symbolFor } from './navaids';
import type { Navaid } from './navaidTypes';

describe('light symbols', () => {
  it('draws major and minor lights as different shapes', () => {
    const major = symbolFor('major_light', 'A').svg;
    const minor = symbolFor('light', 'A').svg;

    expect(major).not.toBe(minor);
    // Retain the flare language; center and ray sizes distinguish the classes.
    expect((major.match(/<line/g) ?? []).length).toBe(8);
    expect((minor.match(/<line/g) ?? []).length).toBe(4);
    expect(major).toContain('r="4.2"');
    expect(minor).toContain('r="3.8"');
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

describe('lateral colours and buoy silhouettes', () => {
  it('follows IALA region A and B', () => {
    expect(symbolFor('lateral_port', 'A').svg).toContain('#e23b3b');
    expect(symbolFor('lateral_starboard', 'A').svg).toContain('#26a65b');
    expect(symbolFor('lateral_port', 'B').svg).toContain('#26a65b');
    expect(symbolFor('lateral_starboard', 'B').svg).toContain('#e23b3b');
  });

  it('uses chart-like square can and pointed nun buoy bodies', () => {
    const can = symbolFor('lateral_port', 'A').svg;
    const nun = symbolFor('lateral_starboard', 'A').svg;
    expect(can).toContain('M12 8 H20 V11 H23 V25 H9 V11 H12 Z');
    expect(nun).toContain('M12 7 H20 L23 11 L18 25 H14 L9 11 Z');
    expect(can).toContain('fill="#26a65b"');
    expect(nun).toContain('fill="#e23b3b"');
    expect(can).not.toBe(nun);
  });
});

describe('cardinal chart symbols', () => {
  it('uses directional IALA topmarks and the four black/yellow band patterns', () => {
    const north = symbolFor('cardinal_north', 'A').svg;
    const east = symbolFor('cardinal_east', 'A').svg;
    const south = symbolFor('cardinal_south', 'A').svg;
    const west = symbolFor('cardinal_west', 'A').svg;

    expect(north).toContain('M11 9 L16 2.5 L21 9 Z');
    expect(south).toContain('M11 3 L16 8.5 L21 3 Z');
    // East's twin cones point away from each other; west's point inward.
    expect(east).toContain('M11 7 L16 2.5 L21 7 Z M11 9.5 L21 9.5 L16 14 Z');
    expect(west).toContain('M11 2.5 L21 2.5 L16 7 Z M11 14 L16 9.5 L21 14 Z');
    expect(north).toContain('fill="#101820"');
    expect(north).toContain('fill="#f4c531"');
    expect([north, east, south, west].every((svg, i, list) => list.indexOf(svg) === i)).toBe(true);
  });
});

describe('safe-water and hazard chart symbols', () => {
  it('shows safe water as vertical red/white stripes and generic hazard as horizontal bands', () => {
    const safeWater = symbolFor('safe_water', 'A').svg;
    const isolatedDanger = symbolFor('isolated_danger', 'A').svg;
    const hazard = symbolFor('hazard', 'A').svg;

    expect(safeWater).toContain('V25.3');
    expect(safeWater).toContain('V22.8');
    expect(safeWater).toContain('#e23b3b');
    expect(isolatedDanger).toContain('H23.8 V19.5');
    expect(isolatedDanger).toContain('fill="#e23b3b"');
    expect(hazard).toContain('H23.8 V19.5');
    expect(hazard).toContain('fill="#101820"');
  });
});

describe('bifurcation marks', () => {
  it('are a banded can and cone, not a sphere like safe water', () => {
    const port = symbolFor('preferred_channel_port', 'A').svg;
    const starboard = symbolFor('preferred_channel_starboard', 'A').svg;
    const safeWater = symbolFor('safe_water', 'A').svg;

    expect(port).not.toBe(starboard);
    // Port bifurcation is a can (rectangle), starboard a cone (triangle).
    expect(port).toContain('M12 8 H20 V11 H23 V25 H9 V11 H12 Z');
    expect(starboard).toContain('M12 7 H20 L23 11 L18 25 H14 L9 11 Z');
    // Neither may reuse the safe-water ball.
    expect(port).not.toContain('cx="16" cy="17" r="9.5"');
    expect(starboard).not.toContain('cx="16" cy="17" r="9.5"');
    expect(safeWater).toContain('cx="16" cy="17.5" r="8.5"');
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
    expect(spec.svg).toContain('A5.4 5.4');
    expect(spec.svg).toContain('cy="19" r="7.2"');
    expect(spec.svg).not.toContain('M9.5 13 V8.5');
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
  it('shows one chart-like light glyph at each paired feature', () => {
    const front = symbolFor('transit_front', 'A').svg;
    const rear = symbolFor('transit_rear', 'A').svg;
    expect(front).toBe(rear);
    expect(front).toContain('#ff43d0');
    expect(front).toContain('r="2.5"');
    expect(front).not.toContain('stroke-dasharray');
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
  it('uses the fishbone chart symbol and circles dangerous wrecks', () => {
    const wreck = symbolFor('wreck', 'A').svg;
    const dangerousWreck = symbolFor('hazard_danger', 'A').svg;
    const hazard = symbolFor('hazard', 'A').svg;

    expect(wreck).not.toBe(dangerousWreck);
    expect(wreck).toContain('M7 16 H25 M9 13 L12 19');
    expect(dangerousWreck).toContain('stroke-dasharray="2 2"');
    expect(dangerousWreck).toContain('M7 16 H25 M9 13 L12 19');
    expect(wreck).not.toContain('stroke-dasharray="2 2"');
    expect(hazard).not.toContain('M7 16 H25');
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
