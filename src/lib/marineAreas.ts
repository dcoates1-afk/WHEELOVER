import { classifyMarineArea as classifySharedArea } from '../../shared/marine-area-core.mjs';

export type MarineAreaGroup = 'protected' | 'conservation' | 'reef' | 'shoal' | 'danger' | 'military';

/** Menu order. Mirrors the ids the shared classifier can return. */
export const MARINE_AREA_GROUPS: MarineAreaGroup[] = [
  'protected',
  'conservation',
  'reef',
  'shoal',
  'danger',
  'military',
];

/**
 * Classify an OSM tag set. The shared module owns the rules; this wrapper types
 * the group for the chart, menu and preferences.
 */
export function classifyMarineArea(
  tags: Record<string, string | undefined> | null | undefined,
): { group: MarineAreaGroup; label: string } | null {
  const result = classifySharedArea(tags) as { group: string; label: string } | null;
  if (!result) return null;
  return { group: result.group as MarineAreaGroup, label: result.label };
}

export interface MarineAreaGroupMeta {
  id: MarineAreaGroup;
  label: string;
  hint: string;
  /** Outline, fill and legend chip colour. */
  colour: string;
  fill: string;
}

/**
 * The overlay's toggles. Every group is drawn with one stroke style, so what is
 * on the chart reads the same as the chip that switched it on.
 */
export const MARINE_AREA_GROUP_META: Record<MarineAreaGroup, MarineAreaGroupMeta> = {
  protected: {
    id: 'protected',
    label: 'Protected areas & reserves',
    hint: 'Ecological reserves, nature areas and protected areas',
    colour: '#8a54c7',
    fill: '#ad82e5',
  },
  conservation: {
    id: 'conservation',
    label: 'Conservation designations',
    hint: 'SACs, SPAs, MPAs, highly protected and no-take sites',
    colour: '#1f7a6a',
    fill: '#5cbfa9',
  },
  reef: {
    id: 'reef',
    label: 'Reefs',
    hint: 'Charted and mapped reefs',
    colour: '#c2603f',
    fill: '#e79b74',
  },
  shoal: {
    id: 'shoal',
    label: 'Banks & shoals',
    hint: 'Shoals, banks and shallow ground',
    colour: '#a87c36',
    fill: '#d8b273',
  },
  danger: {
    id: 'danger',
    label: 'Danger & restricted areas',
    hint: 'Restricted and caution areas',
    colour: '#c22b2b',
    fill: '#e57373',
  },
  military: {
    id: 'military',
    label: 'Military & test areas',
    hint: 'Danger areas, ranges, naval bases and test sites',
    colour: '#8a2b2b',
    fill: '#c97b7b',
  },
};

const GROUP_IDS = new Set<string>(MARINE_AREA_GROUPS as string[]);

/** Drop unknown or repeated ids from a stored hidden list. */
export function sanitizeHiddenAreaGroups(value: unknown): MarineAreaGroup[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: MarineAreaGroup[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || !GROUP_IDS.has(entry) || seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry as MarineAreaGroup);
  }
  return out;
}

export function isAreaGroupHidden(hidden: readonly MarineAreaGroup[], group: MarineAreaGroup): boolean {
  return hidden.includes(group);
}

export function toggleAreaGroup(
  hidden: readonly MarineAreaGroup[],
  group: MarineAreaGroup,
): MarineAreaGroup[] {
  return hidden.includes(group)
    ? hidden.filter((entry) => entry !== group)
    : [...hidden, group];
}

/** Groups a feature can belong to, in menu order, for a legend summary. */
export function marineAreaGroups(shapes: readonly (MarineAreaGroup | undefined)[]): MarineAreaGroup[] {
  const present = new Set(shapes.filter(Boolean) as MarineAreaGroup[]);
  return MARINE_AREA_GROUPS.filter((group) => present.has(group));
}
