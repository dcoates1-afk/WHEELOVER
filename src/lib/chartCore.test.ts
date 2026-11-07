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
  resolveNavaidCategory,
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
    lightSectors: overrides.lightSectors ?? undefined,
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

  it('draws a charted north-east sector south-west: east-west mirror plus north-south flip', () => {
    // Fiddle Reef red sector, charted 16.5–55.5 (north-east). The bearings
    // mirror east-to-west (304.5–343.5) and the latitude flips
    // north-to-south, so the drawn sector lands at 196.5–235.5
    // (south-west), every point south of the light. This is the old
    // code's transform, restored from Doug's copy.
    const lat = 48.4293333;
    const lon = -123.2839167;
    const mirrored = mirrorLightSectorBearings(16.5, 55.5);
    expect(mirrored?.[0]).toBeCloseTo(304.5, 3);
    expect(mirrored?.[1]).toBeCloseTo(343.5, 3);
    const arc = lightSectorArc(lat, lon, mirrored![0], mirrored![1], 7 * 1852);
    expect(arc.length).toBeGreaterThan(2);
    const drawnStart = 196.5;
    const span = 39;
    for (const [pointLat, pointLon] of arc) {
      const bearing = bearingDegrees(lat, lon, pointLat, pointLon);
      const offset = (((bearing - drawnStart) % 360) + 360) % 360;
      // A point a hair before the start bearing (a floating-point
      // round-trip through the arc maths) reads as an offset near 360.
      expect(offset <= span + 1 || offset >= 359).toBe(true);
      expect(pointLat).toBeLessThan(lat);
    }
  });

  it('draws each sector 180° from its charted bearings — Fiddle Reef red/white pattern', () => {
    // OSM node 1666136773 / CCG pac 215: six Q sectors, red and white
    // alternating. The old code mirrors the bearings east-to-west and
    // flips the latitude north-to-south, so each drawn sector sits 180°
    // from its charted bearings.
    const lat = 48.4293333;
    const lon = -123.2839167;
    const sectors = [
      { start: 16.5, end: 55.5 },
      { start: 55.5, end: 111 },
      { start: 111, end: 138 },
      { start: 138, end: 171 },
      { start: 171, end: 216 },
      { start: 216, end: 16.5 },
    ];
    for (const { start, end } of sectors) {
      const mirrored = mirrorLightSectorBearings(start, end)!;
      const arc = lightSectorArc(lat, lon, mirrored[0], mirrored[1], 7 * 1852);
      expect(arc.length).toBeGreaterThan(2);
      const drawnStart = (start + 180) % 360;
      const span = (end - start + 360) % 360;
      for (const [pointLat, pointLon] of arc) {
        const bearing = bearingDegrees(lat, lon, pointLat, pointLon);
        const offset = (((bearing - drawnStart) % 360) + 360) % 360;
        // A point a hair before the start bearing (a floating-point
        // round-trip through the arc maths) reads as an offset near 360.
        expect(offset <= span + 1 || offset >= 359).toBe(true);
      }
    }
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
    expect(unlit?.category).toBe('pile_unlit');
    expect(unlit?.lit).toBe(false);
    const lit = classifyTags({
      'seamark:type': 'pile',
      'seamark:light:character': 'F',
      'seamark:light:colour': 'W',
    });
    expect(lit?.category).toBe('pile_lit');
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
    expect(mark?.category).toBe('pile_unlit');
    expect(mark?.lat).toBe(45.5838);
  });
});

describe('sector light category', () => {
  const sectorTags = {
    'seamark:light:1:sector_start': '016.5',
    'seamark:light:1:sector_end': '055.5',
    'seamark:light:1:colour': 'red',
    'seamark:light:2:sector_start': '055.5',
    'seamark:light:2:sector_end': '111',
    'seamark:light:2:colour': 'white',
  };

  it('charts a light with charted sectors as a sector light, not a minor light', () => {
    const result = classifyTags({
      'seamark:type': 'light_minor',
      'seamark:light:character': 'Q',
      ...sectorTags,
    });
    expect(result?.category).toBe('sector_light');
    expect(result?.lit).toBe(true);
  });

  it('charts a landmark with charted sectors as a sector light — the Fiddle Reef shape', () => {
    // OSM node 1666136773: seamark:type=landmark, a tower with a Q light
    // and six sectors. It used to come out major_light; the sectors are
    // what make it a sector light.
    const result = classifyTags({
      'seamark:type': 'landmark',
      'seamark:light:character': 'Q',
      ...sectorTags,
    });
    expect(result?.category).toBe('sector_light');
  });

  it('charts a major light with charted sectors as a sector light', () => {
    const result = classifyTags({
      'seamark:type': 'light_major',
      'seamark:light:character': 'Fl',
      ...sectorTags,
    });
    expect(result?.category).toBe('sector_light');
  });

  it('keeps a lighthouse a lighthouse even when it carries sectors', () => {
    const result = classifyTags({
      'seamark:type': 'lighthouse',
      'man_made': 'lighthouse',
      'seamark:light:character': 'Fl',
      ...sectorTags,
    });
    expect(result?.category).toBe('lighthouse');
  });

  it('keeps a leading light its transit role even when it carries sectors', () => {
    const result = classifyTags({
      'seamark:type': 'light_minor',
      'seamark:light:category': 'leading;front',
      'seamark:light:character': 'Iso',
      ...sectorTags,
    });
    expect(result?.category).toBe('transit_front');
  });

  it('leaves a light without sectors a minor light and a major light without sectors a major light', () => {
    expect(classifyTags({
      'seamark:type': 'light_minor',
      'seamark:light:character': 'Fl',
    })?.category).toBe('light');
    expect(classifyTags({
      'seamark:type': 'light_major',
      'seamark:light:character': 'Fl',
    })?.category).toBe('major_light');
  });

  it('ranks a sector light like a sector beacon but shows it from zoom 7, like a major light', () => {
    // The category stays sector_light (not major_light), but the zoom is
    // extended to 7 so the lights that used to be major lights — Needles,
    // Fisgard, Long Beach — show from the zoom they had before.
    expect(minZoomFor('sector_light')).toBe(7);
    expect(minZoomFor('pile_lit')).toBe(13);
    expect(minZoomFor('pile_unlit')).toBe(13);
  });
});

describe('sector light and pile resolution', () => {
  const sectors = [
    { sector: 1, start: '016.5', end: '055.5', colour: 'red' },
    { sector: 2, start: '055.5', end: '111', colour: 'white' },
  ];

  it('resolves a legacy sector beacon with sectors to a sector light', () => {
    expect(resolveNavaidCategory(mark({
      category: 'sector_beacon',
      lightSectors: sectors,
    }))).toBe('sector_light');
  });

  it('resolves a legacy major light with sectors to a sector light', () => {
    // The built Solent/NY Harbor database still holds major_light
    // records with sectors; they are sector lights under the new rule.
    expect(resolveNavaidCategory(mark({
      category: 'major_light',
      lightSectors: sectors,
    }))).toBe('sector_light');
  });

  it('leaves a sector beacon without sectors a sector beacon', () => {
    // Official records named "sector" carry no sector bearings; they
    // stay sector beacons — the category is the fallback for a named
    // sector light with no mapped pattern.
    expect(resolveNavaidCategory(mark({ category: 'sector_beacon' }))).toBe('sector_beacon');
  });

  it('leaves a lighthouse with sectors a lighthouse', () => {
    expect(resolveNavaidCategory(mark({
      category: 'lighthouse',
      lightSectors: sectors,
    }))).toBe('lighthouse');
  });

  it('splits a legacy plain pile by whether it carries a light', () => {
    // The shipped NOAA ENC shards still hold 40,832 piles as plain
    // `pile`; only 51 carry light fields.
    expect(resolveNavaidCategory(mark({ category: 'pile' }))).toBe('pile_unlit');
    expect(resolveNavaidCategory(mark({
      category: 'pile',
      lit: true,
      light: 'F',
      lightCharacter: 'F',
    }))).toBe('pile_lit');
  });

  it('merges Fiddle Reef into a sector light from both paths', () => {
    // OSM major_light with six sectors + CCG sector_beacon with none:
    // the merged aid has the sectors, so it is a sector light.
    const merged = mergeNavaidSources([
      mark({
        id: 'osm:1666136773',
        lat: 48.4293333,
        lon: -123.2839167,
        category: 'major_light',
        name: 'Fiddle Reef',
        light: 'Q',
        lightCharacter: 'Q',
        lightSectors: sectors,
        source: 'osm',
      }),
      mark({
        id: 'ccg:pac:215',
        lat: 48.4293333,
        lon: -123.2839167,
        category: 'sector_beacon',
        name: 'Fiddle Reef',
        source: 'ccg',
      }),
    ]).navaids;
    expect(merged).toHaveLength(1);
    expect(merged[0].category).toBe('sector_light');
    expect(merged[0].lightSectors).toHaveLength(2);
  });

  it('merges a lit and an unlit pile into a lighted pile', () => {
    const merged = mergeNavaidSources([
      mark({
        id: 'osm:pile-1',
        lat: 48.42,
        lon: -123.28,
        category: 'pile_unlit',
        name: 'Pile 12',
        source: 'osm',
      }),
      mark({
        id: 'ccg:pile-1',
        lat: 48.42,
        lon: -123.28,
        category: 'pile_lit',
        name: 'Pile 12',
        light: 'F',
        lightCharacter: 'F',
        lit: true,
        source: 'ccg',
      }),
    ]).navaids;
    expect(merged).toHaveLength(1);
    expect(merged[0].category).toBe('pile_lit');
  });

  it('resolves legacy records passing through dedupe alone', () => {
    const deduped = dedupeNavaids([
      mark({
        id: 'noaa-enc:Light:9',
        lat: 58.2,
        lon: -151.8,
        category: 'sector_beacon',
        lightSectors: sectors,
        source: 'noaa-enc',
      }),
      mark({
        id: 'noaa-enc:Pile:430313',
        lat: -14.27,
        lon: -170.69,
        category: 'pile',
        source: 'noaa-enc',
      }),
    ]).navaids;
    expect(deduped.map((entry) => entry.category).sort()).toEqual(['pile_unlit', 'sector_light']);
  });
});

describe('special-beacon daymarks', () => {
  it('normalizes daymark shape and colour from daymark tags', () => {
    const mark = normalizeElement({
      type: 'node',
      id: 9502861273,
      lat: 48.4243520,
      lon: -123.2943196,
      tags: {
        'seamark:type': 'beacon_special_purpose',
        'seamark:daymark:colour': 'green',
        'seamark:daymark:colour_pattern': 'border',
        'seamark:daymark:shape': 'square',
      },
    });
    expect(mark?.category).toBe('special_purpose');
    expect(mark?.form).toBe('beacon');
    expect(mark?.daymarkShape).toBe('square');
    expect(mark?.daymarkColour).toBe('green');
  });
});

describe('cable_overhead marks', () => {
  it('charts a cable as its own mark, unlit', () => {
    const cable = classifyTags({
      'seamark:type': 'cable_overhead',
      power: 'line',
      'seamark:cable_overhead:clearance_height_safe': '41.3',
    });
    expect(cable?.category).toBe('cable_overhead');
    expect(cable?.lit).toBe(false);
  });

  it('normalizes a cable way with its line path and raw clearance', () => {
    const mark = normalizeElement({
      type: 'way',
      id: 54051843,
      tags: {
        cables: '3',
        name: 'North Bonneville-Troutdale No 1',
        power: 'line',
        'seamark:cable_overhead:category': 'power',
        'seamark:cable_overhead:clearance_height_safe': '90 ft',
        'seamark:type': 'cable_overhead',
      },
      geometry: [
        { lat: 45.5713513, lon: -122.4098391 },
        { lat: 45.5743443, lon: -122.4069829 },
        { lat: 45.5773573, lon: -122.404126 },
      ],
    });
    expect(mark?.category).toBe('cable_overhead');
    expect(mark?.path?.length).toBeGreaterThanOrEqual(2);
    expect(mark?.clearanceHeight).toBe('90 ft');
  });

  it('never merges two same-named cable lines', () => {
    const first = mark({
      category: 'cable_overhead',
      name: 'North Bonneville-Troutdale No 1',
      lat: 45.5713,
      lon: -122.4098,
      path: [[45.5713, -122.4098], [45.5743, -122.407]],
    });
    const second = mark({
      category: 'cable_overhead',
      name: 'North Bonneville-Troutdale No 1',
      lat: 45.5718,
      lon: -122.4098,
      path: [[45.5718, -122.4098], [45.5748, -122.407]],
    });
    const { navaids, removed } = mergeNavaidSources([first, second]) as { navaids: Navaid[]; removed: number };
    expect(removed).toBe(0);
    expect(navaids).toHaveLength(2);
  });

  it('never dedupes a cable line against a nearby point', () => {
    const cable = mark({
      category: 'cable_overhead',
      lat: 50.7,
      lon: -1.2,
      path: [[50.7, -1.2], [50.701, -1.2]],
    });
    const pylon = mark({ category: 'pylon', lat: 50.70007, lon: -1.2 });
    const { navaids, removed } = dedupeNavaids([cable, pylon]) as { navaids: Navaid[]; removed: number };
    expect(removed).toBe(0);
    expect(navaids).toHaveLength(2);
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

  it('ranks a landmark carrying a numbered sector light as a lighthouse', () => {
    // Hurst Point is charted as a landmark whose lights are all numbered sector
    // records, so it has no unnumbered light character to be recognised by —
    // but it stands on a lighthouse structure, so it draws as the tower.
    const hurst = classifyTags({
      'seamark:type': 'landmark',
      'man_made': 'lighthouse',
      'seamark:light:1:character': 'Fl',
      'seamark:light:1:colour': 'white',
      'seamark:light:1:sector_start': '080',
      'seamark:light:1:sector_end': '104',
    });
    expect(hurst?.category).toBe('lighthouse');
    expect(minZoomFor(hurst!.category)).toBeLessThan(13);
    // An unlit landmark keeps its landmark rank.
    expect(classifyTags({ 'seamark:type': 'landmark' })?.category).toBe('landmark');
  });

  it('ranks typed lighthouses and lighthouse structures as lighthouses', () => {
    expect(classifyTags({ 'seamark:type': 'lighthouse' })?.category).toBe('lighthouse');
    expect(classifyTags({ 'man_made': 'lighthouse' })?.category).toBe('lighthouse');
    expect(classifyTags({ 'seamark:type': 'lighthouse' })?.priority).toBe(98);
  });

  it('ranks a light carrying mapped sectors as a sector light', () => {
    const sector = classifyTags({
      'seamark:type': 'light_minor',
      'seamark:light:1:character': 'Fl',
      'seamark:light:1:colour': 'white',
      'seamark:light:1:sector_start': '080',
      'seamark:light:1:sector_end': '104',
    });
    expect(sector?.category).toBe('sector_light');
    // The same light without sectors stays a minor light, and a major
    // light with sectors is a sector light too — the sector pattern is
    // what the filter and legend sort on.
    expect(classifyTags({ 'seamark:type': 'light_minor', 'seamark:light:character': 'Fl' })?.category).toBe('light');
    expect(classifyTags({
      'seamark:type': 'light_major',
      'seamark:light:1:character': 'Fl',
      'seamark:light:1:sector_start': '080',
      'seamark:light:1:sector_end': '104',
    })?.category).toBe('sector_light');
    // A lit mast or tower that is not a lighthouse stays a major light.
    expect(classifyTags({ 'seamark:type': 'mast', 'seamark:light:character': 'Fl' })?.category).toBe('major_light');
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
    // An artificial island platform is a visible structure, not a rig:
    // Little Island in New York Harbor is a pier and a park.
    expect(classifyTags({ 'seamark:type': 'platform', 'seamark:platform:category': 'artificial_island' })?.category).toBe('landmark');
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
  it('keeps the lighthouse class when a lighthouse collapses with a plain light', () => {
    // The plain light is the richer record, so it would be the base — the
    // lighthouse class still has to win, because the aid IS the lighthouse.
    const light = mark({ category: 'light', name: 'Cockspur Light', lat: 50.66, lon: -1.58, light: 'Fl W 6s', height: '24' });
    const house = mark({ category: 'lighthouse', name: 'Cockspur Light', lat: 50.6601, lon: -1.5801 });
    const { navaids, removed } = dedupeNavaids([light, house]) as { navaids: Navaid[]; removed: number };
    expect(removed).toBe(1);
    expect(navaids).toHaveLength(1);
    expect(navaids[0].category).toBe('lighthouse');
    expect(navaids[0].light).toBe('Fl W 6s');
    // The priority follows the promoted class: the base light's 50 would
    // draw the lighthouse tower at a plain light's zoom.
    expect(navaids[0].priority).toBe(98);
  });

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
  it('keeps the lighthouse class when an official lighthouse merges with an OSM light', () => {
    const osm = mark({ id: 'osm:node/1', category: 'light', lat: 50.7, lon: -1.2, name: 'Cockspur Light', light: null, source: 'osm' });
    const official = mark({ id: 'uscg:1', category: 'lighthouse', lat: 50.7005, lon: -1.2, name: 'Cockspur Light', light: 'Fl W 6s', lightCharacter: 'Fl', source: 'uscg' });
    const { navaids } = mergeNavaidSources([osm, official]) as { navaids: Navaid[]; removed: number };
    expect(navaids).toHaveLength(1);
    expect(navaids[0].id).toBe('osm:node/1');
    expect(navaids[0].category).toBe('lighthouse');
    expect(navaids[0].light).toBe('Fl W 6s');
    expect(navaids[0].priority).toBe(98);
  });

  it('keeps the sector class when an official sector light merges with an OSM light', () => {
    const osm = mark({ id: 'osm:node/1', category: 'light', lat: 50.7, lon: -1.2, name: 'Pickle Sector Light', light: null, source: 'osm' });
    const official = mark({ id: 'ccg:1', category: 'sector_beacon', lat: 50.7005, lon: -1.2, name: 'Pickle Sector Light', light: 'F R W G', source: 'ccg' });
    const { navaids } = mergeNavaidSources([osm, official]) as { navaids: Navaid[]; removed: number };
    expect(navaids).toHaveLength(1);
    expect(navaids[0].category).toBe('sector_beacon');
    expect(navaids[0].priority).toBe(62);
  });

  it('merges an NOAA ENC sector light onto its OSM twin, keeping the ENC sectors', () => {
    const osm = mark({ id: 'osm:node/1', category: 'light', lat: 58.0, lon: -152.0, name: 'Entrance Light', light: null, source: 'osm' });
    const enc = mark({
      id: 'noaa-enc:Light:1', category: 'sector_beacon', lat: 58.0005, lon: -152.0, name: 'Entrance Light',
      light: 'Q R 1s', lightCharacter: 'Q', lightColour: 'red', source: 'noaa-enc',
      lightSectors: [{ sector: 1, character: 'Q', colour: 'red', start: '338', end: '346' }],
    });
    const { navaids } = mergeNavaidSources([osm, enc]) as { navaids: Navaid[]; removed: number };
    expect(navaids).toHaveLength(1);
    expect(navaids[0].id).toBe('osm:node/1');
    expect(navaids[0].category).toBe('sector_light');
    expect(navaids[0].lightSectors).toHaveLength(1);
    expect(navaids[0].lightSectors?.[0].start).toBe('338');
    expect(navaids[0].sources).toEqual(['osm', 'noaa-enc']);
  });

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

  it('merges same-family aids across sources within 50 m on an equal light, names aside', () => {
    const osm = mark({ category: 'lateral_port', lat: 50.7, name: 'A', light: 'Fl R 4s' });
    const official = mark({ category: 'lateral_port', lat: 50.7004, name: 'B', light: 'Fl R 4s', source: 'uscg' });
    const { navaids } = mergeNavaidSources([osm, official]) as { navaids: Navaid[]; removed: number };
    expect(navaids).toHaveLength(1);
  });

  it('does not merge same-family aids across sources beyond 50 m on an equal light', () => {
    const osm = mark({ category: 'lateral_port', lat: 50.7, name: 'A', light: 'Fl R 4s' });
    const official = mark({ category: 'lateral_port', lat: 50.701, name: 'B', light: 'Fl R 4s', source: 'uscg' });
    const { navaids } = mergeNavaidSources([osm, official]) as { navaids: Navaid[]; removed: number };
    expect(navaids).toHaveLength(2);
  });

  it('does not merge same-family aids from one source on an equal light', () => {
    const first = mark({ category: 'lateral_port', lat: 50.7, name: 'A', light: 'Fl R 4s' });
    const second = mark({ category: 'lateral_port', lat: 50.7013, name: 'B', light: 'Fl R 4s' });
    const { navaids } = mergeNavaidSources([first, second]) as { navaids: Navaid[]; removed: number };
    expect(navaids).toHaveLength(2);
  });

  it('joins the nearest matching group, not the first encountered', () => {
    const far = mark({ id: 'osm:node/1', category: 'special_purpose', lat: 50.7013, lon: -1.2, name: 'Buoy 1', light: 'Fl Y 4s' });
    const near = mark({ id: 'osm:node/2', category: 'special_purpose', lat: 50.7, lon: -1.2, name: 'Buoy 1', light: 'Fl Y 4s' });
    const official = mark({ id: 'ccg:1', category: 'light', lat: 50.70019, lon: -1.2, name: 'Buoy 1', light: 'Fl Y 4s', source: 'ccg' });
    const { navaids } = mergeNavaidSources([far, near, official]) as { navaids: Navaid[]; removed: number };
    expect(navaids).toHaveLength(2);
    const joined = navaids.find((n) => n.lat === 50.7);
    expect(joined?.sources).toEqual(['osm', 'ccg']);
    expect(navaids.some((n) => n.lat === 50.7013)).toBe(true);
  });

  it('merges the same designator with the same light across a wide position gap', () => {
    const osm = mark({ category: 'special_purpose', lat: 50.7, lon: -1.2, name: 'Victoria Harbor Buoy VH.', light: 'Fl yellow 4s', lightCharacter: 'Fl', lightColour: 'yellow' });
    const official = mark({ category: 'light', lat: 50.7009, lon: -1.2, name: 'Victoria Harbour Cautionary light buoy VH', light: 'Fl Y 4s', lightCharacter: 'Fl', lightColour: 'Y', source: 'ccg' });
    const { navaids } = mergeNavaidSources([osm, official]) as { navaids: Navaid[]; removed: number };
    expect(navaids).toHaveLength(1);
    expect(navaids[0].category).toBe('special_purpose');
    expect(navaids[0].light).toBe('Fl Y 4s');
    expect(navaids[0].sources).toEqual(['osm', 'ccg']);
  });

  it('does not merge different designators on the same light beyond the signature radius', () => {
    // Same signature within 150 m DOES merge regardless of designator
    // (see the signature tests below), so this pair sits at 200 m: beyond
    // the radius, different designators stay separate.
    const osm = mark({ category: 'special_purpose', lat: 50.7, lon: -1.2, name: 'Buoy 1', light: 'Fl Y 4s' });
    const official = mark({ category: 'light', lat: 50.7018, lon: -1.2, name: 'Buoy 2', light: 'Fl Y 4s', source: 'ccg' });
    const { navaids } = mergeNavaidSources([osm, official]) as { navaids: Navaid[]; removed: number };
    expect(navaids).toHaveLength(2);
  });

  it('does not treat an ordinary last word as a designator beyond the signature radius', () => {
    // As above: within 150 m the signature rule merges these anyway, so
    // the pair sits at 200 m to guard the designator rule itself.
    const osm = mark({ category: 'special_purpose', lat: 50.7, lon: -1.2, name: 'North Light', light: 'Fl Y 4s' });
    const official = mark({ category: 'light', lat: 50.7018, lon: -1.2, name: 'South Light', light: 'Fl Y 4s', source: 'ccg' });
    const { navaids } = mergeNavaidSources([osm, official]) as { navaids: Navaid[]; removed: number };
    expect(navaids).toHaveLength(2);
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

describe('minor light attach', () => {
  it('merges a minor light onto a nearby aid even when names differ', () => {
    const buoy = mark({ category: 'lateral_port', name: 'Harbour Buoy', lat: 50.7, lon: -1.2 });
    const light = mark({ category: 'light', name: 'Harbour Light', light: 'Fl G 4s', lightCharacter: 'Fl', lightColour: 'green', lat: 50.70027, lon: -1.2, source: 'uscg' });
    const { navaids, removed } = mergeNavaidSources([buoy, light]) as { navaids: Navaid[]; removed: number };
    expect(removed).toBe(1);
    expect(navaids).toHaveLength(1);
    expect(navaids[0].category).toBe('lateral_port');
    expect(navaids[0].light).toBe('Fl G 4s');
    expect(navaids[0].sources).toEqual(['osm', 'uscg']);
  });

  it('does not attach a light with a conflicting character', () => {
    const buoy = mark({ category: 'lateral_port', name: 'Harbour Buoy', light: 'Fl R 4s', lat: 50.7, lon: -1.2 });
    const light = mark({ category: 'light', name: 'Harbour Light', light: 'Fl G 4s', lat: 50.70007, lon: -1.2, source: 'uscg' });
    const { navaids } = mergeNavaidSources([buoy, light]) as { navaids: Navaid[]; removed: number };
    expect(navaids).toHaveLength(2);
  });

  it('does not attach a light beyond 50 m', () => {
    const buoy = mark({ category: 'lateral_port', name: 'Harbour Buoy', lat: 50.7, lon: -1.2 });
    const light = mark({ category: 'light', name: 'Harbour Light', light: 'Fl G 4s', lat: 50.701, lon: -1.2, source: 'uscg' });
    const { navaids } = mergeNavaidSources([buoy, light]) as { navaids: Navaid[]; removed: number };
    expect(navaids).toHaveLength(2);
  });

  it('keeps the aid as the base when the light record arrives first', () => {
    const light = mark({ category: 'light', name: 'Harbour Light', light: 'Fl G 4s', lat: 50.7, lon: -1.2 });
    const buoy = mark({ category: 'lateral_port', name: 'Harbour Buoy', lat: 50.7, lon: -1.2 });
    const { navaids } = mergeNavaidSources([light, buoy]) as { navaids: Navaid[]; removed: number };
    expect(navaids).toHaveLength(1);
    expect(navaids[0].category).toBe('lateral_port');
    expect(navaids[0].light).toBe('Fl G 4s');
  });

  it('dedupe keeps the aid, not the richer minor light, when they collapse', () => {
    const buoy = mark({ category: 'lateral_port', name: 'Harbour Buoy', lat: 50.7, lon: -1.2 });
    const light = mark({ category: 'light', name: 'Harbour Light', light: 'Fl G 4s', lightCharacter: 'Fl', lightColour: 'green', range: '5', description: 'Lighted buoy', lat: 50.70007, lon: -1.2, source: 'uscg', lit: true });
    const { navaids, removed } = dedupeNavaids([buoy, light]) as { navaids: Navaid[]; removed: number };
    expect(removed).toBe(1);
    expect(navaids).toHaveLength(1);
    expect(navaids[0].category).toBe('lateral_port');
    expect(navaids[0].light).toBe('Fl G 4s');
    expect((navaids[0] as Navaid).sources).toEqual(['osm', 'uscg']);
  });

  it('dedupe never overwrites an aid\'s own light with a conflicting one', () => {
    const buoy = mark({ category: 'lateral_port', name: 'Pier', light: 'Fl R 4s', lat: 50.7, lon: -1.2 });
    const light = mark({ category: 'light', name: 'Pier', light: 'Fl G 4s', lat: 50.70007, lon: -1.2, source: 'uscg' });
    const { navaids, removed } = dedupeNavaids([buoy, light]) as { navaids: Navaid[]; removed: number };
    expect(removed).toBe(1);
    expect(navaids).toHaveLength(1);
    expect(navaids[0].category).toBe('lateral_port');
    expect(navaids[0].light).toBe('Fl R 4s');
  });

  it('does not merge a lateral aid with a light of a conflicting colour', () => {
    const buoy = mark({ category: 'lateral_port', colour: 'green', name: 'Harbour Buoy', lat: 50.7, lon: -1.2 });
    const light = mark({ category: 'light', name: 'Harbour Light', light: 'Fl R 4s', lightColour: 'R', lat: 50.70007, lon: -1.2, source: 'ccg' });
    const { navaids } = mergeNavaidSources([buoy, light]) as { navaids: Navaid[]; removed: number };
    expect(navaids).toHaveLength(2);
  });

  it('merges a lateral aid with a light of the same colour, letter or word', () => {
    const buoy = mark({ category: 'lateral_port', colour: 'green', name: 'Harbour Buoy', lat: 50.7, lon: -1.2 });
    const light = mark({ category: 'light', name: 'Harbour Light', light: 'Fl G 4s', lightColour: 'G', lat: 50.70007, lon: -1.2, source: 'ccg' });
    const { navaids } = mergeNavaidSources([buoy, light]) as { navaids: Navaid[]; removed: number };
    expect(navaids).toHaveLength(1);
    expect(navaids[0].category).toBe('lateral_port');
    expect(navaids[0].light).toBe('Fl G 4s');
  });

  it('does not merge same-named aids when the lateral colour disagrees', () => {
    const buoy = mark({ category: 'lateral_port', colour: 'green', name: 'Harbour Light', lat: 50.7, lon: -1.2 });
    const light = mark({ category: 'light', name: 'Harbour Light', light: 'Fl R 4s', lightColour: 'R', lat: 50.70007, lon: -1.2, source: 'ccg' });
    const { navaids } = mergeNavaidSources([buoy, light]) as { navaids: Navaid[]; removed: number };
    expect(navaids).toHaveLength(2);
  });

  it('dedupe does not collapse a lateral aid with a conflicting-colour light', () => {
    const buoy = mark({ category: 'lateral_port', colour: 'green', name: 'Harbour Buoy', lat: 50.7, lon: -1.2 });
    const light = mark({ category: 'light', name: 'Harbour Light', light: 'Fl R 4s', lightColour: 'R', lat: 50.70007, lon: -1.2, source: 'ccg', lit: true });
    const { navaids, removed } = dedupeNavaids([buoy, light]) as { navaids: Navaid[]; removed: number };
    expect(removed).toBe(0);
    expect(navaids).toHaveLength(2);
  });

  it('dedupe keeps the mark, not the richer pile, when they collapse', () => {
    const pile = mark({ category: 'pile', name: 'Pile', height: '5', lat: 50.7, lon: -1.2 });
    const special = mark({ category: 'special_purpose', name: 'Special Buoy', lat: 50.70007, lon: -1.2 });
    const { navaids, removed } = dedupeNavaids([pile, special]) as { navaids: Navaid[]; removed: number };
    expect(removed).toBe(1);
    expect(navaids).toHaveLength(1);
    expect(navaids[0].category).toBe('special_purpose');
  });

  it('dedupe gives the same result whatever order a pair arrives in', () => {
    const buoy = mark({ category: 'lateral_port', name: 'B', lat: 50.7, lon: -1.2 });
    const light = mark({ category: 'light', name: 'L', light: 'Fl G 4s', lat: 50.70007, lon: -1.2, source: 'uscg', lit: true });
    const forward = dedupeNavaids([buoy, light]) as { navaids: Navaid[]; removed: number };
    const reverse = dedupeNavaids([light, buoy]) as { navaids: Navaid[]; removed: number };
    expect(forward.navaids).toHaveLength(1);
    expect(reverse.navaids).toHaveLength(1);
    expect(forward.navaids[0].category).toBe(reverse.navaids[0].category);
    expect(forward.navaids[0].light).toBe(reverse.navaids[0].light);
  });
});

describe('bare light dedupe', () => {
  it('folds the real bare OSM light into the specified red light 33 m away', () => {
    const bare = normalizeElement({
      type: 'node', id: 13088474102, lat: 48.4175756, lon: -123.3881553,
      tags: { note: 'two red lights', 'seamark:type': 'light' },
    });
    const specified = normalizeElement({
      type: 'node', id: 13088474103, lat: 48.4176199, lon: -123.3885979,
      tags: { 'seamark:light:colour': 'red', 'seamark:type': 'light' },
    });
    const { navaids, removed } = dedupeNavaids([bare, specified].filter(Boolean) as Navaid[]) as { navaids: Navaid[]; removed: number };
    expect(removed).toBe(1);
    expect(navaids).toHaveLength(1);
    expect(navaids[0].id).toBe('osm:node/13088474103');
    expect(navaids[0].lat).toBe(48.4176199);
    expect(navaids[0].lightColour).toBe('red');
  });

  it('keeps two fully-tagged lights standing 33 m apart', () => {
    const first = mark({ category: 'light', name: 'Pier Light A', light: 'Fl R 4s', lightCharacter: 'Fl', lightColour: 'red', lat: 50.7, lon: -1.2 });
    const second = mark({ category: 'light', name: 'Pier Light B', light: 'Fl G 4s', lightCharacter: 'Fl', lightColour: 'green', lat: 50.7003, lon: -1.2 });
    const { navaids } = dedupeNavaids([first, second]) as { navaids: Navaid[]; removed: number };
    expect(navaids).toHaveLength(2);
  });

  it('keeps a bare light with no specified neighbour on the chart', () => {
    const bare = mark({ category: 'light', name: null, light: null, lightCharacter: null, lightColour: null, colour: null, lightPeriod: null, lat: 50.7, lon: -1.2 });
    const { navaids } = dedupeNavaids([bare]) as { navaids: Navaid[]; removed: number };
    expect(navaids).toHaveLength(1);
  });

  it('keeps a bare light beyond 50 m from a specified light', () => {
    const bare = mark({ category: 'light', name: null, light: null, lightCharacter: null, lightColour: null, colour: null, lightPeriod: null, lat: 50.7, lon: -1.2 });
    const specified = mark({ category: 'light', name: 'Pier Light', light: 'Fl R 4s', lightCharacter: 'Fl', lightColour: 'red', lat: 50.7006, lon: -1.2 });
    const { navaids } = dedupeNavaids([bare, specified]) as { navaids: Navaid[]; removed: number };
    expect(navaids).toHaveLength(2);
  });
});

describe('minor light signature merge', () => {
  it('merges an official light into an OSM aid on the same colour and pattern, names aside', () => {
    const osm = mark({ category: 'lateral_starboard', name: 'Harbour Buoy', light: 'Fl red 4s', lightCharacter: 'Fl', lightColour: 'red', lat: 50.7, lon: -1.2 });
    const official = mark({ category: 'light', name: 'Something Else Entirely', light: 'Fl R 4s', lightCharacter: 'Fl', lightColour: 'red', lat: 50.70072, lon: -1.2, source: 'uscg' });
    const { navaids, removed } = mergeNavaidSources([osm, official]) as { navaids: Navaid[]; removed: number };
    expect(removed).toBe(1);
    expect(navaids).toHaveLength(1);
    expect(navaids[0].category).toBe('lateral_starboard');
    expect(navaids[0].lat).toBe(50.7);
    expect(navaids[0].lon).toBe(-1.2);
    expect(navaids[0].light).toBe('Fl R 4s');
    expect(navaids[0].sources).toEqual(['osm', 'uscg']);
  });

  it('merges an archive-shaped aid whose light is only a composed string', () => {
    const osm = mark({ category: 'special_purpose', name: 'Harbour Buoy', light: 'Fl yellow 4s', lat: 50.7, lon: -1.2 });
    const official = mark({ category: 'light', name: 'Unrelated Name', light: 'Fl Y 4s', lightCharacter: 'Fl', lightColour: 'Y', lat: 50.70072, lon: -1.2, source: 'ccg' });
    const { navaids } = mergeNavaidSources([osm, official]) as { navaids: Navaid[]; removed: number };
    expect(navaids).toHaveLength(1);
    expect(navaids[0].category).toBe('special_purpose');
    expect(navaids[0].lat).toBe(50.7);
    expect(navaids[0].sources).toEqual(['osm', 'ccg']);
  });

  it('does not merge the same colour with a different pattern', () => {
    const osm = mark({ category: 'lateral_starboard', name: 'Buoy', light: 'Fl red 4s', lightCharacter: 'Fl', lightColour: 'red', lat: 50.7, lon: -1.2 });
    const official = mark({ category: 'light', name: 'Other', light: 'Fl R 6s', lightCharacter: 'Fl', lightColour: 'red', lat: 50.70072, lon: -1.2, source: 'uscg' });
    const { navaids } = mergeNavaidSources([osm, official]) as { navaids: Navaid[]; removed: number };
    expect(navaids).toHaveLength(2);
  });

  it('does not merge the same pattern with a different colour', () => {
    const osm = mark({ category: 'special_purpose', name: 'Buoy', light: 'Fl yellow 4s', lightCharacter: 'Fl', lightColour: 'yellow', lat: 50.7, lon: -1.2 });
    const official = mark({ category: 'light', name: 'Other', light: 'Fl G 4s', lightCharacter: 'Fl', lightColour: 'green', lat: 50.70072, lon: -1.2, source: 'uscg' });
    const { navaids } = mergeNavaidSources([osm, official]) as { navaids: Navaid[]; removed: number };
    expect(navaids).toHaveLength(2);
  });

  it('does not merge a rear range light into a front aid', () => {
    const osm = mark({ category: 'transit_front', name: 'Range Front', light: 'F white', lightCharacter: 'F', lightColour: 'white', lat: 50.7, lon: -1.2 });
    const official = mark({ category: 'light', name: 'Somewhere rear range light', light: 'F W', lightCharacter: 'F', lightColour: 'W', lat: 50.70036, lon: -1.2, source: 'ccg' });
    const { navaids } = mergeNavaidSources([osm, official]) as { navaids: Navaid[]; removed: number };
    expect(navaids).toHaveLength(2);
  });

  it('does not merge the same signature beyond 150 m', () => {
    const osm = mark({ category: 'lateral_starboard', name: 'Buoy', light: 'Fl red 4s', lightCharacter: 'Fl', lightColour: 'red', lat: 50.7, lon: -1.2 });
    const official = mark({ category: 'light', name: 'Other', light: 'Fl R 4s', lightCharacter: 'Fl', lightColour: 'red', lat: 50.7018, lon: -1.2, source: 'uscg' });
    const { navaids } = mergeNavaidSources([osm, official]) as { navaids: Navaid[]; removed: number };
    expect(navaids).toHaveLength(2);
  });

  it('does not merge an unlit aid on signature alone', () => {
    const osm = mark({ category: 'lateral_starboard', name: 'Buoy', light: null, lat: 50.7, lon: -1.2 });
    const official = mark({ category: 'light', name: 'Other', light: 'Fl R 4s', lightCharacter: 'Fl', lightColour: 'red', lat: 50.70072, lon: -1.2, source: 'uscg' });
    const { navaids } = mergeNavaidSources([osm, official]) as { navaids: Navaid[]; removed: number };
    expect(navaids).toHaveLength(2);
  });

  it('keeps the five real Victoria Traffic Scheme buoys distinct while combining each with its CCG light', () => {
    // Real positions: OSM carries two nodes named #1 (one at #2's spot)
    // and none named #2, so names alone cannot pair them; proximity and
    // the shared Fl Y 4s signature must. OSM #5 carries no light string,
    // only a yellow colour, so it pairs by the attach rule instead.
    const osmMarks = [
      mark({ id: 'osm:node/4291664945', category: 'special_purpose', name: '#1', light: 'Fl yellow 4s', lat: 48.4241495, lon: -123.3833621 }),
      mark({ id: 'osm:node/4291664943', category: 'special_purpose', name: '#1', light: 'Fl yellow 4s', lat: 48.4239622, lon: -123.3811187 }),
      mark({ id: 'osm:node/4291664948', category: 'special_purpose', name: '#3', light: 'Fl yellow 4s', lat: 48.4241167, lon: -123.3791648 }),
      mark({ id: 'osm:node/4291664946', category: 'special_purpose', name: '#4', light: 'Fl yellow 4s', lat: 48.4243233, lon: -123.3850319 }),
      mark({ id: 'osm:node/4291664947', category: 'special_purpose', name: '#5', light: null, colour: 'yellow', lat: 48.4243698, lon: -123.3866087 }),
    ];
    const ccgMarks = [
      mark({ id: 'ccg:pac:208.2', category: 'light', name: 'Victoria Harbour Traffic Scheme Cautionary Light Buoy 1', light: 'Fl Y 4s', lightCharacter: 'Fl', lightColour: 'Y', lat: 48.42414, lon: -123.38308, source: 'ccg' }),
      mark({ id: 'ccg:pac:208.4', category: 'light', name: 'Victoria Harbour Traffic Scheme Cautionary Light Buoy 2', light: 'Fl Y 4s', lightCharacter: 'Fl', lightColour: 'Y', lat: 48.42397, lon: -123.38103, source: 'ccg' }),
      mark({ id: 'ccg:pac:208.6', category: 'light', name: 'Victoria Harbour Traffic Scheme Cautionary Light Buoy 3', light: 'Fl Y 4s', lightCharacter: 'Fl', lightColour: 'Y', lat: 48.42422, lon: -123.37908, source: 'ccg' }),
      mark({ id: 'ccg:pac:208.8', category: 'light', name: 'Victoria Harbour Traffic Scheme Cautionary Light Buoy 4', light: 'Fl Y 4s', lightCharacter: 'Fl', lightColour: 'Y', lat: 48.42419, lon: -123.38489, source: 'ccg' }),
      mark({ id: 'ccg:pac:208.9', category: 'light', name: 'Victoria Harbour Traffic Scheme Cautionary Light Buoy 5', light: 'Fl Y 4s', lightCharacter: 'Fl', lightColour: 'Y', lat: 48.42419, lon: -123.38697, source: 'ccg' }),
    ];
    const merged = mergeNavaidSources([...osmMarks, ...ccgMarks]) as { navaids: Navaid[]; removed: number };
    const deduped = dedupeNavaids(merged.navaids) as { navaids: Navaid[]; removed: number };
    expect(deduped.navaids).toHaveLength(5);
    expect(deduped.navaids.every((n) => n.category === 'special_purpose')).toBe(true);
    expect(deduped.navaids.every((n) => (n.sources ?? []).includes('osm') && (n.sources ?? []).includes('ccg'))).toBe(true);
    expect(deduped.navaids.every((n) => osmMarks.some((o) => o.lat === n.lat && o.lon === n.lon))).toBe(true);
  });

  it('combines "Lee Rock Light" with the chart\u2019s "Lee Rock"', () => {
    // The CCG appends "Light" to the name the chart carries, so the two
    // records sat side by side for years as separate marks.
    const osm = mark({ id: 'osm:node/23', category: 'lateral_port', name: 'Lee Rock', light: 'Fl R 4s', lightCharacter: 'Fl', lightColour: 'red', lat: 48.42, lon: -123.3 });
    const official = mark({ id: 'ccg:pac:300', category: 'light', name: 'Lee Rock Light', light: 'Fl R 4s', lightCharacter: 'Fl', lightColour: 'R', lat: 48.4208, lon: -123.3, source: 'ccg' });
    const { navaids } = mergeNavaidSources([osm, official]) as { navaids: Navaid[]; removed: number };
    expect(navaids).toHaveLength(1);
    expect(navaids[0].id).toBe('osm:node/23');
  });

  it('folds a nameless OSM twin into the named aid it maps', () => {
    // Real records: the light list and the ENC both name Lee Rock's V25 (green
    // pillar, Fl G 4s); OSM pins the same buoy 14 m away with no name, no
    // light and no description, so no name-based rule could see the pair.
    const osm = mark({
      id: 'osm:node/3158857988', category: 'lateral_other', name: null, colour: 'green',
      shape: 'can', lat: 48.4182914, lon: -123.2884069,
    });
    const ccg = mark({
      id: 'ccg:pac:212.7', category: 'lateral_other', name: 'Lee Rock light buoy V25',
      light: 'Fl G 4s', lightCharacter: 'Fl', lightColour: 'G', colour: 'green', shape: 'pillar',
      lat: 48.4184167, lon: -123.28825, source: 'ccg',
    });
    const enc = mark({
      id: 'noaa-enc:Buoy_Lateral:249801', category: 'lateral_port', name: 'Lee Rock light buoy V25',
      light: 'Fl G 4s', lightCharacter: 'Fl', lightColour: 'green', colour: 'green', shape: 'pillar',
      lat: 48.4184167, lon: -123.28825, source: 'noaa-enc',
    });
    const { navaids } = mergeNavaidSources([osm, ccg, enc]) as { navaids: Navaid[]; removed: number };
    expect(navaids).toHaveLength(1);
    expect(navaids[0].id).toBe('osm:node/3158857988');
    expect(navaids[0].name).toBe('Lee Rock light buoy V25');
    expect(navaids[0].light).toBe('Fl G 4s');
    expect(navaids[0].sources).toEqual(['osm', 'ccg', 'noaa-enc']);
  });

  it('does not fold a nameless record beyond 25 m', () => {
    const osm = mark({ category: 'lateral_other', name: null, colour: 'green', lat: 48.4182, lon: -123.2884 });
    const official = mark({
      category: 'lateral_other', name: 'Lee Rock light buoy V25', light: 'Fl G 4s',
      colour: 'green', lat: 48.4185, lon: -123.2884, source: 'ccg',
    });
    const { navaids } = mergeNavaidSources([osm, official]) as { navaids: Navaid[]; removed: number };
    expect(navaids).toHaveLength(2);
  });

  it('does not fold a nameless record whose colour disagrees with the named aid', () => {
    const osm = mark({ category: 'lateral_other', name: null, colour: 'green', lat: 48.4182, lon: -123.2884 });
    const official = mark({
      category: 'lateral_starboard', name: 'Lee Rock light buoy V25', light: 'Fl R 4s',
      lightColour: 'R', colour: 'red', lat: 48.41829, lon: -123.2884, source: 'ccg',
    });
    const { navaids } = mergeNavaidSources([osm, official]) as { navaids: Navaid[]; removed: number };
    expect(navaids).toHaveLength(2);
  });

  it('does not fold a nameless twin from the same source', () => {
    const named = mark({
      id: 'osm:node/1', category: 'lateral_other', name: 'Lee Rock light buoy V25',
      light: 'Fl G 4s', colour: 'green', lat: 48.4182, lon: -123.2884,
    });
    const bare = mark({
      id: 'osm:node/2', category: 'lateral_other', name: null, colour: 'green',
      lat: 48.41829, lon: -123.2884,
    });
    const { navaids } = mergeNavaidSources([named, bare]) as { navaids: Navaid[]; removed: number };
    expect(navaids).toHaveLength(2);
  });

  it('folds a lateral mark onto the lighted pile it stands on', () => {
    // Real pair from the US inland rivers: the list files "SG on skeleton tower
    // on piles" as a lighted pile; OSM charts the same light as the lateral
    // mark it identifies, 6 m away, with the same character and colour.
    // OSM records the whole character in `light` with no separate field, as
    // the archive does; the comparison must parse it rather than compare raw.
    const osm = mark({
      id: 'osm:node/9001', category: 'lateral_port', name: null, colour: 'green', shape: 'cylinder',
      light: 'Iso green 6s', lat: 29.36091, lon: -89.44747,
    });
    const official = mark({
      id: 'uscg:05:12000', category: 'pile_lit', name: 'Fort Jackson Light 19',
      light: 'Iso G 6s', lightCharacter: 'Iso', lightColour: 'G', colour: 'green',
      lat: 29.36091, lon: -89.44747, source: 'uscg',
    });
    const { navaids } = mergeNavaidSources([osm, official]) as { navaids: Navaid[]; removed: number };
    expect(navaids).toHaveLength(1);
    expect(navaids[0].id).toBe('osm:node/9001');
    expect(navaids[0].name).toBe('Fort Jackson Light 19');
    expect(navaids[0].light).toBe('Iso G 6s');
    expect(navaids[0].sources).toEqual(['osm', 'uscg']);
  });

  it('keeps a lateral mark and a lighted pile apart beyond 15 m', () => {
    const osm = mark({
      category: 'lateral_port', name: null, colour: 'green',
      light: 'Iso green 6s', lightColour: 'green', lat: 29.3609, lon: -89.4475,
    });
    const official = mark({
      id: 'uscg:05:1', category: 'pile_lit', name: 'Fort Jackson Light 19', light: 'Iso G 6s',
      colour: 'green', lat: 29.3611, lon: -89.4475, source: 'uscg',
    });
    const { navaids } = mergeNavaidSources([osm, official]) as { navaids: Navaid[]; removed: number };
    expect(navaids).toHaveLength(2);
  });

  it('keeps a lateral mark and a lighted pile apart on different light characters', () => {
    const osm = mark({
      category: 'lateral_port', name: null, colour: 'green',
      light: 'Fl green 4s', lightColour: 'green', lat: 29.3609, lon: -89.4475,
    });
    const official = mark({
      category: 'pile_lit', name: 'Fort Jackson Light 19', light: 'Iso G 6s',
      colour: 'green', lat: 29.36091, lon: -89.4475, source: 'uscg',
    });
    const { navaids } = mergeNavaidSources([osm, official]) as { navaids: Navaid[]; removed: number };
    expect(navaids).toHaveLength(2);
  });

  it('keeps same-source lateral marks and piles apart', () => {
    const lateral = mark({
      id: 'osm:node/9002', category: 'lateral_port', name: 'Green 1', light: 'Iso green 6s',
      colour: 'green', lat: 29.3609, lon: -89.4475,
    });
    const pile = mark({
      id: 'osm:node/9003', category: 'pile_lit', name: 'Pile 1', light: 'Iso green 6s',
      colour: 'green', lat: 29.36091, lon: -89.4475,
    });
    const { navaids } = mergeNavaidSources([lateral, pile]) as { navaids: Navaid[]; removed: number };
    expect(navaids).toHaveLength(2);
  });

  it('combines a south cardinal recorded under a longer official name', () => {
    const osm = mark({ id: 'osm:node/31', category: 'cardinal_south', name: 'Mout Reef South Cardinal Buoy', light: 'Q(3) 10s', lightCharacter: 'Q(3)', lightColour: 'white', lat: 48.43, lon: -123.31 });
    const official = mark({ id: 'ccg:pac:301', category: 'cardinal_south', name: 'Mout Reef', light: 'Q(3) 10s', lightCharacter: 'Q(3)', lightColour: 'W', lat: 48.4306, lon: -123.31, source: 'ccg' });
    const { navaids } = mergeNavaidSources([osm, official]) as { navaids: Navaid[]; removed: number };
    expect(navaids).toHaveLength(1);
  });

  it('folds one source\u2019s light and its buoy into one mark', () => {
    // Real pair from the archive: the same aid mapped twice 15 m apart, with
    // the light named \u201cLight 2\u201d and the buoy \u201cLighted Buoy 2\u201d.
    const first = mark({ id: 'osm:node/5000001', category: 'lateral_port', name: 'Smiling Cove Light 2', light: 'Fl R 2.5s', lightCharacter: 'Fl', lightColour: 'R', lat: 15.2, lon: 145.7 });
    const second = mark({ id: 'osm:node/5000002', category: 'lateral_port', name: 'Smiling Cove Lighted Buoy 2', light: 'Fl R 2.5s', lightCharacter: 'Fl', lightColour: 'R', lat: 15.2001, lon: 145.7 });
    const { navaids } = mergeNavaidSources([first, second]) as { navaids: Navaid[]; removed: number };
    expect(navaids).toHaveLength(1);
  });

  it('keeps neighbouring numbered marks of one source apart', () => {
    // Same words, different number: two real aids, 29 m apart.
    const sixth = mark({ id: 'osm:node/5000003', category: 'lateral_starboard', name: 'Haters Dock Light 6', light: 'F R', lat: 45.2, lon: -85.2 });
    const eighth = mark({ id: 'osm:node/5000004', category: 'lateral_starboard', name: 'Haters Dock Light 8', light: 'F R', lat: 45.20026, lon: -85.2 });
    const { navaids } = mergeNavaidSources([sixth, eighth]) as { navaids: Navaid[]; removed: number };
    expect(navaids).toHaveLength(2);
  });

  it('does not pair two same-source marks that only share their distinctive words', () => {
    // The traffic scheme has two OSM nodes both named #1 166 m apart; they
    // are separate buoys and must never collapse just because the words
    // left after the descriptive ones are the same.
    const first = mark({ id: 'osm:node/4291664945', category: 'special_purpose', name: '#1', light: 'Fl yellow 4s', lat: 48.4241495, lon: -123.3833621 });
    const second = mark({ id: 'osm:node/4291664943', category: 'special_purpose', name: '#1', light: 'Fl yellow 4s', lat: 48.4239622, lon: -123.3811187 });
    const { navaids } = mergeNavaidSources([first, second]) as { navaids: Navaid[]; removed: number };
    expect(navaids).toHaveLength(2);
  });

  it('keeps the real Victoria V21 pair combined at the OSM position', () => {
    const osm = mark({ id: 'osm:node/4291664941', category: 'lateral_port', name: 'Victoria Harbour Entrance Light Buoy V21', light: 'Fl green 4s', colour: 'green', lat: 48.4144737, lon: -123.4032468 });
    const official = mark({ id: 'ccg:pac:204.5', category: 'light', name: 'Victoria Harbour Entrance light buoy V21', light: 'Fl G 4s', lightCharacter: 'Fl', lightColour: 'G', lat: 48.4144722, lon: -123.40325, source: 'ccg' });
    const { navaids } = mergeNavaidSources([osm, official]) as { navaids: Navaid[]; removed: number };
    expect(navaids).toHaveLength(1);
    expect(navaids[0].category).toBe('lateral_port');
    expect(navaids[0].lat).toBe(48.4144737);
    expect(navaids[0].lon).toBe(-123.4032468);
    expect(navaids[0].sources).toEqual(['osm', 'ccg']);
  });

  it('combines the real Victoria VH pair across its 98.8 m position gap', () => {
    const osm = mark({ id: 'osm:node/1199797497', category: 'special_purpose', name: 'Victoria Harbor Buoy VH.', light: 'Fl yellow 4s', lightCharacter: 'Fl', lightColour: 'yellow', lat: 48.3755556, lon: -123.3913889 });
    const official = mark({ id: 'ccg:pac:203', category: 'light', name: 'Victoria Harbour Cautionary light buoy VH', light: 'Fl Y 4s', lightCharacter: 'Fl', lightColour: 'Y', lat: 48.37536, lon: -123.39269, source: 'ccg' });
    const { navaids } = mergeNavaidSources([osm, official]) as { navaids: Navaid[]; removed: number };
    expect(navaids).toHaveLength(1);
    expect(navaids[0].category).toBe('special_purpose');
    expect(navaids[0].lat).toBe(48.3755556);
    expect(navaids[0].lon).toBe(-123.3913889);
    expect(navaids[0].sources).toEqual(['osm', 'ccg']);
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

describe('official buoy merge guards', () => {
  it('does not merge an official green buoy into a red charted aid of the same name', () => {
    const osm = mark({ category: 'lateral_other', colour: 'red', lightColour: 'red', name: 'Reef Buoy', lat: 50.7, lon: -1.2 });
    const official = mark({ category: 'lateral_other', colour: 'green', lightColour: 'green', name: 'Reef Buoy', lat: 50.70007, lon: -1.2, source: 'ccg' });
    const { navaids } = mergeNavaidSources([osm, official]) as { navaids: Navaid[]; removed: number };
    expect(navaids).toHaveLength(2);
  });

  it('merges an official buoy into a charted aid of the same name and colour', () => {
    const osm = mark({ category: 'lateral_other', colour: 'green', name: 'Reef Buoy', lat: 50.7, lon: -1.2 });
    const official = mark({ category: 'lateral_other', colour: 'green', lightColour: 'green', light: 'Fl G 4s', name: 'Reef Buoy', lat: 50.70007, lon: -1.2, source: 'ccg' });
    const { navaids } = mergeNavaidSources([osm, official]) as { navaids: Navaid[]; removed: number };
    expect(navaids).toHaveLength(1);
    expect(navaids[0].lat).toBe(50.7);
    expect(navaids[0].light).toBe('Fl G 4s');
  });

  it('dedupe does not collapse a lateral aid with a conflicting-colour official buoy', () => {
    const osm = mark({ category: 'lateral_other', colour: 'red', name: 'Reef Buoy', lat: 50.7, lon: -1.2 });
    const official = mark({ category: 'lateral_other', colour: 'green', lightColour: 'green', name: 'Reef Buoy', lat: 50.70007, lon: -1.2, source: 'ccg' });
    const { navaids, removed } = dedupeNavaids([osm, official]) as { navaids: Navaid[]; removed: number };
    expect(removed).toBe(0);
    expect(navaids).toHaveLength(2);
  });

  it('dedupe keeps the charted position when a richer official buoy collapses into it', () => {
    const osm = mark({ category: 'lateral_other', colour: 'green', name: 'Harbour Buoy', lat: 50.7, lon: -1.2 });
    const official = mark({
      category: 'lateral_other', colour: 'green', light: 'Fl G 4s', lightCharacter: 'Fl',
      lightColour: 'green', name: 'Other Buoy', height: '10', range: '5',
      description: 'Official listing', lat: 50.70007, lon: -1.2, source: 'uscg',
    });
    const { navaids, removed } = dedupeNavaids([osm, official]) as { navaids: Navaid[]; removed: number };
    expect(removed).toBe(1);
    expect(navaids).toHaveLength(1);
    expect(navaids[0].lat).toBe(50.7);
    expect(navaids[0].lon).toBe(-1.2);
    expect(navaids[0].light).toBe('Fl G 4s');
  });
});
