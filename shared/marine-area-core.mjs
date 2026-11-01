/**
 * Marine-area classification and geometry helpers.
 *
 * The chart's area overlay comes from OpenStreetMap, where one physical thing is
 * tagged in many ways: a marine protected area is a `boundary=protected_area`
 * relation carrying a designation, a firing range is `military=danger_area`, a
 * reef is `natural=reef`, and a charted restricted area is a seamark type. The
 * classification and geometry helpers live here so the server proxy, the chart
 * parser and the menu all agree on what a feature is and which toggle owns it.
 */

/** Overlay groups a user can switch on and off. */
export const MARINE_AREA_GROUPS = ['protected', 'conservation', 'reef', 'shoal', 'danger', 'military'];

const MILITARY_VALUES = new Set([
  'danger_area', 'training_area', 'naval_base', 'test_range', 'range', 'airfield', 'barracks',
]);

const RESTRICTED_SEAMARK_TYPES = new Set([
  'restricted_area', 'caution_area', 'anchoring_prohibited', 'no_anchoring', 'firing_danger_area',
]);

/** Wording that marks a protected site as a conservation designation rather than a park. */
const CONSERVATION_WORDING = /(special area of conservation|special protection area|conservation|marine protected|highly protected|no[- ]?take|ecological|migratory|species|habitat|biodiversity|ramsar|biosphere|wildlife refuge|sanctuary)/i;

const text = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined);

/**
 * Whether an OSM element is an area the chart should draw as a marine-area
 * feature, and which toggle owns it. Returns null for anything else.
 * @param {Record<string, string | undefined> | null | undefined} tags
 * @returns {{ group: string, label: string } | null}
 */
export function classifyMarineArea(tags) {
  const source = tags ?? {};
  const seamarkType = text(source['seamark:type'])?.toLowerCase();
  const natural = text(source.natural)?.toLowerCase();
  const military = text(source.military)?.toLowerCase();

  if (military && MILITARY_VALUES.has(military)) {
    return { group: 'military', label: militaryLabel(military) };
  }
  if (text(source.landuse)?.toLowerCase() === 'military' && military) {
    return { group: 'military', label: militaryLabel(military) };
  }
  if (seamarkType && RESTRICTED_SEAMARK_TYPES.has(seamarkType)) {
    return { group: 'danger', label: seamarkType === 'caution_area' ? 'Caution area' : 'Restricted area' };
  }
  if (natural === 'reef' || seamarkType === 'reef') {
    return { group: 'reef', label: 'Reef' };
  }
  if (natural === 'shoal' || natural === 'bank' || seamarkType === 'shoal' || seamarkType === 'bank') {
    return { group: 'shoal', label: natural === 'bank' || seamarkType === 'bank' ? 'Bank' : 'Shoal' };
  }

  const designation = [
    source.designation,
    source.protection_title,
    source['seamark:name'],
    source.name,
    source.description,
  ].map(text).filter(Boolean).join(' · ');
  const protectedSite =
    text(source.boundary)?.toLowerCase() === 'protected_area' ||
    text(source.boundary)?.toLowerCase() === 'national_park' ||
    text(source.leisure)?.toLowerCase() === 'nature_reserve' ||
    text(source.protect_class) !== undefined;
  if (!protectedSite) return null;
  const conservation = CONSERVATION_WORDING.test(designation);
  return {
    group: conservation ? 'conservation' : 'protected',
    label: text(source.protection_title) ?? text(source.designation) ?? (conservation ? 'Conservation area' : 'Protected area'),
  };
}

function militaryLabel(value) {
  switch (value) {
    case 'danger_area': return 'Danger area';
    case 'training_area': return 'Military training area';
    case 'naval_base': return 'Naval base';
    case 'test_range':
    case 'range': return 'Test and evaluation range';
    default: return 'Military area';
  }
}

/**
 * Every line an OSM element provides.
 *
 * A way arrives with one `geometry` array. A relation arrives with its members'
 * geometry instead, which is why a protected-area or sea relation used to be
 * dropped entirely: it has no `geometry` of its own. Both are returned as
 * `[lat, lon]` paths.
 * @param {{ geometry?: { lat: number, lon: number }[], members?: { geometry?: { lat: number, lon: number }[] }[] }} element
 * @returns {[number, number][][]}
 */
export function elementPaths(element) {
  const paths = [];
  const push = (geometry) => {
    if (!Array.isArray(geometry) || geometry.length === 0) return;
    const path = geometry
      .filter((point) => Number.isFinite(point?.lat) && Number.isFinite(point?.lon))
      .map((point) => [point.lat, point.lon]);
    if (path.length > 1) paths.push(path);
  };
  push(element?.geometry);
  for (const member of element?.members ?? []) push(member?.geometry);
  return paths;
}

const near = (a, b, tolerance) =>
  Math.abs(a[0] - b[0]) <= tolerance && Math.abs(a[1] - b[1]) <= tolerance;

/**
 * Join member ways into complete lines and closed rings.
 *
 * A relation's boundary is mapped as many separate ways; drawn as-is it appears
 * as a dashed spray of fragments instead of one outline. Ways are joined
 * end-to-end when their endpoints meet, which closes the ring wherever OSM
 * actually holds one.
 * @param {[number, number][][]} paths
 * @param {number} [tolerance] degrees of slack when matching endpoints
 * @returns {[number, number][][]}
 */
export function stitchPaths(paths, tolerance = 1e-6) {
  const remaining = paths.filter((path) => path.length > 1).map((path) => path.slice());
  const joined = [];
  while (remaining.length > 0) {
    const current = remaining.shift();
    let extended = true;
    while (extended) {
      extended = false;
      const head = current[0];
      const tail = current[current.length - 1];
      if (near(head, tail, tolerance) && current.length > 2) break;
      for (let index = 0; index < remaining.length; index += 1) {
        const candidate = remaining[index];
        const candidateHead = candidate[0];
        const candidateTail = candidate[candidate.length - 1];
        if (near(tail, candidateHead, tolerance)) {
          current.push(...candidate.slice(1));
        } else if (near(tail, candidateTail, tolerance)) {
          current.push(...candidate.slice(0, -1).reverse());
        } else if (near(head, candidateTail, tolerance)) {
          current.unshift(...candidate.slice(0, -1));
        } else if (near(head, candidateHead, tolerance)) {
          current.unshift(...candidate.slice(1).reverse());
        } else {
          continue;
        }
        remaining.splice(index, 1);
        extended = true;
        break;
      }
    }
    joined.push(current);
  }
  return joined;
}

/** A joined path that returns to its start. */
export function isClosedPath(path) {
  if (!Array.isArray(path) || path.length < 4) return false;
  const first = path[0];
  const last = path[path.length - 1];
  return Math.abs(first[0] - last[0]) <= 1e-7 && Math.abs(first[1] - last[1]) <= 1e-7;
}

/**
 * Split stitched paths into closed rings and open lines. Rings can be filled;
 * lines are drawn as outlines only.
 * @param {[number, number][][]} paths
 * @returns {{ rings: [number, number][][], lines: [number, number][][] }}
 */
export function ringsAndLines(paths) {
  const rings = [];
  const lines = [];
  for (const path of stitchPaths(paths)) {
    if (isClosedPath(path)) rings.push(path);
    else lines.push(path);
  }
  return { rings, lines };
}
