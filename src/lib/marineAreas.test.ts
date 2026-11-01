import { describe, expect, it } from 'vitest';
import { MARINE_AREA_GROUPS as SHARED_GROUPS } from '../../shared/marine-area-core.mjs';
import { elementPaths, ringsAndLines, stitchPaths } from '../../shared/marine-area-core.mjs';
import {
  MARINE_AREA_GROUPS,
  MARINE_AREA_GROUP_META,
  classifyMarineArea,
  marineAreaGroups,
  sanitizeHiddenAreaGroups,
  toggleAreaGroup,
} from './marineAreas';

describe('marine-area classification', () => {
  it('puts military ranges and test areas in their own group', () => {
    expect(classifyMarineArea({ military: 'danger_area' })?.group).toBe('military');
    expect(classifyMarineArea({ military: 'training_area' })?.group).toBe('military');
    expect(classifyMarineArea({ military: 'naval_base' })?.group).toBe('military');
    expect(classifyMarineArea({ military: 'test_range' })?.label).toBe('Test and evaluation range');
    expect(classifyMarineArea({ landuse: 'military', military: 'danger_area' })?.group).toBe('military');
  });

  it('treats charted restricted and caution areas as danger areas', () => {
    expect(classifyMarineArea({ 'seamark:type': 'restricted_area' })).toEqual({
      group: 'danger',
      label: 'Restricted area',
    });
    expect(classifyMarineArea({ 'seamark:type': 'caution_area' })?.label).toBe('Caution area');
  });

  it('separates reefs and banks from protected sites', () => {
    expect(classifyMarineArea({ natural: 'reef' })?.group).toBe('reef');
    expect(classifyMarineArea({ natural: 'shoal' })?.group).toBe('shoal');
    expect(classifyMarineArea({ natural: 'bank' })?.label).toBe('Bank');
  });

  it('sorts conservation designations away from plain protected areas', () => {
    expect(classifyMarineArea({ boundary: 'protected_area', protect_class: '5' })?.group).toBe('protected');
    expect(classifyMarineArea({ boundary: 'protected_area', designation: 'Special Area of Conservation' })?.group)
      .toBe('conservation');
    expect(classifyMarineArea({ boundary: 'protected_area', protect_class: '1a', protection_title: 'Highly Protected Marine Area' })?.group)
      .toBe('conservation');
    expect(classifyMarineArea({ leisure: 'nature_reserve', name: 'Migratory bird sanctuary' })?.group)
      .toBe('conservation');
  });

  it('ignores anything that is not a marine area', () => {
    expect(classifyMarineArea({ highway: 'trunk' })).toBeNull();
    expect(classifyMarineArea({})).toBeNull();
    expect(classifyMarineArea(undefined)).toBeNull();
  });

  it('matches the shared group list the builder uses', () => {
    expect([...MARINE_AREA_GROUPS]).toEqual([...SHARED_GROUPS]);
    for (const group of MARINE_AREA_GROUPS) expect(MARINE_AREA_GROUP_META[group].colour).toMatch(/^#/);
  });
});

describe('area toggle preferences', () => {
  it('drops unknown and repeated ids from a stored list', () => {
    expect(sanitizeHiddenAreaGroups(['reef', 'nope', 'reef', 7, 'military'])).toEqual(['reef', 'military']);
    expect(sanitizeHiddenAreaGroups('reef')).toEqual([]);
  });

  it('toggles one group without disturbing the others', () => {
    expect(toggleAreaGroup([], 'reef')).toEqual(['reef']);
    expect(toggleAreaGroup(['reef', 'danger'], 'reef')).toEqual(['danger']);
  });

  it('reports the groups present on the chart in menu order', () => {
    expect(marineAreaGroups(['shoal', undefined, 'protected', 'shoal'])).toEqual(['protected', 'shoal']);
  });
});

describe('relation geometry', () => {
  it('reads a way geometry and every relation member geometry', () => {
    expect(elementPaths({ geometry: [{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }] })).toEqual([[[1, 2], [3, 4]]]);
    expect(elementPaths({
      members: [
        { geometry: [{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }] },
        { geometry: [{ lat: 5, lon: 6 }, { lat: 7, lon: 8 }] },
        { geometry: [] },
      ],
    })).toEqual([[[1, 2], [3, 4]], [[5, 6], [7, 8]]]);
    expect(elementPaths({})).toEqual([]);
  });

  it('joins member ways into one closed ring', () => {
    const ring = stitchPaths([
      [[0, 0], [0, 1]],
      [[0, 1], [1, 1]],
      [[1, 1], [1, 0]],
      [[1, 0], [0, 0]],
    ]);
    expect(ring).toHaveLength(1);
    expect(ring[0][0]).toEqual(ring[0][ring[0].length - 1]);
    expect(ring[0]).toHaveLength(5);
  });

  it('keeps an unclosed boundary as a line', () => {
    const { rings, lines } = ringsAndLines([[[0, 0], [0, 1]], [[0, 1], [1, 1]]]);
    expect(rings).toEqual([]);
    expect(lines).toHaveLength(1);
  });
});
