import { describe, expect, it } from 'vitest';
import {
  cardinalCategory, clean, colourWords, groupLightFeatures, groupNumber,
  isLighthouse, isNonNavigationLight, joinLightFloats, joinSignals,
  lateralCategory, lightFields, lightString, mapFeature, periodSeconds,
  sectorEntry, sourceDate,
} from './noaa-enc-mapping.mjs';

const lightAttrs = (overrides = {}) => ({
  LITCHR: 2, SIGGRP: '(1)', SIGPER: 4.0, COLOUR: 3, SECTR1: null, SECTR2: null,
  VALNMR: 5.0, HEIGHT: 10.0, SIGSEQ: '00.4+(03.6)', ORIENT: null, CATLIT: ' ',
  OBJNAM: 'Test Light', INFORM: null, SORDAT: '20131001', ...overrides,
});

describe('value cleaning', () => {
  it('trims and nulls blanks', () => {
    expect(clean(' conical ')).toBe('conical');
    expect(clean(' ')).toBeNull();
    expect(clean(null)).toBeNull();
    expect(clean(5)).toBe('5');
  });
  it('splits coded colour lists', () => {
    expect(colourWords('6,2,6')).toEqual(['yellow', 'black', 'yellow']);
    expect(colourWords('3,1')).toEqual(['red', 'white']);
    expect(colourWords(' ')).toEqual([]);
  });
  it('parses groups and periods', () => {
    expect(groupNumber('(5)')).toBe('5');
    expect(groupNumber('()')).toBeNull();
    expect(periodSeconds('25.0')).toBe('25');
    expect(periodSeconds('0.5')).toBe('0.5');
  });
  it('parses source dates', () => {
    expect(sourceDate('20131001')).toBe('2013-10-01');
    expect(sourceDate('200704')).toBe('2007-04');
    expect(sourceDate(' ')).toBeNull();
  });
});

describe('light strings', () => {
  it('builds IALA light-list strings', () => {
    expect(lightString({ character: 'Fl', group: '2', colours: ['red', 'white'], period: '10' })).toBe('Fl(2) R W 10s');
    expect(lightString({ character: 'F', colours: ['red'] })).toBe('F R');
    expect(lightString({ character: 'Iso', colours: ['white'], period: '6' })).toBe('Iso W 6s');
    expect(lightString({})).toBeNull();
  });
  it('reads coded light fields', () => {
    const fields = lightFields(lightAttrs());
    expect(fields.character).toBe('Fl');
    expect(fields.light).toBe('Fl R 4s');
    expect(fields.lightColour).toBe('red');
    expect(fields.range).toBe('5');
    expect(fields.height).toBe('10');
  });
  it('reads a sector entry', () => {
    const sector = sectorEntry(lightAttrs({ SECTR1: 61.0, SECTR2: 225.0, COLOUR: 1 }), 1);
    expect(sector?.start).toBe('61');
    expect(sector?.end).toBe('225');
    expect(sector?.colour).toBe('white');
    expect(sectorEntry(lightAttrs(), 1)).toBeNull();
  });
});

describe('light classification', () => {
  it('filters aircraft and obstruction lights', () => {
    expect(isNonNavigationLight({ CATLIT: 'aero light' })).toBe(true);
    expect(isNonNavigationLight({ CATLIT: 'air obstruction light' })).toBe(true);
    expect(isNonNavigationLight({ CATLIT: ' ' })).toBe(false);
  });
  it('maps a sector light to a sector beacon', () => {
    const record = mapFeature({
      layer: 'Light', band: 'enc_harbour', objectId: 1, lat: 58.0, lon: -152.0,
      attrs: lightAttrs({ SECTR1: 61.0, SECTR2: 225.0, COLOUR: 1 }),
    });
    expect(record?.category).toBe('sector_beacon');
    expect(record?.lightSectors).toHaveLength(1);
    expect(record?.lightSectors?.[0].start).toBe('61');
    expect(record?.lightSectors?.[0].end).toBe('225');
    expect(record?.source).toBe('noaa-enc');
  });
  it('maps a plain light and keeps a directional orientation', () => {
    const plain = mapFeature({
      layer: 'Light', band: 'enc_harbour', objectId: 2, lat: 58.0, lon: -152.0,
      attrs: lightAttrs(),
    });
    expect(plain?.category).toBe('light');
    expect(plain?.light).toBe('Fl R 4s');
    const directional = mapFeature({
      layer: 'Light', band: 'enc_harbour', objectId: 3, lat: 58.0, lon: -152.0,
      attrs: lightAttrs({ ORIENT: 180 }),
    });
    expect(directional?.category).toBe('light');
    expect(directional?.lightSectors?.[0].orientation).toBe('180');
  });
  it('drops aero lights', () => {
    expect(mapFeature({
      layer: 'Light', band: 'enc_harbour', objectId: 4, lat: 58.0, lon: -152.0,
      attrs: lightAttrs({ CATLIT: 'aero light' }),
    })).toBeNull();
  });
});

describe('lateral and cardinal categories', () => {
  it('uses CATLAM when present', () => {
    expect(lateralCategory({ CATLAM: 1, COLOUR: 4 }, 58, -152)).toBe('lateral_port');
    expect(lateralCategory({ CATLAM: 2, COLOUR: 3 }, 58, -152)).toBe('lateral_starboard');
  });
  it('falls back to colour and IALA region', () => {
    // Region B (Alaska): red is starboard, green is port.
    expect(lateralCategory({ COLOUR: 3 }, 58, -152)).toBe('lateral_starboard');
    expect(lateralCategory({ COLOUR: 4 }, 58, -152)).toBe('lateral_port');
    // Region A (English Channel): red is port, green is starboard.
    expect(lateralCategory({ COLOUR: 3 }, 50, 0)).toBe('lateral_port');
    expect(lateralCategory({ COLOUR: 4 }, 50, 0)).toBe('lateral_starboard');
    expect(lateralCategory({ COLOUR: 6 }, 50, 0)).toBe('lateral_other');
  });
  it('uses CATCAM, then IALA banding, for cardinals', () => {
    expect(cardinalCategory({ CATCAM: 1 })).toBe('cardinal_north');
    expect(cardinalCategory({ CATCAM: 2 })).toBe('cardinal_east');
    expect(cardinalCategory({ CATCAM: 4 })).toBe('cardinal_west');
    expect(cardinalCategory({ COLOUR: '2,6' })).toBe('cardinal_north');
    expect(cardinalCategory({ COLOUR: '2,6,2' })).toBe('cardinal_east');
    expect(cardinalCategory({ COLOUR: '6,2' })).toBe('cardinal_south');
    expect(cardinalCategory({ COLOUR: '6,2,6' })).toBe('cardinal_west');
    expect(cardinalCategory({})).toBeNull();
  });
});

describe('other mark layers', () => {
  it('maps lateral buoys with shape and colour', () => {
    const record = mapFeature({
      layer: 'Buoy_Lateral', band: 'enc_harbour', objectId: 10, lat: 58.0, lon: -152.0,
      attrs: { CATLAM: 2, COLOUR: 3, BOYSHP: 'can', OBJNAM: 'Nome Harbor Buoy 2', INFORM: null, SORDAT: null },
    });
    expect(record?.category).toBe('lateral_starboard');
    expect(record?.form).toBe('buoy');
    expect(record?.shape).toBe('can');
    expect(record?.colour).toBe('red');
  });
  it('maps lighthouses by function or name', () => {
    expect(isLighthouse({ FUNCTN: 33, OBJNAM: null })).toBe(true);
    expect(isLighthouse({ FUNCTN: null, OBJNAM: 'Cockspur Lighthouse' })).toBe(true);
    expect(isLighthouse({ FUNCTN: null, OBJNAM: 'Lighthouse Point' })).toBe(false);
    // FUNCTN 33 marks any landmark carrying a light, not a lighthouse: an
    // airport beacon, a monument, a tower or a bare place name is a landmark.
    expect(isLighthouse({ FUNCTN: 33, OBJNAM: 'Miami International Airport Light' })).toBe(false);
    expect(isLighthouse({ FUNCTN: 33, OBJNAM: 'Perry Memorial Monument Light' })).toBe(false);
    expect(isLighthouse({ FUNCTN: 33, OBJNAM: 'Pacific Gas and Electric Company Tower Light' })).toBe(false);
    expect(isLighthouse({ FUNCTN: 33, OBJNAM: 'Traffic Light' })).toBe(false);
    expect(isLighthouse({ FUNCTN: 33, OBJNAM: 'Jacksonville' })).toBe(false);
    // Genuine lighthouses are usually named "* Light", not "* Lighthouse".
    expect(isLighthouse({ FUNCTN: 33, OBJNAM: 'Cape Hatteras Light' })).toBe(true);
    expect(isLighthouse({ FUNCTN: 33, OBJNAM: 'Saint Augustine Lt' })).toBe(true);
    expect(isLighthouse({ FUNCTN: 33, OBJNAM: 'Matagorda Light House' })).toBe(true);
    const record = mapFeature({
      layer: 'Landmark', band: 'enc_harbour', objectId: 20, lat: 32.0, lon: -81.0,
      attrs: { CATLMK: 'tower', FUNCTN: 33, OBJNAM: 'Cockspur Lighthouse', COLOUR: null, HEIGHT: 18.9, INFORM: 'Conical', SORDAT: null },
    });
    expect(record?.category).toBe('lighthouse');
    expect(record?.height).toBe('18.9');
  });
  it('maps platforms and piles', () => {
    const platform = mapFeature({
      layer: 'Offshore_Platform', band: 'enc_harbour', objectId: 30, lat: 29.0, lon: -90.0,
      attrs: { CATOFP: 'production platform', OBJNAM: 'Fieldwood MO821', COLOUR: null, INFORM: null, SORDAT: null },
    });
    expect(platform?.category).toBe('oil_rig');
    const pile = mapFeature({
      layer: 'Pile', band: 'enc_harbour', objectId: 31, lat: 29.0, lon: -90.0,
      attrs: { CATPLE: 'post', OBJNAM: null, COLOUR: null, INFORM: null, SORDAT: null },
    });
    expect(pile?.category).toBe('pile');
  });
  it('leaves a light float unlit until joined', () => {
    const record = mapFeature({
      layer: 'Light_Float', band: 'enc_harbour', objectId: 40, lat: 58.0, lon: -152.0,
      attrs: { OBJNAM: 'Test Float', COLOUR: 6, INFORM: null, SORDAT: null },
    });
    expect(record?.category).toBe('light');
    expect(record?.form).toBe('buoy');
    expect(record?.lit).toBe(false);
  });
});

describe('sector grouping', () => {
  const sectorRecord = (start, end, colour, objectId) => mapFeature({
    layer: 'Light', band: 'enc_harbour', objectId, lat: 58.0, lon: -152.0,
    attrs: lightAttrs({ SECTR1: start, SECTR2: end, COLOUR: colour, OBJNAM: 'Entrance Light' }),
  });
  it('groups one light’s sectors into a single sector beacon', () => {
    const grouped = groupLightFeatures([
      sectorRecord(61, 225, 1, 1), sectorRecord(225, 252, 3, 2),
      sectorRecord(252, 330, 1, 3), sectorRecord(330, 347, 3, 4),
    ]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].category).toBe('sector_beacon');
    expect(grouped[0].lightSectors).toHaveLength(4);
    expect(grouped[0].lightSectors?.map((s) => s.sector)).toEqual([1, 2, 3, 4]);
  });
  it('collapses exact-duplicate sectors and keeps different positions apart', () => {
    const grouped = groupLightFeatures([
      sectorRecord(61, 225, 1, 1), sectorRecord(61, 225, 1, 5),
      mapFeature({
        layer: 'Light', band: 'enc_approach', objectId: 9, lat: 59.0, lon: -151.0,
        attrs: lightAttrs({ SECTR1: 61, SECTR2: 225, COLOUR: 1, OBJNAM: 'Other Light' }),
      }),
    ]);
    expect(grouped).toHaveLength(2);
    expect(grouped[0].lightSectors).toHaveLength(1);
  });
  it('keeps a plain light at the same position as the top-level light', () => {
    const grouped = groupLightFeatures([
      sectorRecord(61, 225, 1, 1),
      mapFeature({
        layer: 'Light', band: 'enc_harbour', objectId: 7, lat: 58.0, lon: -152.0,
        attrs: lightAttrs({ OBJNAM: 'Entrance Light' }),
      }),
    ]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].category).toBe('sector_beacon');
    expect(grouped[0].light).toBe('Fl R 4s');
  });
});

describe('light-float and signal joins', () => {
  it('fills a light float from its co-located light', () => {
    const floats = [mapFeature({
      layer: 'Light_Float', band: 'enc_harbour', objectId: 40, lat: 58.0, lon: -152.0,
      attrs: { OBJNAM: 'Test Float', COLOUR: 6, INFORM: null, SORDAT: null },
    })];
    const lights = groupLightFeatures([mapFeature({
      layer: 'Light', band: 'enc_harbour', objectId: 1, lat: 58.0, lon: -152.0,
      attrs: lightAttrs({ SECTR1: 61, SECTR2: 225, COLOUR: 1 }),
    })]);
    const joined = joinLightFloats(floats, lights);
    expect(joined[0].lit).toBe(true);
    expect(joined[0].lightSectors).toHaveLength(1);
    const orphan = joinLightFloats(floats, []);
    expect(orphan[0].lit).toBe(false);
  });
  it('attaches nearby fog, racon and daymark signals and drops orphans', () => {
    const mark = mapFeature({
      layer: 'Buoy_Lateral', band: 'enc_harbour', objectId: 10, lat: 58.0, lon: -152.0,
      attrs: { CATLAM: 2, COLOUR: 3, BOYSHP: 'can', OBJNAM: 'Buoy 2', INFORM: null, SORDAT: null },
    });
    const marks = [mark];
    const { attached, orphaned } = joinSignals(
      marks,
      [{ lat: 58.00005, lon: -152.0, attrs: { CATFOG: 'bell', SIGGRP: null, SIGPER: 6.0, SIGSEQ: null } }],
      [{ lat: 58.00005, lon: -152.0, attrs: { SIGGRP: '(N)', SIGPER: null, SIGSEQ: null } }],
      [{ lat: 58.00005, lon: -152.0, attrs: { TOPSHP: 19, COLOUR: 4 } }],
    );
    expect(attached).toEqual({ fog: 1, racon: 1, daymark: 1 });
    expect(orphaned).toEqual({ fog: 0, racon: 0, daymark: 0 });
    expect(mark?.fogSignal).toBe(true);
    expect(mark?.fogSignalCategory).toBe('bell');
    expect(mark?.fogSignalPeriod).toBe('6');
    expect(mark?.radarTransponderCategory).toBe('racon');
    expect(mark?.radarTransponderGroup).toBe('N');
    expect(mark?.daymarkShape).toBe('square');
    expect(mark?.daymarkColour).toBe('green');
    const far = joinSignals(marks, [{ lat: 59.0, lon: -152.0, attrs: { CATFOG: 'bell' } }], [], []);
    expect(far.orphaned.fog).toBe(1);
  });
});
