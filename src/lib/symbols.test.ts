import { describe, expect, it } from 'vitest';
import { minZoomFor, priorityFor } from '../../shared/navaid-core.mjs';
import {
  lightSymbolColour,
  quickInfo,
  raconText,
  soundSignalText,
  symbolFor,
  symbolForMark,
} from './navaids';
import type { Navaid } from './navaidTypes';

describe('offshore structure symbols', () => {
  it('draws a turbine, a farm and a rig as three different marks', () => {
    const turbine = symbolFor('wind_turbine', 'A');
    const farm = symbolFor('wind_farm', 'A');
    const rig = symbolFor('oil_rig', 'A');

    expect(turbine.svg).not.toBe(farm.svg);
    expect(turbine.svg).not.toBe(rig.svg);
    expect(farm.svg).not.toBe(rig.svg);
    expect(turbine.label).toBe('Wind turbine');
    expect(farm.label).toBe('Wind farm');
    expect(rig.label).toBe('Oil rig');
    // The turbine is yellow like a special mark; the rig is grey so the two
    // cannot be confused, and the farm is a dashed area, not a point.
    expect(turbine.svg).toContain('#f4c531');
    expect(rig.svg).toContain('#c7d3da');
    expect(farm.svg).toContain('stroke-dasharray');
  });
});

describe('pylon symbol', () => {
  it('draws a grey tower distinct from the turbine and rig', () => {
    const pylon = symbolFor('pylon', 'A');
    const turbine = symbolFor('wind_turbine', 'A');
    const rig = symbolFor('oil_rig', 'A');
    expect(pylon.label).toBe('Pylon');
    expect(pylon.svg).not.toBe(turbine.svg);
    expect(pylon.svg).not.toBe(rig.svg);
    expect(pylon.svg).toContain('#8b9aa3');
  });
});

describe('pile and beacon-board symbols', () => {
  it('draws a pile as a brown post distinct from the tower', () => {
    const pile = symbolFor('pile', 'B');
    const pylon = symbolFor('pylon', 'A');
    expect(pile.label).toBe('Pile');
    expect(pile.svg).toContain('#a67c52');
    expect(pile.svg).not.toBe(pylon.svg);
  });

  it('draws the pylon as an open grey lattice, not a solid body', () => {
    const pylon = symbolFor('pylon', 'A').svg;
    expect(pylon).toContain('M10 28 L14 10');
    expect(pylon).toContain('#8b9aa3');
    expect(pylon).not.toContain('M11 28 L14 10 L18 10 L21 28 Z');
  });

  it('draws a beacon-form lateral as a board on a post, not a buoy body', () => {
    const spec = symbolForMark(buoy({ category: 'lateral_port', form: 'beacon' }), 'B');
    expect(spec.svg).toContain('x="8" y="3" width="13" height="9"');
    expect(spec.svg).toContain('x="13.5" y="12" width="5" height="15"');
    expect(spec.svg).toContain('M8 27.5 H13');
    expect(spec.svg).not.toContain('M12 8 H20 V11 H23 V25 H9 V11 H12 Z');
  });

  it('leaves a buoy-form lateral as its buoy body', () => {
    const spec = symbolForMark(buoy({ category: 'lateral_port', form: 'buoy' }), 'B');
    expect(spec.svg).toContain('M12 8 H20 V11 H23 V25 H9 V11 H12 Z');
    expect(spec.svg).not.toContain('x="8" y="3" width="13" height="9"');
  });

  it('gives a lit beacon board and a lit pile the 135-degree beam', () => {
    const beacon = symbolForMark(
      buoy({ category: 'lateral_starboard', form: 'beacon', lit: true, light: 'Fl R 4s', lightColour: 'red' }),
      'B',
    );
    expect(beacon.svg).toContain('M16 2 L23.5 12 L8.5 12 Z');
    expect(beacon.svg).toContain('26.61');
    const pile = symbolForMark(
      buoy({ category: 'pile_lit', lit: true, light: 'Fl W 4s', lightColour: 'white' }),
      'B',
    );
    expect(pile.svg).toContain('x="13" y="5" width="6"');
    expect(pile.svg).toContain('26.61');
  });

  it('draws a lighted pile with a lamp and an unlit pile as the bare post', () => {
    const lit = symbolFor('pile_lit', 'A');
    const unlit = symbolFor('pile_unlit', 'A');
    expect(lit.label).toBe('Lighted pile');
    expect(unlit.label).toBe('Unlit pile');
    // Both are the same brown post; only the lighted one carries the lamp.
    expect(lit.svg).toContain('#a67c52');
    expect(lit.svg).toContain('#ffd166');
    expect(unlit.svg).toContain('#a67c52');
    expect(unlit.svg).not.toContain('#ffd166');
    expect(lit.svg).not.toBe(unlit.svg);
  });

  it('gives an unlit pile no beam', () => {
    const pile = symbolForMark(buoy({ category: 'pile_unlit', lit: false }), 'B');
    expect(pile.svg).toContain('x="13" y="5" width="6"');
    expect(pile.svg).not.toContain('data-mark-annotation="light"');
  });
});

describe('special-beacon daymark boards', () => {
  it('draws a beacon-form special mark with a daymark as its board on a post', () => {
    const spec = symbolForMark(
      buoy({ category: 'special_purpose', form: 'beacon', daymarkShape: 'square', daymarkColour: 'green' }),
      'B',
    );
    expect(spec.svg).toContain('x="8" y="3" width="13" height="9"');
    expect(spec.svg).toContain('#26a65b');
    expect(spec.svg).toContain('x="13.5" y="12" width="5" height="15"');
    expect(spec.svg).toContain('M8 27.5 H13');
    expect(spec.svg).not.toBe(symbolForMark(buoy({ category: 'special_purpose', form: 'beacon' }), 'B').svg);
  });

  it('draws a triangle daymark as a triangle, not a square', () => {
    const spec = symbolForMark(
      buoy({ category: 'special_purpose', form: 'beacon', daymarkShape: 'triangle, point up', daymarkColour: 'red' }),
      'B',
    );
    expect(spec.svg).toContain('M16 2 L23.5 12 L8.5 12 Z');
    expect(spec.svg).toContain('#e23b3b');
    expect(spec.svg).not.toContain('x="8" y="3" width="13" height="9"');
  });

  it('leaves a special beacon without daymark tags as the plain diamond', () => {
    const spec = symbolForMark(buoy({ category: 'special_purpose', form: 'beacon' }), 'B');
    expect(spec.svg).toContain('#f4c531');
    expect(spec.svg).not.toContain('x="13.5" y="12" width="5" height="15"');
  });
});

describe('cable symbol', () => {
  it('draws an orange wire distinct from the tower and turbine', () => {
    const cable = symbolFor('cable_overhead', 'A');
    const pylon = symbolFor('pylon', 'A');
    const turbine = symbolFor('wind_turbine', 'A');
    expect(cable.label).toBe('Overhead cable');
    expect(cable.svg).toContain('#ff8a3d');
    expect(cable.svg).not.toBe(pylon.svg);
    expect(cable.svg).not.toBe(turbine.svg);
  });
});

describe('light symbols', () => {
  it('draws major and minor lights as different shapes', () => {
    const major = symbolFor('major_light', 'A').svg;
    const minor = symbolFor('light', 'A').svg;

    expect(major).not.toBe(minor);
    // A major light is the lighthouse tower (lamp room and two bands);
    // a minor light is the sector-beacon post (tower and a coloured top).
    expect(major).toContain('M13.15 15 L18.85 15');
    expect(major).toContain('<rect x="13.8" y="4.5"');
    expect(minor).toContain('M14.3 10 L17.7 10 L17.9 13 L14.1 13 Z');
    expect(minor).not.toContain('<rect x="13.8" y="4.5"');
  });

  it('uses distinct colours for the two light classes', () => {
    // The legend has no light mapped: the major light shows the classic
    // red bands, the minor light an amber top.
    expect(symbolFor('major_light', 'A').svg).toContain('#e23b3b');
    expect(symbolFor('light', 'A').svg).toContain('#ffd166');
    expect(symbolFor('light', 'A').svg).not.toContain('#e23b3b');
  });

  it('labels the two classes differently', () => {
    expect(symbolFor('major_light', 'A').label).toBe('Major light');
    expect(symbolFor('light', 'A').label).toBe('Minor light');
  });

  it('draws a sector light as the sector-beacon tower under its own label', () => {
    const sector = symbolFor('sector_light', 'A');
    const beacon = symbolFor('sector_beacon', 'A');
    expect(sector.label).toBe('Sector light');
    // A sector light IS the sector-beacon look, now under its own name
    // and filter — the tower and red top are unchanged.
    expect(sector.svg).toBe(beacon.svg);
    expect(sector.svg).toContain('#e23b3b');
  });

  it('gives a sector light its arcs, not the single beam', () => {
    const sector = symbolForMark(
      buoy({
        category: 'sector_light',
        form: 'light',
        lit: true,
        light: 'Q',
        lightSectors: [{ sector: 1, start: '016.5', end: '055.5', colour: 'red' }],
      }),
      'A',
    );
    expect(sector.svg).not.toContain('data-mark-annotation="light"');
  });

  it('colours the glyph parts from the mapped light, white as yellow', () => {
    const redMinor = symbolForMark(
      buoy({ category: 'light', form: 'light', lit: true, light: 'Fl R 5s', lightColour: 'red' }),
      'A',
    );
    expect(redMinor.svg).toContain('M14.3 10 L17.7 10 L17.9 13 L14.1 13 Z" fill="#e23b3b"');
    const whiteMajor = symbolForMark(
      buoy({ category: 'major_light', form: 'light', lit: true, light: 'Fl W 5s', lightColour: 'white' }),
      'A',
    );
    // A white light draws yellow on the white tower, or the bands vanish.
    expect(whiteMajor.svg).toContain('M13.15 15 L18.85 15 L19.12 18 L12.88 18 Z" fill="#ffe066"');
    expect(whiteMajor.svg).not.toContain('M13.15 15 L18.85 15 L19.12 18 L12.88 18 Z" fill="#f4f7f8"');
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

  it('treats a compacted shard record (transit fields absent, not null) as having no transit', () => {
    // Compacted shards omit null fields, so a record loaded from JSON has
    // transitBearing/transitDistanceM undefined, not null. The quick info
    // must not render a bogus "lines up undefined°" for it.
    const compacted = {
      id: 'noaa-enc:Light:1',
      lat: 50.76,
      lon: -1.2,
      category: 'light',
      form: 'light',
      name: 'Inner Beacon',
      light: 'Fl red 5s',
      colour: 'red',
      lit: true,
      priority: 62,
      source: 'noaa-enc',
    } as Navaid;
    const info = quickInfo(compacted, 'A');
    expect(info).not.toContain('lines up');
    expect(info).not.toContain('undefined');
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

  it('draws no generic beam for a mark with mapped sectors — the arcs carry its light', () => {
    const spec = symbolForMark(buoy({
      lit: true,
      lightCharacter: 'Iso',
      lightSectors: [{ sector: 1, colour: 'green' }],
    }), 'A');
    expect(spec.units).toBe(32);
    expect(spec.svg).not.toContain('data-mark-annotation="light"');
    // The same mark without sectors still gets its beam.
    const plain = symbolForMark(buoy({ lit: true, lightCharacter: 'Iso', lightColour: 'green' }), 'A');
    expect(plain.units).toBe(56);
    expect(plain.svg).toContain('data-mark-annotation="light"');
  });

  it('gives a major light the same beam, in its own light colour', () => {
    const spec = symbolForMark(
      buoy({ category: 'major_light', lit: true, light: 'Fl R 5s', lightColour: 'red' }),
      'A',
    );

    expect(spec.units).toBe(56);
    expect(spec.svg).toContain('data-mark-annotation="light"');
    // The same beam a buoy gets, starting clear of the tower.
    expect(spec.svg).toContain('M26.61 26.61 L43.15 36.65 L36.65 43.15 Z" fill="#e23b3b"');
    expect(spec.svg).not.toContain('r="1.8"');
    // The tower's bands carry the light colour; the magenta star is gone.
    expect(spec.svg).toContain('M13.15 15 L18.85 15 L19.12 18 L12.88 18 Z" fill="#e23b3b"');
    expect(spec.svg).not.toContain('#ff43d0');
  });

  it('gives a minor light a beam leaving its body, in its own light colour', () => {
    const spec = symbolForMark(
      buoy({ category: 'light', lit: true, light: 'Fl G 5s', lightColour: 'green' }),
      'A',
    );

    expect(spec.units).toBe(56);
    expect(spec.svg).toContain('data-mark-annotation="light"');
    expect(spec.svg).toContain('M26.61 26.61 L43.15 36.65 L36.65 43.15 Z" fill="#26a65b"');
    expect(spec.svg).not.toContain('r="1.8"');
    // The post's top carries the light colour; the lavender star is gone.
    expect(spec.svg).toContain('M14.3 10 L17.7 10 L17.9 13 L14.1 13 Z" fill="#26a65b"');
    expect(spec.svg).not.toContain('#d9a6ff');
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

describe('light colour letters', () => {
  it('maps official single-letter colours to their beams', () => {
    const cases: [string, string][] = [
      ['R', '#e23b3b'],
      ['G', '#26a65b'],
      ['W', '#f4f7f8'],
      ['Y', '#f4c531'],
      ['Bu', '#3aa0ff'],
      ['R W G', '#e23b3b'],
    ];
    for (const [letter, hex] of cases) {
      expect(lightSymbolColour({ lightColour: letter } as Navaid)).toBe(hex);
    }
  });

  it('keeps the amber fallback when no colour is given', () => {
    expect(lightSymbolColour({ lightColour: '.....' } as Navaid)).toBe('#ffd166');
    expect(lightSymbolColour({ lightColour: null } as Navaid)).toBe('#ffd166');
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
