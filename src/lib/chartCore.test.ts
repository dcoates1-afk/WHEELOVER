import { describe, expect, it } from 'vitest';
import {
  annotateTransits,
  bearingDegrees,
  classifyTags,
  dedupeNavaids,
  cellBounds,
  cellKey,
  ialaRegion,
  normalizeElement,
  selectVisibleNavaids,
} from '../../shared/navaid-core.mjs';
import type { Navaid, NavaidCategory } from './navaidTypes';

function mark(overrides: Partial<Navaid> & { category: NavaidCategory }): Navaid {
  return {
    id: overrides.id ?? `test/${Math.random()}`,
    lat: overrides.lat ?? 50.8,
    lon: overrides.lon ?? -1.2,
    category: overrides.category,
    form: overrides.form ?? 'buoy',
    name: overrides.name ?? null,
    light: overrides.light ?? null,
    colour: overrides.colour ?? null,
    shape: overrides.shape ?? null,
    height: overrides.height ?? null,
    range: overrides.range ?? null,
    path: overrides.path ?? null,
    paths: overrides.paths ?? null,
    transitBearing: overrides.transitBearing ?? null,
    transitDistanceM: overrides.transitDistanceM ?? null,
    transitPartner: overrides.transitPartner ?? null,
    transitPartnerName: overrides.transitPartnerName ?? null,
    channel: overrides.channel ?? null,
    description: overrides.description ?? null,
    lit: overrides.lit ?? null,
    priority: overrides.priority ?? 50,
    source: overrides.source ?? 'osm',
    updated: overrides.updated ?? null,
    region: overrides.region ?? 'solent',
  };
}

describe('classification', () => {
  it('separates port and starboard lateral marks', () => {
    const port = classifyTags({ 'seamark:type': 'buoy_lateral', 'seamark:buoy_lateral:category': 'port' });
    const starboard = classifyTags({
      'seamark:type': 'beacon_lateral',
      'seamark:beacon_lateral:category': 'starboard',
    });
    expect(port?.category).toBe('lateral_port');
    expect(port?.form).toBe('buoy');
    expect(starboard?.category).toBe('lateral_starboard');
    expect(starboard?.form).toBe('beacon');
  });

  it('detects bifurcation / preferred-channel marks', () => {
    const preferred = classifyTags({
      'seamark:type': 'buoy_lateral',
      'seamark:buoy_lateral:category': 'preferred_channel_starboard',
    });
    expect(preferred?.category).toBe('preferred_channel_starboard');
  });

  it('maps cardinal categories and defaults unknown quadrants', () => {
    expect(
      classifyTags({ 'seamark:type': 'buoy_cardinal', 'seamark:buoy_cardinal:category': 'east' })?.category,
    ).toBe('cardinal_east');
    expect(classifyTags({ 'seamark:type': 'beacon_cardinal' })?.category).toBe('cardinal_unspecified');
  });

  it('treats leading beacons and leading-light categories as range marks', () => {
    expect(
      classifyTags({
        'seamark:type': 'beacon_special_purpose',
        'seamark:beacon_special_purpose:category': 'leading',
      })?.category,
    ).toBe('range');
    expect(
      classifyTags({ 'seamark:type': 'light_minor', 'seamark:light:category': 'leading' })?.category,
    ).toBe('range');
  });

  it('classifies unlit beacons as day marks (lit false)', () => {
    const result = classifyTags({
      'seamark:type': 'beacon_special_purpose',
      'seamark:beacon_special_purpose:category': 'warning',
    });
    expect(result?.form).toBe('beacon');
    expect(result?.lit).toBe(false);
  });

  it('gives wrecks their own class and keeps dangerous ones distinct', () => {
    const dangerous = classifyTags({
      'seamark:type': 'wreck',
      'seamark:wreck:category': 'dangerous',
    });
    expect(dangerous?.category).toBe('hazard_danger');

    for (const category of ['non-dangerous', 'hull_showing', undefined]) {
      const tags: Record<string, string> = { 'seamark:type': 'wreck' };
      if (category) tags['seamark:wreck:category'] = category;
      expect(classifyTags(tags)?.category).toBe('wreck');
    }

    // A wreck is no longer lumped in with rocks and obstructions.
    expect(classifyTags({ 'seamark:type': 'rock' })?.category).toBe('hazard');
  });

  it('separates transit front and rear lights from ordinary minor lights', () => {
    const role = (category: string) =>
      classifyTags({ 'seamark:type': 'light_minor', 'seamark:light:category': category })?.category;
    expect(role('lower')).toBe('transit_front');
    expect(role('upper')).toBe('transit_rear');
    expect(role('front')).toBe('transit_front');
    expect(role('rear')).toBe('transit_rear');
    expect(role('upper;leading')).toBe('transit_rear');
    expect(role('leading;front')).toBe('transit_front');
    // A directional bearing light is not a transit, and a leading light with no
    // role stays a generic range mark.
    expect(role('bearing')).toBe('light');
    expect(role('leading')).toBe('range');
  });

  it('plots wrecks that carry no seamark schema', () => {
    expect(classifyTags({ historic: 'wreck' })?.category).toBe('wreck');
    expect(classifyTags({ 'man_made': 'wreck' })?.category).toBe('wreck');
  });

  it('keeps NOAA chart wrecks distinct from OSM identities and retains danger classification', () => {
    const wreck = normalizeElement({
      type: 'node',
      id: 610308,
      lat: 40.4523944,
      lon: -73.8178389,
      tags: { 'seamark:type': 'wreck', 'seamark:wreck:category': 'dangerous' },
    }, undefined, 'noaa-enc') as Navaid;
    expect(wreck.category).toBe('hazard_danger');
    expect(wreck.id).toBe('noaa-enc:node/610308');
  });

  it('drops areas, cables and unknown shoreline features', () => {
    expect(classifyTags({ 'seamark:type': 'cable_submarine' })).toBeNull();
    expect(classifyTags({ 'seamark:type': 'restricted_area' })).toBeNull();
    expect(classifyTags({ 'building': 'yes' })).toBeNull();
  });

  it('keeps lit nodes that only carry light tags', () => {
    expect(classifyTags({ 'seamark:light:character': 'Fl' })?.category).toBe('light');
  });

  it('plots anchorages, anchor berths and calling-in points', () => {
    expect(classifyTags({ 'seamark:type': 'anchorage' })?.category).toBe('anchorage');
    // Areas are plotted at their centre instead of being dropped with the
    // cables and restricted zones.
    expect(classifyTags({ 'seamark:type': 'anchorage_area' })?.category).toBe('anchorage');
    expect(classifyTags({ 'seamark:type': 'anchor_berth' })?.category).toBe('anchor_berth');
    expect(classifyTags({ 'seamark:type': 'calling-in_point' })?.category).toBe('calling_in_point');
    expect(classifyTags({ 'seamark:type': 'communication_area' })?.category).toBe('communication_area');
  });
});

describe('normalisation', () => {
  it('builds a full mark from OSM tags including light text', () => {
    const navaid = normalizeElement({
      type: 'node',
      id: 42,
      lat: 50.7,
      lon: -1.3,
      tags: {
        name: 'No Man Land Buoy',
        'seamark:type': 'buoy_lateral',
        'seamark:buoy_lateral:category': 'port',
        'seamark:light:character': 'Fl',
        'seamark:light:group': '2',
        'seamark:light:colour': 'red',
        'seamark:light:period': '10',
        'seamark:buoy_lateral:system': 'iala-a',
        'seamark:buoy_lateral:colour': 'red',
        'seamark:light:1:character': 'Fl',
        'seamark:light:1:colour': 'red',
        'seamark:light:1:group': '3',
        'seamark:light:1:period': '10',
        'seamark:light:1:sector_start': '045',
        'seamark:light:1:sector_end': '090',
      },
    }) as Navaid;

    expect(navaid.id).toBe('osm:node/42');
    expect(navaid.category).toBe('lateral_port');
    expect(navaid.light).toBe('Fl(2) red 10s');
    expect(navaid.lightCharacter).toBe('Fl');
    expect(navaid.buoyageSystem).toBe('iala-a');
    expect(navaid.colour).toBe('red');
    expect(navaid.lightSectors).toEqual([{ sector: 1, character: 'Fl', colour: 'red', group: '3', period: '10', start: '045', end: '090' }]);
    expect(navaid.source).toBe('osm');
  });

  it('keeps the VHF channel of a calling-in point and the details of a berth', () => {
    const calling = normalizeElement({
      type: 'way',
      id: 256521658,
      center: { lat: 49.0262, lon: -123.6586 },
      tags: {      'seamark:type': 'calling-in_point',
      'seamark:name': '13 - West Porlier Pass',
      'seamark:calling-in_point:channel': '11A',
      'seamark:calling-in_point:traffic_flow': 'two-way',
      'seamark:calling-in_point:callsign': 'PORT RADIO',
      },
    }) as Navaid;
    expect(calling.category).toBe('calling_in_point');
    expect(calling.channel).toBe('11A');
    expect(calling.callsign).toBe('PORT RADIO');
    expect(calling.name).toBe('13 - West Porlier Pass');

    const berth = normalizeElement({
      type: 'node',
      id: 4343318617,
      lat: 49.0181,
      lon: -123.6281,
      tags: {
        'seamark:type': 'anchor_berth',
        'seamark:name': 'Trincomali ANC 1',
        'seamark:anchor_berth:category': 'tanker',
        'seamark:anchor_berth:minimum_depth': '10',
        'seamark:anchor_berth:radius': '170',
      },
    }) as Navaid;
    expect(berth.category).toBe('anchor_berth');
    expect(berth.description).toContain('10 m minimum depth');
    expect(berth.description).toContain('170 m radius');
    expect(berth.description).toContain('tanker');
  });

  it('keeps reporting-area boundary geometry from multipath relations', () => {
    const area = normalizeElement({
      type: 'relation',
      id: 991,
      tags: { 'seamark:type': 'communication_area', name: 'Harbour VTS Sector' },
      geometryPaths: [
        [{ lat: 49, lon: -124 }, { lat: 50, lon: -124 }, { lat: 50, lon: -123 }, { lat: 49, lon: -124 }],
        [{ lat: 49.2, lon: -123.8 }, { lat: 49.3, lon: -123.7 }],
      ],
    }) as Navaid;
    expect(area.category).toBe('communication_area');
    expect(area.paths).toHaveLength(2);
    expect(area.lat).toBe(49.5);
  });

  it('keeps the line geometry of a calling-in point, with the icon at its midpoint', () => {
    const line = normalizeElement({
      type: 'way',
      id: 256521658,
      geometry: [
        { lat: 49.0258, lon: -123.6712 },
        { lat: 49.0266, lon: -123.6461 },
        { lat: 49.0271, lon: -123.6209 },
      ],
      tags: { 'seamark:type': 'calling-in_point', 'seamark:calling-in_point:channel': '11A' },
    }) as Navaid;

    expect(line.path).toEqual([
      [49.0258, -123.6712],
      [49.0266, -123.6461],
      [49.0271, -123.6209],
    ]);
    expect(line.lat).toBe(49.0266);
    expect(line.lon).toBe(-123.6461);
  });

  it('describes a wreck by its water level', () => {
    const wreck = normalizeElement({
      type: 'node',
      id: 9154493155,
      lat: 50.6589,
      lon: -1.5855,
      tags: {
        name: 'Alchemist',
        'seamark:type': 'wreck',
        'seamark:wreck:category': 'non-dangerous',
        'seamark:wreck:water_level': 'submerged',
      },
    }) as Navaid;
    expect(wreck.category).toBe('wreck');
    expect(wreck.name).toBe('Alchemist');
    expect(wreck.wreckBoatingEffect).toContain('not considered dangerous to surface navigation');
    expect(wreck.wreckBoatingEffect).toContain('not a clearance or safe-passage guarantee');
    expect(wreck.description).toContain('Chart source classifies this wreck');
    expect(wreck.description).toContain('Charted water level: submerged');
  });

  it('does not infer a steady light when the source has no character code', () => {
    const light = normalizeElement({
      type: 'node',
      id: 18,
      lat: 50.7,
      lon: -1.3,
      tags: { 'seamark:type': 'light_minor', 'seamark:light:colour': 'white' },
    }) as Navaid;
    expect(light.lightCharacter).toBeNull();
    expect(light.light).toBeNull();
    expect(light.lit).toBe(true);
  });

  it('retains wreck identity, boating-risk context, and community dive details', () => {
    const wreck = normalizeElement({
      type: 'way',
      id: 204,
      center: { lat: 50.7, lon: -1.2 },
      tags: {
        name: 'Example Wreck',
        historic: 'wreck',
        'wreck:type': 'cargo_ship',
        'wreck:date_sunk': '1944-06-01',
        'wreck:depth': '18',
        'wreck:clearance': '12',
        'wreck:length': '75',
        'wreck:width': '11',
        'sport': 'scuba_diving',
        'scuba_diving:depth': '16',
        'scuba_diving:maxdepth': '20',
        'scuba_diving:entry': 'boat',
        'scuba_diving:hazard': 'netting',
        'scuba_diving:drift': 'yes',
      },
    }) as Navaid;
    expect(wreck.name).toBe('Example Wreck');
    expect(wreck.wreckType).toBe('cargo_ship');
    expect(wreck.wreckDateSunk).toBe('1944-06-01');
    expect(wreck.wreckReportedDepth).toBe('18');
    expect(wreck.wreckClearance).toBe('12');
    expect(wreck.wreckLength).toBe('75');
    expect(wreck.wreckWidth).toBe('11');
    expect(wreck.diveSite).toBe(true);
    expect(wreck.diveDepth).toBe('16');
    expect(wreck.diveMaxDepth).toBe('20');
    expect(wreck.diveEntry).toBe('boat');
    expect(wreck.diveHazard).toBe('netting');
    expect(wreck.driftDive).toBe(true);
    expect(wreck.description).toContain('typical dive depth 16 m');
    expect(wreck.description).toContain('not current safety advice');
  });

  it('leaves point marks without a path', () => {
    const buoy = normalizeElement({
      type: 'node',
      id: 9,
      lat: 50.7,
      lon: -1.3,
      tags: { 'seamark:type': 'buoy_safe_water' },
    }) as Navaid;
    expect(buoy.path).toBeNull();
  });

  it('uses way centres and skips elements without a position', () => {
    const center = normalizeElement({
      type: 'way',
      id: 7,
      center: { lat: 50.6, lon: -1.1 },
      tags: { 'seamark:type': 'buoy_safe_water' },
    }) as Navaid;
    expect(center.lat).toBe(50.6);
    expect(normalizeElement({ type: 'way', id: 8, tags: { 'seamark:type': 'buoy_lateral' } })).toBeNull();
  });
});

describe('transits', () => {
  it('measures bearings clockwise from north', () => {
    expect(Math.round(bearingDegrees(0, 0, 1, 0))).toBe(0);
    expect(Math.round(bearingDegrees(0, 0, 0, 1))).toBe(90);
  });

  it('pairs the Inskip Islands lower and upper lights into a leading line', () => {
    const lower = normalizeElement({
      type: 'node',
      id: 1223235782,
      lat: 48.44193,
      lon: -123.43896,
      tags: {
        'seamark:type': 'light_minor',
        'seamark:light:category': 'lower',
        'seamark:name': 'Inskip Islands',
      },
    }) as Navaid;
    const upper = normalizeElement({
      type: 'node',
      id: 1199797501,
      lat: 48.44271,
      lon: -123.43865,
      tags: { 'seamark:type': 'light_minor', 'seamark:light:category': 'upper' },
    }) as Navaid;

    const [front, rear] = annotateTransits([lower, upper]) as Navaid[];
    expect(front.category).toBe('transit_front');
    expect(rear.category).toBe('transit_rear');
    // Front to rear is the course to steer with the two in line: NNE here.
    expect(front.transitBearing).toBeGreaterThanOrEqual(12);
    expect(front.transitBearing).toBeLessThanOrEqual(18);
    expect(front.transitDistanceM).toBeGreaterThan(80);
    expect(front.transitDistanceM).toBeLessThan(100);
    expect(front.transitPartner).toBe(rear.id);
    expect(rear.transitBearing).toBe(front.transitBearing);
    expect(rear.transitPartnerName).toBe('Inskip Islands');
  });

  it('leaves an unpaired transit light without a bearing', () => {
    const solo = mark({ category: 'transit_front', lat: 48.44, lon: -123.43 });
    const [annotated] = annotateTransits([solo]) as Navaid[];
    expect(annotated.transitBearing).toBeNull();
    expect(annotated.transitPartner).toBeNull();
  });
});

describe('IALA regions', () => {
  it('uses region B in the Americas and region A in Europe', () => {
    expect(ialaRegion(40.7, -74.0)).toBe('B');
    expect(ialaRegion(50.8, -1.2)).toBe('A');
    expect(ialaRegion(35.6, 139.7)).toBe('B');
  });
});

describe('dedupe', () => {
  it('merges records with the same name close together and keeps the richer one', () => {
    const sparse = mark({ category: 'major_light', name: 'Needles Light', lat: 50.66, lon: -1.58 });
    const rich = mark({
      category: 'major_light',
      name: 'Needles Light',
      lat: 50.6601,
      lon: -1.5801,
      light: 'Fl(2) W 10s',
      height: '24',
    });
    const { navaids, removed } = dedupeNavaids([sparse, rich]) as { navaids: Navaid[]; removed: number };
    expect(removed).toBe(1);
    expect(navaids).toHaveLength(1);
    expect((navaids[0] as Navaid).light).toBe('Fl(2) W 10s');
  });

  it('keeps distinct aids that sit close but differ in family and name', () => {
    const buoy = mark({ category: 'lateral_port', lat: 50.7, lon: -1.2, name: 'A' });
    const beacon = mark({ category: 'lateral_starboard', lat: 50.7002, lon: -1.2, name: 'B' });
    const { navaids, removed } = dedupeNavaids([buoy, beacon]) as { navaids: Navaid[]; removed: number };
    expect(removed).toBe(0);
    expect(navaids).toHaveLength(2);
  });

  it('merges the same aid repeated within 12 m even without a name', () => {
    const first = mark({ category: 'hazard', lat: 50.7, lon: -1.2 });
    const second = mark({ category: 'hazard', lat: 50.70005, lon: -1.20005 });
    const { navaids, removed } = dedupeNavaids([first, second]) as { navaids: Navaid[]; removed: number };
    expect(removed).toBe(1);
    expect(navaids).toHaveLength(1);
  });

  it('does not treat nearby unnamed wrecks as duplicates by proximity alone', () => {
    const first = mark({ category: 'hazard_danger', id: 'osm:node/1', lat: 50.7, lon: -1.2 });
    const second = mark({ category: 'hazard_danger', id: 'noaa-enc:2', lat: 50.70001, lon: -1.2, source: 'noaa-enc' });
    const { navaids, removed } = dedupeNavaids([first, second]) as { navaids: Navaid[]; removed: number };
    expect(removed).toBe(0);
    expect(navaids).toHaveLength(2);
  });
});

describe('cells', () => {
  it('round-trips a cell key to bounds that contain the point', () => {
    const key = cellKey(50.76, -1.2) as string;
    const [south, west, north, east] = cellBounds(key) as [number, number, number, number];
    expect(50.76).toBeGreaterThanOrEqual(south);
    expect(50.76).toBeLessThanOrEqual(north);
    expect(-1.2).toBeGreaterThanOrEqual(west);
    expect(-1.2).toBeLessThanOrEqual(east);
  });
});

describe('zoom declutter', () => {
  const bounds: [number, number, number, number] = [50.5, -1.8, 51.0, -0.7];

  it('hides low-priority marks at low zoom unless Show all marks is on', () => {
    const light = mark({ category: 'major_light', lat: 50.8, lon: -1.2 });
    const mooring = mark({ category: 'mooring', lat: 50.81, lon: -1.21 });
    const zoomedOut = selectVisibleNavaids([light, mooring], { zoom: 10, bounds }) as Navaid[];
    expect(zoomedOut.map((entry) => entry.category)).toEqual(['major_light']);
    const all = selectVisibleNavaids([light, mooring], { zoom: 10, bounds, showAll: true }) as Navaid[];
    expect(all).toHaveLength(2);
  });

  it('filters marks outside the viewport but includes a reporting area whose boundary crosses it', () => {
    const inside = mark({ category: 'lateral_port', lat: 50.8, lon: -1.2 });
    const outside = mark({ category: 'lateral_port', lat: 51.5, lon: -1.2 });
    const area = mark({
      category: 'communication_area',
      lat: 51.3,
      lon: -1.2,
      paths: [[[50.7, -1.7], [50.7, -1.6], [51.3, -1.6], [51.3, -1.7]]],
    });
    const visible = selectVisibleNavaids([inside, outside, area], { zoom: 14, bounds, showAll: true }) as Navaid[];
    expect(visible.map(({ id }) => id)).toContain(area.id);
    expect(visible.map(({ id }) => id)).toContain(inside.id);
    expect(visible.map(({ id }) => id)).not.toContain(outside.id);
  });

  it('caps dense scenes by priority', () => {
    const dense: Navaid[] = [];
    for (let index = 0; index < 40; index += 1) {
      dense.push(mark({ category: 'lateral_port', lat: 50.7 + index * 0.001, lon: -1.2 }));
      dense.push(mark({ category: 'major_light', lat: 50.75 + index * 0.001, lon: -1.3 }));
    }
    const visible = selectVisibleNavaids(dense, {
      zoom: 15,
      bounds: [50.5, -1.8, 51.0, -0.7],
      showAll: true,
      limit: 10,
    }) as Navaid[];
    expect(visible).toHaveLength(10);
    expect(visible.every((entry) => entry.category === 'major_light')).toBe(true);
  });
});
