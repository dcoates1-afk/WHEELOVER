import { describe, expect, it } from 'vitest';
import { ccgRecordToNavaid, type CcgLightRecord } from './ccgLights';
import { priorityFor } from '../../shared/navaid-core.mjs';

function record(overrides: Partial<CcgLightRecord>): CcgLightRecord {
  return {
    volume: 'pac',
    no: '123',
    intlNo: null,
    name: 'Test Light',
    racon: null,
    location: 'Test Bay.',
    lat: 48.4,
    lon: -123.4,
    character: 'Fl',
    colour: 'W',
    period: '6s',
    light: 'Fl W 6s',
    focalHeight: '21.7',
    range: '7',
    description: 'Skeleton tower.',
    structureHeight: '9.7',
    remarks: null,
    sourceUrl: 'https://notmar.gc.ca/publications/list-lights/pac/pac123-en.php',
    ...overrides,
  };
}

describe('ccgRecordToNavaid', () => {
  it('maps a CCG row to a lit light mark with a volume-scoped id', () => {
    const mark = ccgRecordToNavaid(record({}));
    expect(mark.id).toBe('ccg:pac:123');
    expect(mark.category).toBe('light');
    expect(mark.form).toBe('light');
    expect(mark.light).toBe('Fl W 6s');
    expect(mark.lightCharacter).toBe('Fl');
    expect(mark.lightColour).toBe('W');
    expect(mark.lightPeriod).toBe('6s');
    expect(mark.lit).toBe(true);
    expect(mark.source).toBe('ccg');
    expect(mark.priority).toBe(priorityFor('light'));
    expect(mark.description).toBe('Test Bay. · Skeleton tower.');
  });

  it('tolerates missing location and description', () => {
    const mark = ccgRecordToNavaid(record({ location: null, description: null }));
    expect(mark.description).toBeNull();
  });
});

describe('ccgRecordToNavaid classification', () => {
  it('maps a yellow ODAS buoy to a special-purpose buoy, not a minor light', () => {
    const mark = ccgRecordToNavaid(record({
      no: '177.5',
      name: 'South Nomad ODAS light buoy 46036',
      location: 'Offshore W. of Cape Scott.',
      lat: 48.355,
      lon: -133.93833333333333,
      character: 'Fl(5)',
      colour: 'Y',
      period: '20s',
      light: 'Fl(5) Y 20s',
      description: 'Yellow, ODAS, marked “46036”.',
    }));
    expect(mark.category).toBe('special_purpose');
    expect(mark.form).toBe('buoy');
    expect(mark.colour).toBe('yellow');
    expect(mark.light).toBe('Fl(5) Y 20s');
    expect(mark.priority).toBe(priorityFor('special_purpose'));
  });
});
