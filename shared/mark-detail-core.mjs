/**
 * Mark detail extraction.
 *
 * The worldwide mark archive was built from a planet snapshot that kept only a
 * handful of seamark fields, so most marks arrive with a name, a category and
 * nothing else. The OpenStreetMap objects these marks come from carry the rest
 * of the charted detail — topmark, shape, colour pattern, structure, height,
 * light reference, operator and so on — in their tags.
 *
 * This module turns a raw tag set into the fields the chart stores, plus a
 * `details` map of everything else, so the same extraction can run in the index
 * builder (worldwide, offline) and on a live viewport query.
 */

/** Tags whose value maps straight onto a field the mark already stores. */
const TYPED_TAGS = {
  'seamark:name': 'name',
  'seamark:type': 'markType',
  'seamark:colour': 'colour',
  'seamark:colour_pattern': 'colourPattern',
  'seamark:shape': 'shape',
  'seamark:topmark:shape': 'topmarkShape',
  'seamark:topmark:colour': 'topmarkColour',
  'seamark:height': 'height',
  'seamark:light:range': 'range',
  'seamark:light:character': 'lightCharacter',
  'seamark:light:colour': 'lightColour',
  'seamark:light:group': 'lightGroup',
  'seamark:light:period': 'lightPeriod',
  'seamark:light:sequence': 'lightSequence',
  'seamark:light:category': 'lightCategory',
  'seamark:buoy_lateral:system': 'buoyageSystem',
  'seamark:beacon_lateral:system': 'buoyageSystem',
};

/** Keys already rendered as their own card row, so they are not repeated. */
const TYPED_KEYS = new Set(Object.keys(TYPED_TAGS));

/** Numbered light records belong to the sector index, not the detail list. */
const NUMBERED_LIGHT = /^seamark:light:\d+:/;

const text = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined);

/**
 * The per-type category tag (`seamark:buoy_lateral:category`) is the mark's own
 * classification rather than a shared field, so it is picked out by type.
 */
function typeCategory(tags, type) {
  if (!type) return undefined;
  return text(tags[`seamark:${type}:category`]);
}

/**
 * Pull the fields a mark stores out of a tag set, with everything else kept as
 * raw `details` entries for the card. Sector-bearing and signal tags stay in the
 * details, because they are also carried by their own indices.
 * @param {Record<string, string | undefined> | null | undefined} tags
 * @returns {{ fields: Record<string, string>, details: Record<string, string> }}
 */
export function markDetailFields(tags) {
  const source = tags ?? {};
  const fields = {};
  for (const [tag, field] of Object.entries(TYPED_TAGS)) {
    const value = text(source[tag]);
    if (value !== undefined) fields[field] = value;
  }
  if (fields.name === undefined) {
    const name = text(source.name);
    if (name !== undefined) fields.name = name;
  }
  const type = text(source['seamark:type']);
  const markCategory = typeCategory(source, type);
  if (markCategory !== undefined) fields.markCategory = markCategory;
  // The per-type category tag is the field above, so it is not repeated below.
  const typeCategoryKey = type ? `seamark:${type}:category` : undefined;

  const details = {};
  for (const [key, raw] of Object.entries(source)) {
    const value = text(raw);
    if (value === undefined) continue;
    if (TYPED_KEYS.has(key)) continue;
    if (NUMBERED_LIGHT.test(key)) continue;
    if (key === 'name' || key === typeCategoryKey) continue;
    details[key] = value;
  }

  return { fields, details };
}

/**
 * Card label for a raw OpenStreetMap tag key.
 * @param {string} key
 * @returns {string}
 */
export function markDetailLabel(key) {
  return key
    .replace(/^seamark:/, '')
    .replace(/^bridge:/, 'bridge ')
    .replace(/[:]/g, ' ')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (character) => character.toUpperCase());
}

/**
 * Card rows for a mark's details, with the label each key reads as.
 * @param {Record<string, string> | null | undefined} details
 * @returns {[string, string][]}
 */
export function markDetailRows(details) {
  if (!details) return [];
  return Object.entries(details)
    .filter(([, value]) => typeof value === 'string' && value.trim() !== '')
    .map(([key, value]) => [markDetailLabel(key), value.trim()])
    .sort(([a], [b]) => a.localeCompare(b));
}
