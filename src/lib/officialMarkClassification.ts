import type { NavaidCategory, NavaidForm } from './navaidTypes';

/**
 * Classification for official light-list records (CCG, USCG).
 *
 * Both lists describe the physical aid in the name and the structure text
 * ("Yellow, ODAS, marked 46036", "Red nun."), but the loaders used to
 * ignore all of it and map every row to a minor light. A record that says
 * it is a buoy is a buoy; a record that says pile or dolphin is a pile.
 * The light colour (or, failing that, the structure colour) decides the
 * buoy's class, so a green buoy with a green light renders green and a
 * yellow ODAS buoy renders as a special mark. Records that name no
 * structure at all — towers, buildings, range lights — stay minor lights.
 * A record named as a lighthouse draws as the lighthouse tower, and a
 * named sector or directional light draws as the sector beacon.
 */
export interface OfficialMarkInput {
  /** Aid name, e.g. "South Nomad ODAS light buoy 46036". */
  name: string | null;
  /**
   * Structure text only: the CCG description or the USCG desc field.
   * The CCG location is deliberately NOT passed here: a place name such
   * as "Red Island" is not the mark's colour.
   */
  description: string | null;
  /** Light colour as recorded: CCG single letters (Y, R, G, W, Bu) or USCG words. */
  lightColour: string | null;
  /**
   * Whether the record carries a light at all. The loaders pass it from
   * the record's colour/character/light fields; when it is absent the
   * pile rule falls back to whether a light colour was recorded.
   * It decides the pile split: a pile with a light is a lighted pile.
   */
  lit?: boolean;
}

export interface OfficialMarkClass {
  category: NavaidCategory;
  form: NavaidForm;
  /** Structure colour word for the glyph and the card, or null when unknown. */
  colour: string | null;
  /** Structure shape word for the card, or null when unstated. */
  shape: string | null;
}

const LETTER_TO_WORD: Record<string, string> = {
  r: 'red',
  g: 'green',
  w: 'white',
  y: 'yellow',
  bu: 'blue',
  vi: 'violet',
  or: 'orange',
};

const COLOUR_WORDS = new Set([
  'red', 'green', 'yellow', 'white', 'black', 'orange', 'blue', 'violet', 'magenta',
]);

const SHAPE_WORDS: [RegExp, string][] = [
  [/\bnuns?\b/, 'conical'],
  [/\bcans?\b/, 'can'],
  [/\bspars?\b/, 'spar'],
  [/\bpillars?\b/, 'pillar'],
  [/\bspheres?\b/, 'sphere'],
  [/\bbarrels?\b/, 'barrel'],
  [/\bcylinders?\b/, 'cylinder'],
];

/** First recognised colour in a value: letters mapped to words, words as-is. */
function firstColour(value: string | null): string | null {
  for (const token of (value ?? '').toLowerCase().split(/[^a-z]+/)) {
    if (!token) continue;
    if (LETTER_TO_WORD[token]) return LETTER_TO_WORD[token];
    if (COLOUR_WORDS.has(token)) return token;
  }
  return null;
}

function allColours(value: string | null): Set<string> {
  const found = new Set<string>();
  for (const token of (value ?? '').toLowerCase().split(/[^a-z]+/)) {
    if (!token) continue;
    if (LETTER_TO_WORD[token]) found.add(LETTER_TO_WORD[token]);
    else if (COLOUR_WORDS.has(token)) found.add(token);
  }
  return found;
}

function shapeIn(description: string | null): string | null {
  const text = (description ?? '').toLowerCase();
  for (const [pattern, shape] of SHAPE_WORDS) {
    if (pattern.test(text)) return shape;
  }
  return null;
}

function hasWord(text: string, word: string): boolean {
  return new RegExp(`\\b${word}s?\\b`).test(text);
}

/** Purpose words that mark a buoy as special rather than lateral. */
const SPECIAL_PHRASES = [
  'odas',
  'dart',
  'scientific',
  'research',
  'environmental',
  'tsunami',
  'wave recorder',
  'wave rider',
  'waverider',
  'traffic separation',
  'noaa',
  'scripps',
  'institute',
  'university',
  'measurement',
  'current meter',
  'tide gauge',
];

const CARDINAL_DIRECTIONS: [RegExp, NavaidCategory][] = [
  [/\bnorth\b/, 'cardinal_north'],
  [/\bsouth\b/, 'cardinal_south'],
  [/\beast\b/, 'cardinal_east'],
  [/\bwest\b/, 'cardinal_west'],
];

export function classifyOfficialMark(input: OfficialMarkInput): OfficialMarkClass {
  const name = input.name ?? '';
  const description = input.description ?? '';
  const text = `${name} ${description}`.toLowerCase();
  const lightWord = firstColour(input.lightColour);
  const descColour = firstColour(description);
  const colour = lightWord ?? descColour;
  const shape = shapeIn(description);

  // A named lighthouse is the lighthouse tower, not a minor light. The name
  // must END with Lighthouse: "Lighthouse Channel" buoys, "Lighthouse Point"
  // lights and "Lighthouse Beach" are place names, and wreck and breakwater
  // lights at a lighthouse site are not the lighthouse itself.
  const trimmedName = name.trim().toLowerCase();
  if (trimmedName.endsWith('lighthouse') && !text.includes('wreck') && !text.includes('breakwater')) {
    return { category: 'lighthouse', form: 'landmark', colour: null, shape: null };
  }
  // A named sector or directional light is a sector light, drawn as the
  // sector beacon — unless it is a buoy (a sector buoy stays a buoy) or a
  // gate light (a barrier light that happens to carry "sector" in its name).
  if (!hasWord(text, 'buoy') && !text.includes('gate') &&
    (text.includes('sector') || text.includes('directional'))) {
    return { category: 'sector_beacon', form: 'light', colour, shape };
  }
  // A light standing on a pile or a dolphin is the pile, not a minor light.
  // The two halves are separate categories so the menu can filter lighted
  // piles from unlit ones. These lists are lit-aid lists, so a pile here
  // is lighted unless the record says otherwise.
  if (hasWord(text, 'pile') || hasWord(text, 'dolphin')) {
    const lit = input.lit ?? Boolean(lightWord);
    return { category: lit ? 'pile_lit' : 'pile_unlit', form: 'beacon', colour, shape };
  }
  // A daybeacon is a fixed board, not a floating mark and not a light.
  if (text.includes('daybeacon') || text.includes('day beacon')) {
    return { category: 'lateral_other', form: 'beacon', colour, shape };
  }
  if (!hasWord(text, 'buoy')) {
    return { category: 'light', form: 'light', colour: null, shape: null };
  }

  // Buoy classes, most specific first. Cardinals and isolated dangers carry
  // white lights by construction, so they must be caught before the colour
  // branches below, which would otherwise read them as generic buoys.
  if (text.includes('cardinal')) {
    for (const [pattern, category] of CARDINAL_DIRECTIONS) {
      if (pattern.test(text)) return { category, form: 'buoy', colour, shape };
    }
  }
  if (text.includes('isolated danger')) {
    return { category: 'isolated_danger', form: 'buoy', colour, shape };
  }
  if (SPECIAL_PHRASES.some((phrase) => text.includes(phrase))) {
    return { category: 'special_purpose', form: 'buoy', colour, shape };
  }
  if (text.includes('fairway') || text.includes('mid-channel') || text.includes('midchannel')) {
    return { category: 'safe_water', form: 'buoy', colour, shape };
  }
  if (lightWord === 'red' || lightWord === 'green') {
    return { category: 'lateral_other', form: 'buoy', colour, shape };
  }
  if (lightWord === 'white') {
    const descColours = allColours(description);
    if (descColours.has('red') && descColours.has('white')) {
      return { category: 'safe_water', form: 'buoy', colour, shape };
    }
  }
  if (descColour === 'red' || descColour === 'green') {
    return { category: 'lateral_other', form: 'buoy', colour, shape };
  }
  if (descColour === 'yellow') {
    return { category: 'special_purpose', form: 'buoy', colour, shape };
  }
  // A buoy with no usable colour signal is still a buoy: draw it in the
  // colour the record gives it (or grey when it gives none), never as a
  // minor light standing on nothing.
  return { category: 'lateral_other', form: 'buoy', colour, shape };
}
