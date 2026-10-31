import { describe, expect, it } from 'vitest';
import { minZoomFor, priorityFor } from '../../shared/navaid-core.mjs';
import {
  quickInfo,
  raconText,
  soundSignalText,
  symbolFor,
  symbolForMark,
} from './navaids';
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

  it('paints a mark in the colour its source records, whatever the region', () => {
    // Region B would default these two to the opposite colours.
    expect(symbolFor('lateral_port', 'B', 'red').svg).toContain('#e23b3b');
    expect(symbolFor('lateral_starboard', 'B', 'green').svg).toContain('#26a65b');
    expect(symbolFor('lateral_port', 'A', 'green').svg).toContain('#26a65b');
    expect(symbolFor('lateral_starboard', 'A', 'red').svg).toContain('#e23b3b');
  });

  it('reads a banded colour list top band first', () => {
    const banded = symbolFor('lateral_starboard', 'A', 'white;green;white').svg;
    expect(banded).toContain('fill="#f4f7f8"');
    expect(banded).toContain('fill="#26a65b"');
  });

  it('draws an unsided lateral mark in its mapped colour instead of grey', () => {
    const green = symbolFor('lateral_other', 'A', 'green').svg;
    expect(green).toContain('#26a65b');
    expect(green).not.toContain('#8fa3ad');
    // Green is starboard in Region A, so it takes the point-ended silhouette.
    expect(green).toContain('M12 7 H20 L23 11 L18 25 H14 L9 11 Z');

    const red = symbolFor('lateral_other', 'A', 'red').svg;
    expect(red).toContain('#e23b3b');
    expect(red).toContain('M12 8 H20 V11 H23 V25 H9 V11 H12 Z');

    // The same paint is a port-hand can in Region B.
    expect(symbolFor('lateral_other', 'B', 'green').svg).toContain('M12 8 H20 V11 H23 V25 H9 V11 H12 Z');
  });

  it('keeps the neutral grey only where no colour is mapped', () => {
    expect(symbolFor('lateral_other', 'A').svg).toContain('#8fa3ad');
    expect(symbolFor('lateral_other', 'A', 'grey').svg).toContain('#8fa3ad');
    // A side word in the colour field is not a colour.
    expect(symbolFor('lateral_other', 'A', 'starboard').svg).toContain('#8fa3ad');
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

function buoy(overrides: Partial<Navaid> = {}): Navaid {
  return {
    id: 'osm:node/9',
    lat: 50.7,
    lon: -1.2,
    category: 'lateral_starboard',
    form: 'buoy',
    name: null,
    light: null,
    colour: 'green',
    shape: 'cone',
    height: null,
    range: null,
    path: null,
    transitBearing: null,
    transitDistanceM: null,
    transitPartner: null,
    transitPartnerName: null,
    channel: null,
    description: null,
    lit: null,
    priority: 50,
    source: 'osm',
    updated: null,
    region: null,
    ...overrides,
  };
}

describe('signal annotations on chart marks', () => {
  it('leaves a mark with no mapped signals exactly as before', () => {
    const spec = symbolForMark(buoy(), 'A');
    expect(spec.units).toBe(32);
    expect(spec.svg).toBe(symbolFor('lateral_starboard', 'A', 'green').svg);
    expect(spec.svg).not.toContain('data-mark-annotation');
  });

  it('throws a light beam on the 135° bearing in the mapped light colour', () => {
    const spec = symbolForMark(buoy({
      light: 'Fl(2) red 10s',
      lightCharacter: 'Fl',
      lightColour: 'red',
      lit: true,
    }), 'A');

    expect(spec.units).toBe(56);
    expect(spec.svg).toContain('data-mark-annotation="light"');
    // A beam from the lamp towards the south-east corner, not a star.
    expect(spec.svg).toContain('M26.61 26.61 L43.15 36.65 L36.65 43.15 Z');
    expect(spec.svg).toContain('fill="#e23b3b"');
    // The beam is the whole cue: no lamp dot sits at its base.
    expect(spec.svg).not.toContain('r="1.8"');
    // The aid itself is unchanged apart from the wider viewport.
    expect(spec.svg).toContain('M12 7 H20 L23 11 L18 25 H14 L9 11 Z');
  });

  it('falls back to the first mapped sector colour for the flare', () => {
    const spec = symbolForMark(buoy({
      lit: true,
      lightCharacter: 'Iso',
      lightSectors: [{ sector: 1, colour: 'green' }],
    }), 'A');
    expect(spec.svg).toContain('data-mark-annotation="light"');
    expect(spec.svg).toContain('fill="#26a65b"');
  });

  it('gives a major light the same beam, without a second lamp dot', () => {
    const spec = symbolForMark(buoy({ category: 'major_light', lit: true, light: 'Fl 5s' }), 'A');

    expect(spec.units).toBe(56);
    expect(spec.svg).toContain('data-mark-annotation="light"');
    // The same beam a buoy gets, starting outside the glyph's 14-unit rays.
    expect(spec.svg).toContain('M26.61 26.61 L43.15 36.65 L36.65 43.15 Z');
    expect(spec.svg).not.toContain('r="1.8"');
    // The light's own star is untouched.
    expect(spec.svg).toContain('stroke="#ff43d0"');
  });

  it('gives a minor light a beam leaving its body', () => {
    const spec = symbolForMark(buoy({ category: 'light', lit: true, light: 'Fl 5s' }), 'A');

    expect(spec.units).toBe(56);
    expect(spec.svg).toContain('data-mark-annotation="light"');
    expect(spec.svg).toContain('M26.61 26.61 L43.15 36.65 L36.65 43.15 Z');
    expect(spec.svg).not.toContain('r="1.8"');
    expect(spec.svg).toContain('stroke="#d9a6ff"');
  });

  it('beams a transit light, which is also drawn as a light', () => {
    const spec = symbolForMark(buoy({ category: 'transit_front', lit: true, light: 'F R' }), 'A');
    expect(spec.svg).toContain('data-mark-annotation="light"');
    expect(spec.svg).not.toContain('r="1.8"');
  });

  it('keeps an unlit mark unchanged even in a light class', () => {
    const spec = symbolForMark(buoy({ category: 'light', lit: false }), 'A');
    expect(spec.units).toBe(32);
    expect(spec.svg).not.toContain('data-mark-annotation');
  });

  it('draws three sound lines on the 225° bearing and names the signal above them', () => {
    const spec = symbolForMark(buoy({
      fogSignal: true,
      fogSignalCategory: 'bell',
      fogSignalGroup: '2',
      fogSignalPeriod: '30',
    }), 'A');

    const group = spec.svg.match(/<g data-mark-annotation="sound">([\s\S]*?)<\/g>/)?.[1] ?? '';
    const arcs = [...group.matchAll(
      /M(-?[\d.]+) (-?[\d.]+) A[\d.]+ [\d.]+ 0 0 1 (-?[\d.]+) (-?[\d.]+)/g,
    )];
    // Three radiating lines, each drawn twice: a dark halo under a light stroke.
    expect(arcs).toHaveLength(6);
    for (const [, x1, y1, x2, y2] of arcs) {
      // South-west of the aid: every end lies left of and below its centre.
      expect(Number(x1)).toBeLessThan(16);
      expect(Number(y1)).toBeGreaterThan(16);
      expect(Number(x2)).toBeLessThan(16);
      expect(Number(y2)).toBeGreaterThan(16);
    }
    expect(group).toContain('>bell</text>');
    expect(group).toContain('y="21.6"');
    expect(group).toContain('stroke="#f4f7f8" stroke-width="1.5"');
  });

  it('labels a horn signal as a horn', () => {
    const spec = symbolForMark(buoy({
      fogSignal: true,
      fogSignalCategory: 'horn',
    }), 'A');
    expect(spec.svg).toContain('>horn</text>');
  });

  it('rings a marked radar transponder', () => {
    const spec = symbolForMark(buoy({
      radarTransponderCategory: 'racon',
      radarTransponderGroup: '1',
      radarTransponderPeriod: '60',
    }), 'A');
    expect(spec.svg).toContain('data-mark-annotation="racon"');
    expect(spec.svg).toContain('r="14"');
    return expect(spec.units).toBe(56);
  });
});

describe('signal wording for the mark sheet', () => {
  it('describes a mapped bell with its group and period', () => {
    expect(soundSignalText(buoy({
      fogSignal: true,
      fogSignalCategory: 'bell',
      fogSignalGroup: '2',
      fogSignalPeriod: '30',
    }))).toBe('bell · group 2 · 30 s period');
    expect(soundSignalText(buoy())).toBeNull();
    expect(soundSignalText(buoy({ fogSignal: true }))).toBe('Mapped sound signal (kind not stated)');
  });

  it('describes a mapped racon separately from a radar reflector', () => {
    expect(raconText(buoy({
      radarTransponderCategory: 'racon',
      radarTransponderPeriod: '60',
    }))).toBe('racon · 60 s period');
    expect(raconText(buoy({ radarReflector: true }))).toBeNull();
  });
});
