import type { NavaidCategory } from './navaidTypes';

/**
 * The menu's NAVAID legend and its filters in one place.
 *
 * Every category the chart can draw belongs to exactly one group, so a user can
 * always switch something off — a category with no row would be permanently on
 * with no way to explain it. `symbol` is the category whose glyph represents
 * the group in the key.
 */
export interface NavaidGroup {
  id: string;
  label: string;
  symbol: NavaidCategory;
  categories: NavaidCategory[];
}

export const NAVAID_GROUPS: NavaidGroup[] = [
  { id: 'major_light', label: 'Major light', symbol: 'major_light', categories: ['major_light'] },
  { id: 'light', label: 'Minor light', symbol: 'light', categories: ['light'] },
  {
    id: 'range',
    label: 'Transit / leading',
    symbol: 'transit_front',
    categories: ['transit_front', 'transit_rear', 'range'],
  },
  { id: 'lateral_port', label: 'Port hand', symbol: 'lateral_port', categories: ['lateral_port'] },
  {
    id: 'lateral_starboard',
    label: 'Starboard hand',
    symbol: 'lateral_starboard',
    categories: ['lateral_starboard'],
  },
  { id: 'lateral_other', label: 'Other lateral', symbol: 'lateral_other', categories: ['lateral_other'] },
  {
    id: 'cardinals',
    label: 'Cardinal marks',
    symbol: 'cardinal_north',
    categories: ['cardinal_north', 'cardinal_east', 'cardinal_south', 'cardinal_west'],
  },
  { id: 'safe_water', label: 'Safe water', symbol: 'safe_water', categories: ['safe_water'] },
  {
    id: 'isolated_danger',
    label: 'Isolated danger',
    symbol: 'isolated_danger',
    categories: ['isolated_danger'],
  },
  {
    id: 'special_purpose',
    label: 'Special mark',
    symbol: 'special_purpose',
    categories: ['special_purpose'],
  },
  {
    id: 'bifurcation_port',
    label: 'Bifurcation (port)',
    symbol: 'preferred_channel_port',
    categories: ['preferred_channel_port'],
  },
  {
    id: 'bifurcation_starboard',
    label: 'Bifurcation (starboard)',
    symbol: 'preferred_channel_starboard',
    categories: ['preferred_channel_starboard'],
  },
  { id: 'anchorage', label: 'Anchorage', symbol: 'anchorage', categories: ['anchorage'] },
  {
    id: 'anchor_berth',
    label: 'Anchor berth',
    symbol: 'anchor_berth',
    categories: ['anchor_berth'],
  },
  {
    id: 'calling_in_point',
    label: 'Calling-in point',
    symbol: 'calling_in_point',
    categories: ['calling_in_point'],
  },
  {
    id: 'communication_area',
    label: 'Reporting / communication area',
    symbol: 'communication_area',
    categories: ['communication_area'],
  },
  { id: 'wreck', label: 'Wreck', symbol: 'wreck', categories: ['wreck'] },
  { id: 'hazard', label: 'Hazard', symbol: 'hazard', categories: ['hazard'] },
  { id: 'hazard_danger', label: 'Dangerous wreck', symbol: 'hazard_danger', categories: ['hazard_danger'] },
  {
    id: 'facilities',
    label: 'Marina & facility',
    symbol: 'marina',
    categories: ['marina', 'facility', 'mooring', 'notice', 'gate', 'landmark'],
  },
  { id: 'other', label: 'Other mark', symbol: 'other', categories: ['other'] },
];

export const NAVAID_GROUP_IDS: string[] = NAVAID_GROUPS.map((group) => group.id);

const GROUP_BY_ID = new Map(NAVAID_GROUPS.map((group) => [group.id, group]));

/** Keep only known ids, in a stable order, without duplicates. */
export function sanitizeHiddenGroups(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    if (!GROUP_BY_ID.has(entry)) continue;
    seen.add(entry);
  }
  return NAVAID_GROUP_IDS.filter((id) => seen.has(id));
}

/** Categories the user has switched off, ready for a filter. */
export function hiddenCategorySet(hiddenGroups: unknown): Set<NavaidCategory> {
  const hidden = new Set<NavaidCategory>();
  for (const id of sanitizeHiddenGroups(hiddenGroups)) {
    for (const category of GROUP_BY_ID.get(id)?.categories ?? []) hidden.add(category);
  }
  return hidden;
}

/** Drop marks whose group is switched off; everything else is untouched. */
export function filterNavaidsByGroups<T extends { category: NavaidCategory }>(
  marks: T[],
  hiddenGroups: unknown,
): T[] {
  const hidden = hiddenCategorySet(hiddenGroups);
  if (hidden.size === 0) return marks;
  return marks.filter((mark) => !hidden.has(mark.category));
}

export function isGroupHidden(hiddenGroups: unknown, id: string): boolean {
  return sanitizeHiddenGroups(hiddenGroups).includes(id);
}

/** Add or remove one group, leaving the other choices as they were. */
export function toggleGroup(hiddenGroups: unknown, id: string): string[] {
  const current = sanitizeHiddenGroups(hiddenGroups);
  if (!GROUP_BY_ID.has(id)) return current;
  return current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id];
}
