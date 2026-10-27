import { describe, expect, it } from 'vitest';
import {
  NAVAID_GROUP_IDS,
  NAVAID_GROUPS,
  filterNavaidsByGroups,
  hiddenCategorySet,
  isGroupHidden,
  sanitizeHiddenGroups,
  toggleGroup,
} from './navaidGroups';
import type { NavaidCategory } from './navaidTypes';

const ALL_CATEGORIES: NavaidCategory[] = [
  'lateral_port',
  'lateral_starboard',
  'preferred_channel_port',
  'preferred_channel_starboard',
  'lateral_other',
  'cardinal_north',
  'cardinal_east',
  'cardinal_south',
  'cardinal_west',
  'safe_water',
  'isolated_danger',
  'special_purpose',
  'range',
  'transit_front',
  'transit_rear',
  'major_light',
  'light',
  'wreck',
  'hazard',
  'hazard_danger',
  'landmark',
  'marina',
  'facility',
  'mooring',
  'anchorage',
  'anchor_berth',
  'calling_in_point',
  'communication_area',
  'notice',
  'gate',
  'other',
];

describe('legend groups', () => {
  it('covers every chartable category exactly once', () => {
    const covered = NAVAID_GROUPS.flatMap((group) => group.categories);
    expect(new Set(covered).size).toBe(covered.length);
    expect([...covered].sort()).toEqual([...ALL_CATEGORIES].sort());
  });

  it('has unique ids', () => {
    expect(new Set(NAVAID_GROUP_IDS).size).toBe(NAVAID_GROUP_IDS.length);
  });

  it('sanitises stored choices', () => {
    expect(sanitizeHiddenGroups(['anchorage', 'nope', 'anchorage', 7])).toEqual(['anchorage']);
    expect(sanitizeHiddenGroups('anchorage')).toEqual([]);
    expect(sanitizeHiddenGroups(null)).toEqual([]);
    // Stable ordering keeps storage from churning between sessions.
    expect(sanitizeHiddenGroups(['hazard', 'major_light'])).toEqual(['major_light', 'hazard']);
  });
});

describe('group filtering', () => {
  const marks: { id: string; category: NavaidCategory }[] = [
    { id: 'a', category: 'major_light' },
    { id: 'b', category: 'anchorage' },
    { id: 'c', category: 'cardinal_north' },
    { id: 'd', category: 'cardinal_west' },
    { id: 'e', category: 'preferred_channel_port' },
  ];

  it('hides a single class', () => {
    expect(filterNavaidsByGroups(marks, ['anchorage']).map((mark) => mark.id)).toEqual([
      'a',
      'c',
      'd',
      'e',
    ]);
  });

  it('hides every category in a grouped row', () => {
    const hidden = hiddenCategorySet(['cardinals']);
    expect(hidden.has('cardinal_north')).toBe(true);
    expect(hidden.has('cardinal_west')).toBe(true);
    expect(filterNavaidsByGroups(marks, ['cardinals']).map((mark) => mark.id)).toEqual([
      'a',
      'b',
      'e',
    ]);
  });

  it('returns the same array when nothing is hidden', () => {
    expect(filterNavaidsByGroups(marks, [])).toBe(marks);
  });

  it('toggles one group without touching the rest', () => {
    const after = toggleGroup(['anchorage'], 'hazard');
    expect(after).toEqual(['anchorage', 'hazard']);
    expect(toggleGroup(after, 'anchorage')).toEqual(['hazard']);
    expect(toggleGroup(after, 'unknown-group')).toEqual(['anchorage', 'hazard']);
    expect(isGroupHidden(after, 'hazard')).toBe(true);
    expect(isGroupHidden(after, 'anchorage')).toBe(true);
    expect(isGroupHidden(['hazard'], 'anchorage')).toBe(false);
  });
});
