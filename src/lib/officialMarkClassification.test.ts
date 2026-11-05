import { describe, expect, it } from 'vitest';
import { classifyOfficialMark } from './officialMarkClassification';

describe('classifyOfficialMark', () => {
  it('marks a yellow ODAS buoy as a special-purpose buoy, not a minor light', () => {
    expect(classifyOfficialMark({
      name: 'South Nomad ODAS light buoy 46036',
      description: 'Yellow, ODAS, marked “46036”.',
      lightColour: 'Y',
    })).toMatchObject({ category: 'special_purpose', form: 'buoy', colour: 'yellow' });
  });

  it('marks a green buoy with a green light as a lateral buoy in green', () => {
    expect(classifyOfficialMark({
      name: 'Clallam Reef Lighted Buoy 1',
      description: 'Strait of Juan De Fuca · Green.',
      lightColour: 'green',
    })).toMatchObject({ category: 'lateral_other', form: 'buoy', colour: 'green' });
  });

  it('marks DART, research, environmental and traffic-separation buoys special', () => {
    for (const name of [
      'DART Tsunami Warning Lighted Buoy 46419',
      'Scripps Institute Wave Recorder Lighted Buoy 46224',
      'NOAA Environmental Lighted Buoy 46029',
      'WHOI Traffic Separation Scheme Research Lighted Buoy AB-1',
      'OSU West Port Offshore Research Lighted Buoy',
    ]) {
      expect(classifyOfficialMark({ name, description: 'Yellow.', lightColour: 'yellow' }).category)
        .toBe('special_purpose');
    }
  });

  it('marks a red nun buoy lateral in red and reads its shape', () => {
    expect(classifyOfficialMark({
      name: 'Lake Memphremagog Lighted Buoy 2',
      description: 'Lake Memphremagog · Red nun. · Private Aid.',
      lightColour: 'red',
    })).toMatchObject({ category: 'lateral_other', form: 'buoy', colour: 'red', shape: 'conical' });
  });

  it('marks a red-white pillar buoy with a white light as a safe-water buoy', () => {
    expect(classifyOfficialMark({
      name: 'Gros Cap light buoy NG',
      description: 'Red-white, pillar, marked “NG”.',
      lightColour: 'W',
    })).toMatchObject({ category: 'safe_water', form: 'buoy', colour: 'white', shape: 'pillar' });
  });

  it('marks cardinal buoys by their direction word', () => {
    expect(classifyOfficialMark({
      name: 'Fairway Rock South Cardinal light buoy NN',
      description: 'Yellow-black, spar, marked “NN”.',
      lightColour: 'W',
    })).toMatchObject({ category: 'cardinal_south', form: 'buoy' });
  });

  it('marks piles and dolphins as lighted piles when lit, unlit piles when not', () => {
    expect(classifyOfficialMark({
      name: 'Columbia River Pile Light 12',
      description: 'Green pile.',
      lightColour: 'green',
      lit: true,
    })).toMatchObject({ category: 'pile_lit', form: 'beacon' });
    expect(classifyOfficialMark({
      name: 'Dolphin Light A',
      description: 'Dolphin, red.',
      lightColour: 'red',
      lit: true,
    }).category).toBe('pile_lit');
    // A pile record with no light at all is an unlit pile, not a minor light.
    expect(classifyOfficialMark({
      name: 'Pile 7',
      description: 'Wooden pile.',
      lightColour: null,
      lit: false,
    }).category).toBe('pile_unlit');
  });

  it('marks daybeacons as fixed lateral boards', () => {
    expect(classifyOfficialMark({
      name: 'Channel Daybeacon 4',
      description: 'Green daybeacon.',
      lightColour: null,
    })).toMatchObject({ category: 'lateral_other', form: 'beacon', colour: 'green' });
  });

  it('leaves towers, range lights and plain lights as minor lights', () => {
    for (const name of [
      'Koojesse Inlet Front Range Light',
      'Point Light',
    ]) {
      expect(classifyOfficialMark({ name, description: 'Skeleton tower.', lightColour: 'W' }))
        .toMatchObject({ category: 'light', form: 'light', colour: null });
    }
  });

  it('marks a record named as a lighthouse as the lighthouse tower', () => {
    for (const name of ['Cockspur Lighthouse', 'Harbour Lighthouse', 'Heceta Head Lighthouse']) {
      expect(classifyOfficialMark({ name, description: 'Tower.', lightColour: 'W' }))
        .toMatchObject({ category: 'lighthouse', form: 'landmark', colour: null, shape: null });
    }
  });

  it('does not mistake place, channel, wreck or breakwater lights for lighthouses', () => {
    expect(classifyOfficialMark({
      name: 'Lighthouse Channel Lighted Buoy 4',
      description: 'Green can.',
      lightColour: 'green',
    })).toMatchObject({ category: 'lateral_other', form: 'buoy' });
    for (const name of [
      'Lighthouse Point Light',
      'PASS MANCHAC LIGHTHOUSE WRECK LIGHT WR8',
      'Town of Madisonville Tchefuncte River Lighthouse Breakwater Lights (3)',
    ]) {
      expect(classifyOfficialMark({ name, description: 'Tower.', lightColour: 'W' }).category).toBe('light');
    }
  });

  it('marks named sector and directional lights as sector beacons', () => {
    expect(classifyOfficialMark({
      name: 'Mount Pickle Sector Light',
      description: 'Fixed.',
      lightColour: 'R W G',
    })).toMatchObject({ category: 'sector_beacon', form: 'light', colour: 'red' });
    expect(classifyOfficialMark({
      name: 'Fisher Point Directional Sector Light',
      description: 'Fixed.',
      lightColour: 'white',
    }).category).toBe('sector_beacon');
  });

  it('keeps sector buoys as buoys and gate lights as lights', () => {
    expect(classifyOfficialMark({
      name: 'Harbour Sector Lighted Buoy 1',
      description: 'Yellow.',
      lightColour: 'yellow',
    })).toMatchObject({ category: 'special_purpose', form: 'buoy' });
    expect(classifyOfficialMark({
      name: 'Orleans Levee District ICWW Surge Barrier Sector Gate Light 2',
      description: 'Fixed.',
      lightColour: 'red',
    }).category).toBe('light');
  });

  it('does not take a place name for the mark colour', () => {
    // "Red Island" is where the aid sits, not what it is painted.
    expect(classifyOfficialMark({
      name: 'Red Island Shoal ODAS light buoy',
      description: 'Yellow, ODAS.',
      lightColour: 'Y',
    })).toMatchObject({ category: 'special_purpose', colour: 'yellow' });
  });

  it('falls back to the descriptor colour when the light colour is missing', () => {
    expect(classifyOfficialMark({
      name: 'Unlit Green Buoy 3',
      description: 'Green can.',
      lightColour: null,
    })).toMatchObject({ category: 'lateral_other', form: 'buoy', colour: 'green', shape: 'can' });
  });
});
