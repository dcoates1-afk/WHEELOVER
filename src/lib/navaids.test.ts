import { describe, expect, it } from 'vitest';
import { reconcileLightRank } from './navaids';
import type { Navaid } from './navaidTypes';

function mark(overrides: Partial<Navaid> & { category: Navaid['category'] }): Navaid {
  return {
    id: 'osm:way/128637893',
    lat: 50.7079511,
    lon: -1.5503313,
    form: 'landmark',
    name: 'Hurst Point',
    light: null,
    colour: null,
    shape: null,
    ...overrides,
  } as Navaid;
}

const sectors = [
  { sector: 1, character: 'Fl', colour: 'white', start: '080', end: '104' },
  { sector: 5, character: 'Iso', colour: 'green', category: 'directional', orientation: '39.8' },
];

describe('reconcileLightRank', () => {
  it('takes the regional light class when the archive record carries no light', () => {
    // The worldwide archive strips light records, so Hurst Point arrives as a
    // lightless landmark; the regional build knows it is a major light.
    const archived = mark({ category: 'landmark', priority: 44, lightSectors: [] });
    const regional = mark({ category: 'major_light', priority: 100, light: 'Fl(4) white 15s', lightCharacter: 'Fl', lightSectors: sectors });

    const merged = reconcileLightRank(archived, regional);

    expect(merged.category).toBe('major_light');
    expect(merged.priority).toBe(100);
    expect(merged.light).toBe('Fl(4) white 15s');
    expect(merged.lightSectors).toEqual(sectors);
  });

  it('keeps the archive classification when it already records the light', () => {
    const archived = mark({ category: 'major_light', priority: 100, light: 'Fl white 5s', lightSectors: [sectors[0]] });
    const regional = mark({ category: 'light', priority: 66, lightSectors: sectors });

    const merged = reconcileLightRank(archived, regional);

    expect(merged).toBe(archived);
    expect(merged.lightSectors).toEqual([sectors[0]]);
  });

  it('leaves an unlit mark alone when neither record has a light', () => {
    const archived = mark({ category: 'landmark', priority: 44 });
    const regional = mark({ category: 'landmark', priority: 44 });

    expect(reconcileLightRank(archived, regional)).toBe(archived);
  });
});
