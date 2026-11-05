import { describe, expect, it } from 'vitest';
import {
  annotateTransits,
  bearingDegrees,
  classifyTags,
  dedupeNavaids,
  cellBounds,
  cellKey,
  ialaRegion,
  lightSectorArc,
  lightSectorDisplayRadius,
  lightSectorDrawLimits,
  lightSectorsFromTags,
  lightText,
  mirrorLightSectorBearings,
  mergeLightSectors,
  mergeNavaidSources,
  minZoomFor,
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
    lightCharacter: overrides.lightCharacter ?? null,
    lightColour: overrides.lightColour ?? null,
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

describe('sector light geometry', () => {
  it('uses north-clockwise bearings, draws half again the charted reach and mirrors latitude', () => {
    const arc = lightSectorArc(0, 0, 350, 10, 1000, 10);
    expect(arc.length).toBeGreaterThan(2);
    // The arc runs half again the supplied radius, so a 1000 m sector is
    // drawn 1500 m out: ±0.00234° of longitude either side of due north.
    expect(arc[0][1]).toBeCloseTo(-0.00234, 4);
    expect(arc.at(-1)![1]).toBeCloseTo(0.00234, 4);
    // Latitude is mirrored about the light, so the sector that crosses north
    // is drawn south of it, while its longitude stays as charted.
    expect(arc[Math.floor(arc.length / 2)][0]).toBeLessThan(-0.01);
  });

  it('mirrors east and west bearings while keeping north and south fixed', () => {
    expect(mirrorLightSectorBearings(0, 0)).toEqual([0, 0]);
    expect(mirrorLightSectorBearings(180, 180)).toEqual([180, 180]);
    expect(mirrorLightSectorBearings(90, 90)).toEqual([270, 270]);
    expect(mirrorLightSectorBearings(270, 270)).toEqual([90, 90]);
    expect(mirrorLightSectorBearings(230, 260)).toEqual([100, 130]);
    expect(mirrorLightSectorBearings(-1, 90)).toBeNull();
  });

  it('rejects sectors without valid bearings or positive angular span', () => {
    expect(lightSectorArc(50, -1, 20, 20, 1000)).toEqual([]);
    expect(lightSectorArc(50, -1, -1, 20, 1000)).toEqual([]);
  });

  // Hurst Point charts three Iso leading lights at 39.8°, 41.3° and 42.8°.
  // They have an orientation but no limits, so the drawn limits come from the
  // renderer's helper, which also covers marks read from prebuilt shards.
  it('draws a directional light as a narrow beam about its orientation', () => {
    const beams = ['39.8', '41.3', '42.8'].map((orientation) => lightSectorDrawLimits({ category: 'directional', orientation }));
    for (const [index, beam] of beams.entries()) {
      const centre = 39.8 + index * 1.5;
      expect(beam?.[0]).toBeCloseTo(centre - 1.5, 3);
      expect(beam?.[1]).toBeCloseTo(centre + 1.5, 3);
    }
  });

  it('wraps a directional beam that straddles north', () => {
    const limits = lightSectorDrawLimits({ category: 'directional', orientation: '359' });
    expect(limits?.[0]).toBeCloseTo(357.5, 3);
    expect(limits?.[1]).toBeCloseTo(0.5, 3);
  });

  it('prefers charted sector limits over the orientation', () => {
    expect(lightSectorDrawLimits({ start: '080', end: '104', orientation: '39.8' })).toEqual([80, 104]);
  });

  it('reads bearings written with a degree sign and stray spaces', () => {
    const sectors = lightSectorsFromTags({
      'seamark:light:1:sector_start': '023.4°',
      'seamark:light:1:sector_end': '024.3 °',
    });
    expect(sectors).toHaveLength(1);
    expect(lightSectorDrawLimits(sectors[0])?.[0]).toBeCloseTo(23.4, 3);
    expect(lightSectorDrawLimits(sectors[0])?.[1]).toBeCloseTo(24.3, 3);

    const negative = lightSectorsFromTags({
      'seamark:light:1:sector_start': '-20',
      'seamark:light:1:sector_end': '180',
    });
    expect(lightSectorDrawLimits(negative[0])).toEqual([340, 180]);
  });

  it('expands a comma list of bearings into one sector per pair', () => {
    const sectors = lightSectorsFromTags({
      'seamark:light:1:character': 'Fl',
      'seamark:light:1:colour': 'white',
      'seamark:light:1:sector_start': '240,300',
      'seamark:light:1:sector_end': '120,285',
    });
    expect(sectors).toHaveLength(2);
    expect(sectors.map((sector) => lightSectorDrawLimits(sector))).toEqual([[240, 120], [300, 285]]);
    expect(sectors.every((sector) => sector.character === 'Fl')).toBe(true);
    expect(new Set(sectors.map((sector) => sector.sector)).size).toBe(2);
  });

  it('draws nothing for a sector with no limits that is not directional', () => {
    expect(lightSectorDrawLimits({ category: 'leading', orientation: '120' })).toBeNull();
    expect(lightSectorDrawLimits({ orientation: '120' })).toBeNull();
  });

  it('merges records for each sector without losing unique sectors or filled values', () => {
    expect(mergeLightSectors(
      [{ sector: 1, character: 'Fl', colour: 'red', start: '340' }, { sector: 3, colour: 'green' }],
      [{ sector: 1, end: '020', range: '4' }, { sector: 2, character: 'F', colour: 'white' }],
    )).toEqual([
      { sector: 1, character: 'Fl', colour: 'red', start: '340', end: '020', range: '4' },
      { sector: 2, character: 'F', colour: 'white' },
      { sector: 3, colour: 'green' },
    ]);
  });

  it('renders a full-circle sector and north-crossing span', () => {
    expect(lightSectorArc(0, 0, 0, 360, 1000)).toHaveLength(91);
    expect(lightSectorArc(0, 0, 350, 10, 1000)).toHaveLength(6);
  });

  it('doubles the drawn fan between zoom 13 and zoom 16', () => {
    const base = lightSectorDisplayRadius(12, 6);
    expect(lightSectorDisplayRadius(13, 6)).toBeCloseTo(base, 6);
    expect(lightSectorDisplayRadius(16, 6)).toBeCloseTo(base * 2, 6);
    expect(lightSectorDisplayRadius(18, 6)).toBeCloseTo(base * 2, 6);
    // The stretch is linear across the band, not a step at either end.
    const middle = lightSectorDisplayRadius(14.5, 6);
    expect(middle).toBeGreaterThan(base);
    expect(middle).toBeLessThan(base * 2);
  });

  it('keeps the fan radius a screen length and refuses bad inputs', () => {
    // Same zoom, half the ground per pixel, half the drawn radius.
    expect(lightSectorDisplayRadius(11, 12)).toBeCloseTo(lightSectorDisplayRadius(11, 24) / 2, 6);
    expect(lightSectorDisplayRadius(11, 0)).toBe(0);
    expect(lightSectorDisplayRadius(Number.NaN, 12)).toBe(0);
  });
});

describe('structure-attached lights', () => {
  it('charts a light mapped on a structure way with no seamark type', () => {
    const result = classifyTags({
      highway: 'footway',
      bridge: 'yes',
      'seamark:light:character': 'Fl',
      'seamark:light:colour': 'R',
      'seamark:light:period': '4',
    });
    expect(result?.category).toBe('light');
    expect(result?.form).toBe('light');
    expect(result?.lit).toBe(true);
  });

  it('charts a colour-only way light', () => {
    const result = classifyTags({ 'man_made': 'pier', 'seamark:light:colour': 'G' });
    expect(result?.category).toBe('light');
  });

  it('charts a lit bridge way as its light, not a facility dot', () => {
    const lit = classifyTags({
      'seamark:type': 'bridge',
      'seamark:light:character': 'Oc',
      'seamark:light:colour': 'W',
    });
    expect(lit?.category).toBe('light');
    const unlit = classifyTags({ 'seamark:type': 'bridge' });
    expect(unlit?.category).toBe('facility');
  });

  it('joins a second light on the same structure, but not its sectors', () => {
    expect(lightText({
      'seamark:light:character': 'Fl',
      'seamark:light:colour': 'R',
      'seamark:light:period': '4',
      'seamark:light:1:character': 'Oc',
      'seamark:light:1:colour': 'G',
      'seamark:light:1:period': '6',
    })).toBe('Fl R 4s; Oc G 6s');
    // A numbered record with bearings is a sector of the one light, not
    // a second light, so it stays out of the joined text.
    expect(lightText({
      'seamark:light:character': 'Fl',
      'seamark:light:colour': 'W',
      'seamark:light:1:character': 'Fl',
      'seamark:light:1:colour': 'R',
      'seamark:light:1:sector_start': '0',
      'seamark:light:1:sector_end': '90',
    })).toBe('Fl W');
  });

  it('keeps the sector-light summary unchanged', () => {
    expect(lightText({
      'seamark:light:1:character': 'Iso',
      'seamark:light:1:colour': 'W',
      'seamark:light:1:period': '2',
      'seamark:light:1:sector_start': '0',
      'seamark:light:1:sector_end': '360',
    })).toBe('Iso W 2s');
  });

  it('normalizes a way-tagged light at the way centre', () => {
    const mark = normalizeElement({
      type: 'way',
      id: 999,
      center: { lat: 50.8, lon: -1.1 },
      tags: {
        highway: 'footway',
        bridge: 'yes',
        'seamark:light:character': 'Fl',
        'seamark:light:colour': 'R',
        'seamark:light:period': '4',
      },
    });
    expect(mark?.category).toBe('light');
    expect(mark?.lat).toBe(50.8);
    expect(mark?.lon).toBe(-1.1);
    expect(mark?.light).toBe('Fl R 4s');
  });
});

describe('pylon marks', () => {
  it('charts a pylon as its own mark, lit or not', () => {
    const unlit = classifyTags({ 'seamark:type': 'pylon', 'power': 'tower' });
    expect(unlit?.category).toBe('pylon');
    expect(unlit?.lit).toBe(false);
    const lit = classifyTags({
      'seamark:type': 'pylon',
      'power': 'tower',
      'seamark:light:character': 'F',
      'seamark:light:colour': 'R',
    });
    expect(lit?.category).toBe('pylon');
    expect(lit?.lit).toBe(true);
  });

  it('normalizes a pylon node at its position', () => {
    const mark = normalizeElement({
      type: 'node',
      id: 4242,
      lat: 50.8,
      lon: -1.1,
      tags: { 'seamark:type': 'pylon', 'power': 'tower', 'seamark:pylon:category': 'power' },
    });
    expect(mark?.category).toBe('pylon');
    expect(mark?.lat).toBe(50.8);
  });
});

describe('pile marks', () => {
  it('charts a pile as its own mark, lit or not', () => {
    const unlit = classifyTags({ 'seamark:type': 'pile' });
    expect(unlit?.category).toBe('pile');
    expect(unlit?.lit).toBe(false);
    const lit = classifyTags({
      'seamark:type': 'pile',
      'seamark:light:character': 'F',
      'seamark:light:colour': 'W',
    });
    expect(lit?.category).toBe('pile');
    expect(lit?.lit).toBe(true);
  });

  it('normalizes a pile node at its position', () => {
    const mark = normalizeElement({
      type: 'node',
      id: 4243,
      lat: 45.5838,
      lon: -122.5139,
      tags: { 'seamark:type': 'pile' },
    });
    expect(mark?.category).toBe('pile');
    expect(mark?.lat).toBe(45.5838);
  });
});

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

  it('ranks a landmark carrying a numbered sector light as a major light', () => {
    // Hurst Point is charted as a landmark whose lights are all numbered sector
    // records, so it has no unnumbered light character to be recognised by.
    const hurst = classifyTags({
      'seamark:type': 'landmark',
      'man_made': 'lighthouse',
      'seamark:light:1:character': 'Fl',
      'seamark:light:1:colour': 'white',
      'seamark:light:1:sector_start': '080',
      'seamark:light:1:sector_end': '104',
    });
    expect(hurst?.category).toBe('major_light');
    expect(minZoomFor(hurst!.category)).toBeLessThan(13);
    // An unlit landmark keeps its landmark rank.
    expect(classifyTags({ 'seamark:type': 'landmark' })?.category).toBe('landmark');
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

  it('normalises offshore structures from live elements', () => {
    const turbine = normalizeElement({
      type: 'node', id: 1, lat: 50.7, lon: -0.2,
      tags: { power: 'generator', 'generator:source': 'wind', name: 'Rampion T1' },
    }) as Navaid;
    expect(turbine.category).toBe('wind_turbine');
    expect([turbine.lat, turbine.lon]).toEqual([50.7, -0.2]);

    const rig = normalizeElement({
      type: 'way', id: 2, center: { lat: 58.1, lon: 1.2 },
      tags: { 'man_made': 'offshore_platform', name: 'Test Rig' },
    }) as Navaid;
    expect(rig.category).toBe('oil_rig');
    expect([rig.lat, rig.lon]).toEqual([58.1, 1.2]);

    // A farm way's point is the bbox centre of its ring, not a boundary vertex.
    const ring = [
      { lat: 50.6, lon: -0.4 }, { lat: 50.6, lon: -0.1 }, { lat: 50.8, lon: -0.1 },
      { lat: 50.8, lon: -0.4 }, { lat: 50.6, lon: -0.4 },
    ];
    const farmWay = normalizeElement({
      type: 'way', id: 3, geometry: ring,
      tags: { power: 'plant', 'plant:source': 'wind', name: 'Test Farm' },
    }) as Navaid;
    expect(farmWay.category).toBe('wind_farm');
    expect([farmWay.lat, farmWay.lon]).toEqual([50.7, -0.25]);
    expect(farmWay.path).toHaveLength(5);

    // A farm relation's point is the bbox centre of its member geometry.
    const farmRelation = normalizeElement({
      type: 'relation', id: 4,
      members: [{ type: 'way', geometry: ring }],
      tags: { power: 'plant', 'plant:source': 'wind', name: 'Test Farm' },
    }) as Navaid;
    expect(farmRelation.category).toBe('wind_farm');
    expect([farmRelation.lat, farmRelation.lon]).toEqual([50.7, -0.25]);
    expect(farmRelation.paths).toHaveLength(1);
  });

  it('drops areas, cables and unknown shoreline features', () => {
    expect(classifyTags({ 'seamark:type': 'cable_submarine' })).toBeNull();
    expect(classifyTags({ 'seamark:type': 'restricted_area' })).toBeNull();
    expect(classifyTags({ 'building': 'yes' })).toBeNull();
  });

  it('keeps lit nodes that only carry light tags', () => {
    expect(classifyTags({ 'seamark:light:character': 'Fl' })?.category).toBe('light');
  });

  it('classifies offshore structures', () => {
    expect(classifyTags({ power: 'generator', 'generator:source': 'wind' })?.category).toBe('wind_turbine');
    expect(classifyTags({ power: 'plant', 'plant:source': 'wind' })?.category).toBe('wind_farm');
    expect(classifyTags({ 'man_made': 'offshore_platform' })?.category).toBe('oil_rig');
    expect(classifyTags({ 'seamark:type': 'platform' })?.category).toBe('oil_rig');
    expect(classifyTags({ 'seamark:type': 'production_area', 'seamark:production_area:category': 'wind_farm' })?.category).toBe('wind_farm');
    expect(classifyTags({ 'seamark:type': 'production_area', 'seamark:landmark:production_area': 'wind_farm' })?.category).toBe('wind_farm');
    expect(classifyTags({ 'seamark:type': 'production_area', 'seamark:production_area:category': 'oil' })).toBeNull();
    expect(classifyTags({ 'seamark:type': 'landmark', 'seamark:landmark:category': 'windmotor' })?.category).toBe('wind_turbine');
    // A lit turbine keeps its turbine class, not the generic light class.
    expect(classifyTags({ power: 'generator', 'generator:source': 'wind', 'seamark:light:character': 'Fl' })?.category).toBe('wind_turbine');
  });

  it('keeps separate observations of one aid while combining their sector attributes', () => {
    const sparse = normalizeElement({ type: 'node', id: 100, lat: 50, lon: -1, tags: {
      'seamark:type': 'light_minor', 'seamark:name': 'Test light',
      'seamark:light:1:character': 'Fl', 'seamark:light:1:sector_start': '340',
    } }) as Navaid;
    const detail = normalizeElement({ type: 'node', id: 101, lat: 50, lon: -1, tags: {
      'seamark:type': 'light_minor', 'seamark:name': 'Test light',
      'seamark:light:1:colour': 'red', 'seamark:light:1:sector_end': '020',
      'seamark:light:2:colour': 'white', 'seamark:light:2:sector_start': '020', 'seamark:light:2:sector_end': '090',
    } }) as Navaid;
    const result = dedupeNavaids([sparse, detail]);
    expect(result.navaids).toHaveLength(1);
    expect(result.navaids[0].lightSectors).toEqual([
      { sector: 1, character: 'Fl', start: '340', colour: 'red', end: '020' },
      { sector: 2, colour: 'white', start: '020', end: '090' },
    ]);
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
    expect(navaid.fogSignal).toBe(false);
    expect(navaid.radarReflector).toBe(false);
  });

  it('keeps mapped sound-signal, racon and reflector attributes apart from the light', () => {
    const navaid = normalizeElement({
      type: 'node',
      id: 43,
      lat: 50.7,
      lon: -1.3,
      tags: {
        'seamark:type': 'buoy_lateral',
        'seamark:buoy_lateral:category': 'starboard',
        'seamark:fog_signal:category': 'bell',
        'seamark:fog_signal:group': '2',
        'seamark:fog_signal:period': '30',
        'seamark:radar_transponder:category': 'racon',
        'seamark:radar_transponder:period': '60',
        'seamark:radar_reflector': 'yes',
      },
    }) as Navaid;

    expect(navaid.fogSignal).toBe(true);
    expect(navaid.fogSignalCategory).toBe('bell');
    expect(navaid.fogSignalGroup).toBe('2');
    expect(navaid.fogSignalPeriod).toBe('30');
    expect(navaid.radarTransponderCategory).toBe('racon');
    expect(navaid.radarTransponderPeriod).toBe('60');
    expect(navaid.radarReflector).toBe(true);
    // These are separate charted facts: no light is invented from them.
    expect(navaid.light).toBeNull();
    expect(navaid.lit).toBe(false);
  });

  it('keeps a sound signal or racon when dedupe prefers a record without them', () => {
    const plain = normalizeElement({
      type: 'node',
      id: 44,
      lat: 50.7,
      lon: -1.3,
      tags: {
        name: 'Bell Buoy',
        'seamark:type': 'buoy_lateral',
        'seamark:buoy_lateral:category': 'starboard',
        'seamark:buoy_lateral:colour': 'green',
      },
    }) as Navaid;
    const signalled = normalizeElement({
      type: 'node',
      id: 45,
      lat: 50.7001,
      lon: -1.3001,
      tags: {
        'seamark:type': 'buoy_lateral',
        'seamark:buoy_lateral:category': 'starboard',
        'seamark:fog_signal:category': 'horn',
        'seamark:radar_transponder:category': 'racon',
      },
    }) as Navaid;

    const { navaids } = dedupeNavaids([plain, signalled], { distanceM: 40 });
    expect(navaids).toHaveLength(1);
    expect(navaids[0].fogSignal).toBe(true);
    expect(navaids[0].fogSignalCategory).toBe('horn');
    expect(navaids[0].radarTransponderCategory).toBe('racon');
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

  it('parses separate numbered sectors, with sector-specific range and directional data', () => {
    const light = normalizeElement({
      type: 'node', id: 29, lat: 50.7, lon: -1.3,
      tags: {
        'seamark:type': 'light_major',
        'seamark:light:1:character': 'Fl',
        'seamark:light:1:colour': 'green',
        'seamark:light:1:sector_start': '230',
        'seamark:light:1:sector_end': '260',
        'seamark:light:1:range': '12',
        'seamark:light:2:character': 'Fl',
        'seamark:light:2:colour': 'white',
        'seamark:light:2:sector_start': '260',
        'seamark:light:2:sector_end': '280',
        'seamark:light:2:range': '8.5',
        'seamark:light:2:visibility': '8',
        'seamark:light:2:orientation': '270',
      },
    }) as Navaid;
    expect(light.lightSectors).toEqual([
      { sector: 1, character: 'Fl', colour: 'green', start: '230', end: '260', range: '12' },
      { sector: 2, character: 'Fl', colour: 'white', start: '260', end: '280', range: '8.5', visibility: '8', orientation: '270' },
    ]);
    expect(light.lit).toBe(true);
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

describe('cross-source merge', () => {
  it('merges an official light onto the OSM position for the same named aid', () => {
    const osm = mark({ id: 'osm:node/1', category: 'light', lat: 50.7, lon: -1.2, name: 'Harbour Light', light: null, source: 'osm' });
    const official = mark({ id: 'uscg:1', category: 'light', lat: 50.7005, lon: -1.2, name: 'Harbour Light', light: 'Fl W 6s', lightCharacter: 'Fl', source: 'uscg' });
    const { navaids, removed } = mergeNavaidSources([osm, official]) as { navaids: Navaid[]; removed: number };
    expect(removed).toBe(1);
    expect(navaids).toHaveLength(1);
    expect(navaids[0].id).toBe('osm:node/1');
    expect(navaids[0].lat).toBe(50.7);
    expect(navaids[0].light).toBe('Fl W 6s');
    expect(navaids[0].sources).toEqual(['osm', 'uscg']);
  });

  it('merges same-family aids within 200 m on an equal light, names aside', () => {
    const osm = mark({ category: 'lateral_port', lat: 50.7, name: 'A', light: 'Fl R 4s' });
    const official = mark({ category: 'lateral_port', lat: 50.701, name: 'B', light: 'Fl R 4s', source: 'uscg' });
    const { navaids } = mergeNavaidSources([osm, official]) as { navaids: Navaid[]; removed: number };
    expect(navaids).toHaveLength(1);
  });

  it('does not merge across families on position alone', () => {
    const buoy = mark({ category: 'lateral_port', lat: 50.7, name: 'A' });
    const beacon = mark({ category: 'cardinal_north', lat: 50.7005, name: 'B' });
    const { navaids, removed } = mergeNavaidSources([buoy, beacon]) as { navaids: Navaid[]; removed: number };
    expect(removed).toBe(0);
    expect(navaids).toHaveLength(2);
  });

  it('does not merge same-named aids with different light characters', () => {
    const first = mark({ category: 'light', lat: 50.7, name: 'Pier Light', light: 'Fl R 4s' });
    const second = mark({ category: 'light', lat: 50.7009, name: 'Pier Light', light: 'Fl G 4s', source: 'uscg' });
    const { navaids, removed } = mergeNavaidSources([first, second]) as { navaids: Navaid[]; removed: number };
    expect(removed).toBe(0);
    expect(navaids).toHaveLength(2);
  });

  it('fills an unlit OSM aid with the official light and marks it lit', () => {
    const osm = mark({ category: 'light', lat: 50.7, name: 'Pierhead', light: null, lit: false });
    const official = mark({ category: 'light', lat: 50.7005, name: 'Pierhead', light: 'F W', source: 'uscg' });
    const { navaids } = mergeNavaidSources([osm, official]) as { navaids: Navaid[]; removed: number };
    expect(navaids).toHaveLength(1);
    expect(navaids[0].light).toBe('F W');
    expect(navaids[0].lit).toBe(true);
  });

  it('keeps an unmatched official aid instead of dropping it', () => {
    const osm = mark({ category: 'light', lat: 50.7, name: 'A' });
    const official = mark({ id: 'uscg:far', category: 'light', lat: 51.0, name: 'Far Light', light: 'Fl W 6s', source: 'uscg' });
    const { navaids } = mergeNavaidSources([osm, official]) as { navaids: Navaid[]; removed: number };
    expect(navaids).toHaveLength(2);
    expect(navaids.some((n) => n.id === 'uscg:far')).toBe(true);
  });

  it('merges wrecks only on the same name', () => {
    const first = mark({ id: 'osm:node/1', category: 'wreck', lat: 50.7, name: 'Mary' });
    const second = mark({ id: 'uscg:2', category: 'wreck', lat: 50.7009, name: 'Mary', source: 'uscg' });
    const other = mark({ id: 'osm:node/3', category: 'wreck', lat: 50.7018, name: 'John' });
    const { navaids } = mergeNavaidSources([first, second, other]) as { navaids: Navaid[]; removed: number };
    expect(navaids).toHaveLength(2);
    expect(navaids.some((n) => n.id === 'osm:node/1')).toBe(true);
    expect(navaids.some((n) => n.id === 'osm:node/3')).toBe(true);
  });

  it('merges same-named farms with overlapping areas even when centres are far apart', () => {
    const first = mark({ category: 'wind_farm', lat: 50.71, lon: -1.2, name: 'Rampion', path: [[50.70, -1.22], [50.72, -1.22], [50.72, -1.18], [50.70, -1.18]] });
    const second = mark({ category: 'wind_farm', lat: 50.72, lon: -1.2, name: 'Rampion', source: 'uscg', path: [[50.71, -1.22], [50.73, -1.22], [50.73, -1.18], [50.71, -1.18]] });
    const { navaids } = mergeNavaidSources([first, second]) as { navaids: Navaid[]; removed: number };
    expect(navaids).toHaveLength(1);
  });

  it('keeps differently named farms with overlapping areas', () => {
    const first = mark({ category: 'wind_farm', lat: 50.71, lon: -1.2, name: 'Rampion', path: [[50.70, -1.22], [50.72, -1.22], [50.72, -1.18], [50.70, -1.18]] });
    const second = mark({ category: 'wind_farm', lat: 50.72, lon: -1.2, name: 'Other Farm', path: [[50.71, -1.22], [50.73, -1.22], [50.73, -1.18], [50.71, -1.18]] });
    const { navaids, removed } = mergeNavaidSources([first, second]) as { navaids: Navaid[]; removed: number };
    expect(removed).toBe(0);
    expect(navaids).toHaveLength(2);
  });

  it('applies light-field authority per field, not per record', () => {
    const osm = mark({ category: 'light', lat: 50.7, name: 'Harbour Light', light: null, lightColour: 'red' });
    const official = mark({ category: 'light', lat: 50.7005, name: 'Harbour Light', light: 'Fl W 6s', source: 'uscg' });
    const { navaids } = mergeNavaidSources([osm, official]) as { navaids: Navaid[]; removed: number };
    expect(navaids).toHaveLength(1);
    expect(navaids[0].light).toBe('Fl W 6s');
    expect(navaids[0].lightColour).toBe('red');
    const osm2 = mark({ category: 'light', lat: 50.7, name: 'Harbour Light', light: null, lightColour: 'red' });
    const official2 = mark({ category: 'light', lat: 50.7005, name: 'Harbour Light', light: 'Fl W 6s', lightColour: 'white', source: 'uscg' });
    const merged2 = mergeNavaidSources([osm2, official2]).navaids as Navaid[];
    expect(merged2[0].lightColour).toBe('white');
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

describe('visible marks', () => {
  const bounds: [number, number, number, number] = [50.5, -1.8, 51.0, -0.7];

  it('shows every in-view mark regardless of zoom — the legend alone governs classes', () => {
    const light = mark({ category: 'major_light', lat: 50.8, lon: -1.2 });
    const mooring = mark({ category: 'mooring', lat: 50.81, lon: -1.21 });
    const zoomedOut = selectVisibleNavaids([light, mooring], { zoom: 10, bounds }) as Navaid[];
    expect(zoomedOut).toHaveLength(2);
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
    const visible = selectVisibleNavaids([inside, outside, area], { zoom: 14, bounds }) as Navaid[];
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
      limit: 10,
    }) as Navaid[];
    expect(visible).toHaveLength(10);
    expect(visible.every((entry) => entry.category === 'major_light')).toBe(true);
  });
});
