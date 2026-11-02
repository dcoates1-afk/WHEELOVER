import {
  formatDepthWithUnit,
  formatDistance,
  type DepthUnit,
  type DistanceUnit,
} from './settings';

/** One labelled value in the bridge card. */
export interface BridgeRow {
  label: string;
  value: string;
}

export interface BridgeSection {
  title: string;
  rows: BridgeRow[];
}

export interface BridgeDescription {
  title: string;
  subtitle: string;
  /** The crossing itself: what it spans, how much room is under it, what it is. */
  facts: BridgeRow[];
  sections: BridgeSection[];
  links: { label: string; url: string }[];
  /** Keys already shown above, so the record section holds only the remainder. */
  shownKeys: string[];
}

export interface BridgeFeatureLike {
  name: string;
  properties?: Record<string, string> | null;
  sourceUrl?: string;
  /** Every mapped record folded into this crossing. */
  sourceUrls?: string[];
}

export interface BridgeUnits {
  depth: DepthUnit;
  distance: DistanceUnit;
}

const MOVABLE_KINDS: Record<string, string> = {
  swing: 'Swing bridge',
  bascule: 'Bascule bridge',
  lift: 'Lifting bridge',
  drawbridge: 'Drawbridge',
  transporter: 'Transporter bridge',
  submersible: 'Submersible bridge',
  tilt: 'Tilting bridge',
  retractable: 'Retractable bridge',
};

const STRUCTURES: Record<string, string> = {
  suspension: 'Suspension bridge',
  arch: 'Arch bridge',
  beam: 'Beam bridge',
  truss: 'Truss bridge',
  cantilever: 'Cantilever bridge',
  cable_stayed: 'Cable-stayed bridge',
  viaduct: 'Viaduct',
  aqueduct: 'Aqueduct',
  covered: 'Covered bridge',
  floating: 'Floating bridge',
  pontoon: 'Pontoon bridge',
};

const CARRYING: Record<string, string> = {
  motorway: 'Motorway bridge',
  trunk: 'Trunk road bridge',
  primary: 'Primary road bridge',
  secondary: 'Secondary road bridge',
  tertiary: 'Tertiary road bridge',
  residential: 'Street bridge',
  unclassified: 'Road bridge',
  service: 'Service road bridge',
  track: 'Track bridge',
  path: 'Footbridge',
  footway: 'Footbridge',
  pedestrian: 'Footbridge',
  cycleway: 'Cycle bridge',
  steps: 'Step bridge',
  bridleway: 'Bridleway bridge',
  rail: 'Railway bridge',
  light_rail: 'Light rail bridge',
  tram: 'Tram bridge',
  subway: 'Metro bridge',
  narrow_gauge: 'Narrow gauge railway bridge',
  miniature: 'Miniature railway bridge',
};

/**
 * Every parseable measurement in a value, formatted in the chosen units.
 * Merged records join distinct values with " / ", so each one is shown
 * rather than only the first. Returns null when nothing in the value parses.
 */
function formatMetresList(value: string, format: (metres: number) => string): string | null {
  const formatted = value
    .split(' / ')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part) => {
      const metres = measuredMetres(part);
      return metres === null ? null : format(metres);
    })
    .filter((part): part is string => part !== null);
  if (formatted.length === 0) return null;
  return [...new Set(formatted)].join(' / ');
}

/** A mapped measurement, in metres, honouring the few imperial spellings OSM uses. */
export function measuredMetres(value: string | null | undefined): number | null {
  if (!value) return null;
  // Feet and inches written together (`16'6"`) are one measurement, not two.
  const feetInches = value.match(/(\d+(?:[.,]\d+)?)\s*['′]\s*(\d+(?:[.,]\d+)?)\s*["″]/);
  if (feetInches) {
    const feet = Number(feetInches[1].replace(',', '.'));
    const inches = Number(feetInches[2].replace(',', '.'));
    if (Number.isFinite(feet) && Number.isFinite(inches)) return feet * 0.3048 + inches * 0.0254;
  }
  const match = value.match(/-?\d+(?:[.,]\d+)?/);
  if (!match) return null;
  const number = Number(match[0].replace(',', '.'));
  if (!Number.isFinite(number)) return null;
  return /ft|feet|′|'|inches|in\b/i.test(value) ? number * 0.3048 : number;
}

function label(key: string): string {
  const cleaned = key
    .replace(/^seamark:bridge:/, '')
    .replace(/^seamark:/, '')
    .replace(/^bridge:/, '');
  const words = cleaned.replace(/[_:]/g, ' ').replace(/\s+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function value(tags: Record<string, string>, ...keys: string[]): string | null {
  for (const key of keys) {
    const raw = tags[key];
    if (typeof raw === 'string' && raw.trim() !== '') return raw.trim();
  }
  return null;
}

function bridgeKind(tags: Record<string, string>): string | null {
  const movable = tags['bridge:movable'] ?? (tags.bridge !== 'yes' && tags.bridge !== 'no' ? tags.bridge : undefined);
  if (movable) {
    const known = MOVABLE_KINDS[movable.toLowerCase()];
    if (known) return known;
  }
  const structure = tags['bridge:structure'];
  if (structure) {
    const known = STRUCTURES[structure.toLowerCase()];
    if (known) return known;
  }
  const type = tags['bridge:type'] ?? tags['seamark:bridge:category'];
  if (type) return `${label(type)} bridge`;
  return null;
}

/**
 * Fixed, raising or rotating: the three operations a boater plans around.
 * A swing bridge rotates out of the way; bascule, lifting, drawbridge and
 * tilting bridges raise; other mapped movable kinds (transporter,
 * submersible, retractable, or a seamark "opening" bridge) read as Movable;
 * anything else mapped — a viaduct, a plain road bridge — is Fixed.
 */
function bridgeOperation(tags: Record<string, string>): string {
  const movable = (
    tags['bridge:movable'] ??
    (tags.bridge !== 'yes' && tags.bridge !== 'no' ? tags.bridge : undefined) ??
    tags['seamark:bridge:category'] ??
    ''
  ).toLowerCase();
  if (movable === 'swing') return 'Rotating';
  if (movable === 'bascule' || movable === 'lift' || movable === 'drawbridge' || movable === 'tilt') return 'Raising';
  if (movable === 'opening' || movable in MOVABLE_KINDS) return 'Movable';
  return 'Fixed';
}

function carrying(tags: Record<string, string>): string | null {
  const highway = tags.highway?.toLowerCase();
  if (highway && CARRYING[highway]) return CARRYING[highway];
  const railway = tags.railway?.toLowerCase();
  if (railway && CARRYING[railway]) return CARRYING[railway];
  if (highway) return `${label(highway)} bridge`;
  if (railway) return `${label(railway)} bridge`;
  return null;
}

/** Wikidata and Wikipedia values are ids and article titles, not URLs. */
function referenceLinks(tags: Record<string, string>): { label: string; url: string }[] {
  const links: { label: string; url: string }[] = [];
  const wikidata = tags.wikidata;
  if (wikidata && /^Q\d+$/.test(wikidata)) {
    links.push({ label: 'Wikidata', url: `https://www.wikidata.org/wiki/${wikidata}` });
  }
  const wikipedia = tags.wikipedia;
  if (wikipedia) {
    const match = wikipedia.match(/^([a-z-]+):(.+)$/);
    if (match) {
      links.push({
        label: 'Wikipedia',
        url: `https://${match[1]}.wikipedia.org/wiki/${encodeURIComponent(match[2].replace(/ /g, '_'))}`,
      });
    }
  }
  return links;
}

/**
 * Everything a mapped bridge record says, arranged for a chart card.
 *
 * OpenStreetMap holds a bridge's clearance, its movable type, what it carries,
 * who operates it and what restricts it, but spread over dozens of tags with
 * machine names. The card groups them, converts the measurements into the units
 * chosen in Settings, and keeps every remaining tag so nothing mapped is lost.
 */
export function describeBridge(feature: BridgeFeatureLike, units: BridgeUnits): BridgeDescription {
  const tags = feature.properties ?? {};
  const shownKeys: string[] = [];

  const facts: BridgeRow[] = [];
  const water = value(tags, 'water crossed');
  if (water) {
    shownKeys.push('water crossed');
    facts.push({ label: 'Crosses', value: water });
  }

  const clearanceHeightRaw = value(tags, 'seamark:bridge:clearance_height');
  const clearanceHeight = clearanceHeightRaw === null
    ? null
    : formatMetresList(clearanceHeightRaw, (metres) => formatDepthWithUnit(metres, units.depth));
  if (clearanceHeight !== null) {
    shownKeys.push('seamark:bridge:clearance_height');
    facts.push({ label: 'Vertical clearance', value: clearanceHeight });
  }
  const clearanceWidthRaw = value(tags, 'seamark:bridge:clearance_width');
  const clearanceWidth = clearanceWidthRaw === null
    ? null
    : formatMetresList(clearanceWidthRaw, (metres) => formatDistance(metres, units.distance));
  if (clearanceWidth !== null) {
    shownKeys.push('seamark:bridge:clearance_width');
    facts.push({ label: 'Horizontal clearance', value: clearanceWidth });
  }

  const kind = bridgeKind(tags);
  if (kind) {
    shownKeys.push('bridge:movable', 'bridge:structure', 'bridge:type', 'seamark:bridge:category');
    facts.push({ label: 'Type', value: kind });
  }
  facts.push({ label: 'Operation', value: bridgeOperation(tags) });
  const carries = carrying(tags);
  if (carries) facts.push({ label: 'Carrying', value: carries });

  const clearance: BridgeRow[] = [];
  const clearanceRows: [string, string][] = [
    ['Closed clearance', 'seamark:bridge:clearance_height_closed'],
    ['Open clearance', 'seamark:bridge:clearance_height_open'],
  ];
  for (const [rowLabel, key] of clearanceRows) {
    const raw = tags[key];
    if (!raw) continue;
    const formatted = formatMetresList(raw, (metres) => formatDepthWithUnit(metres, units.depth));
    if (formatted === null) continue;
    shownKeys.push(key);
    clearance.push({ label: rowLabel, value: formatted });
  }
  const maxHeight = tags.maxheight;
  if (maxHeight) {
    shownKeys.push('maxheight');
    clearance.push({
      label: 'Maximum height',
      value: formatMetresList(maxHeight, (metres) => formatDepthWithUnit(metres, units.depth)) ?? maxHeight,
    });
  }
  const width = value(tags, 'seamark:bridge:clearance_width_open');
  if (width) {
    shownKeys.push('seamark:bridge:clearance_width_open');
    clearance.push({
      label: 'Open width',
      value: formatMetresList(width, (metres) => formatDistance(metres, units.distance)) ?? width,
    });
  }

  const structure: BridgeRow[] = [];
  const structureFields: [string, string][] = [
    ['Structure', 'bridge:structure'],
    ['Movable type', 'bridge:movable'],
    ['Deck width', 'width'],
    ['Span', 'bridge:span'],
    ['Length', 'length'],
    ['Height', 'height'],
    ['Operator', 'operator'],
    ['Owner', 'owner'],
    ['Reference', 'ref'],
    ['Bridge reference', 'bridge:ref'],
    ['Layer', 'layer'],
  ];
  for (const [rowLabel, key] of structureFields) {
    const found = value(tags, key);
    if (!found) continue;
    shownKeys.push(key);
    const isMeasurement = ['width', 'bridge:span', 'length', 'height'].includes(key);
    const formatted = isMeasurement
      ? formatMetresList(found, (metres) => key === 'height'
        ? formatDepthWithUnit(metres, units.depth)
        : formatDistance(metres, units.distance))
      : null;
    structure.push({ label: rowLabel, value: formatted ?? found });
  }

  const carryingRows: BridgeRow[] = [];
  const carryingFields: [string, string][] = [
    ['Road class', 'highway'],
    ['Railway', 'railway'],
    ['Route number', 'ref'],
    ['Lanes', 'lanes'],
    ['Surface', 'surface'],
    ['Max speed', 'maxspeed'],
    ['Electrified', 'electrified'],
    ['Voltage', 'voltage'],
    ['Gauge', 'gauge'],
    ['Usage', 'usage'],
  ];
  for (const [rowLabel, key] of carryingFields) {
    const found = value(tags, key);
    // A field already shown under Structure (for example the route reference)
    // is not repeated in a second section.
    if (!found || structure.some((row) => row.label === rowLabel)) continue;
    shownKeys.push(key);
    carryingRows.push({ label: rowLabel, value: found });
  }

  const restrictions: BridgeRow[] = [];
  const restrictionFields: [string, string][] = [
    ['Max weight', 'maxweight'],
    ['Max weight rating', 'maxweightrating'],
    ['Max axle load', 'maxaxleload'],
    ['Max width', 'maxwidth'],
    ['Max length', 'maxlength'],
    ['Access', 'access'],
    ['Opening hours', 'opening_hours'],
    ['Lit', 'lit'],
  ];
  for (const [rowLabel, key] of restrictionFields) {
    const found = value(tags, key);
    if (!found) continue;
    shownKeys.push(key);
    restrictions.push({ label: rowLabel, value: found });
  }

  const dates: BridgeRow[] = [];
  for (const [rowLabel, key] of [
    ['Built', 'start_date'],
    ['Opened', 'opening_date'],
    ['Rebuilt', 'bridge:date'],
    ['Heritage', 'heritage'],
  ] as [string, string][]) {
    const found = value(tags, key);
    if (!found) continue;
    shownKeys.push(key);
    dates.push({ label: rowLabel, value: found });
  }

  const sections: BridgeSection[] = [];
  if (clearance.length > 0) sections.push({ title: 'Air and water draught', rows: clearance });
  if (structure.length > 0) sections.push({ title: 'Structure and operator', rows: structure });
  if (carryingRows.length > 0) sections.push({ title: 'Carrying', rows: carryingRows });
  if (restrictions.length > 0) sections.push({ title: 'Restrictions and access', rows: restrictions });
  if (dates.length > 0) sections.push({ title: 'Dates and status', rows: dates });

  // Anything the groups above did not name still belongs on the card, so no
  // mapped detail is silently dropped.
  const seen = new Set(shownKeys);
  const remaining = Object.entries(tags)
    .filter(([key, raw]) => !seen.has(key) && !['name', 'bridge:name', 'seamark:name', 'water crossed'].includes(key) && raw.trim() !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, raw]) => ({ label: label(key), value: raw }));
  if (remaining.length > 0) sections.push({ title: 'Other mapped detail', rows: remaining });

  const title = value(tags, 'bridge:name') ?? feature.name;
  const subtitle = kind ?? carries ?? 'Bridge';

  const links = referenceLinks(tags);
  const sourceUrls = feature.sourceUrls ?? (feature.sourceUrl ? [feature.sourceUrl] : []);
  for (const url of [...new Set(sourceUrls)].reverse()) {
    links.unshift({ label: 'OSM feature', url });
  }

  return { title, subtitle, facts, sections, links, shownKeys };
}
