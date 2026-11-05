/**
 * WHEELOVER shared chart core.
 *
 * Plain ESM so the browser app, the vitest suite and the offline database
 * builder all run the *same* classification code. If ingest and rendering
 * disagree about what a mark is, marks silently disappear, so this file is the
 * single source of truth for that decision.
 *
 * Type declarations live in navaid-core.d.ts.
 */

export const DEFAULT_CELL_SIZE = 0.25;
export const DEDUPE_DISTANCE_M = 40;
export const SHOW_ALL_LIMIT = 2000;
export const DEFAULT_MARK_LIMIT = 900;

const AREA_TYPES = new Set([
  'cable_submarine',
  'pipeline_submarine',
  'restricted_area',
  'fairway',
  'sea_area',
  'dumping_ground',
  'precautionary_area',
  'recommended_track',
  'navigation_line',
  'ferry_route',
  'shoreline_construction',
  'cable_area',
  'pipeline_area',
  'production_area',
  'military_area',
  'safety_area',
]);

const PRIORITY = {
  major_light: 100,
  range: 96,
  // Transit (leading) lights define the line to steer; they belong beside the
  // ranges and above every buoy in the declutter order.
  transit_front: 88,
  transit_rear: 88,
  isolated_danger: 94,
  safe_water: 92,
  cardinal_north: 90,
  cardinal_east: 90,
  cardinal_south: 90,
  cardinal_west: 90,
  cardinal_unspecified: 80,
  preferred_channel_port: 86,
  preferred_channel_starboard: 86,
  lateral_starboard: 84,
  lateral_port: 84,
  hazard_danger: 78,
  // Calling-in points are harbour-control reporting lines, so they matter as
  // much as a buoy when planning an approach through a narrow pass.
  calling_in_point: 76,
  communication_area: 72,
  // Anchorage grounds outrank generic hazards: they are where a passage ends
  // for the night, so dropping them in a dense harbour is the wrong trade.
  anchorage: 74,
  // A charted wreck is not just another hazard: it keeps its own class and
  // symbol, and outranks rocks and obstructions when the chart declutters.
  wreck: 71,
  anchor_berth: 73,
  light: 66,
  hazard: 60,
  lateral_other: 55,
  special_purpose: 50,
  landmark: 44,
  marina: 40,
  notice: 34,
  facility: 30,
  mooring: 14,
  gate: 24,
  other: 10,
  // Offshore structures: farm areas outrank rigs, rigs outrank single turbines.
  wind_farm: 70,
  oil_rig: 68,
  wind_turbine: 62,
  // A power pylon is a tall steel structure like a turbine, but it stands
  // on land or in the shallows rather than offshore.
  pylon: 61,
  // A pile is a single post in the water, often carrying a beacon or a
  // light; it ranks below the tower but above a bare cable crossing.
  pile: 59,
  // A cable crossing a channel constrains passage (clearance), so it
  // outranks generic special marks.
  cable_overhead: 58,
};

const MIN_ZOOM = {
  major_light: 7,
  range: 9,
  transit_front: 11,
  transit_rear: 11,
  isolated_danger: 11,
  safe_water: 11,
  cardinal_north: 11,
  cardinal_east: 11,
  cardinal_south: 11,
  cardinal_west: 11,
  cardinal_unspecified: 11,
  preferred_channel_port: 11,
  preferred_channel_starboard: 11,
  lateral_starboard: 13,
  lateral_port: 13,
  hazard_danger: 13,
  light: 13,
  hazard: 14,
  lateral_other: 14,
  special_purpose: 14,
  landmark: 13,
  marina: 13,
  pylon: 13,
  pile: 13,
  cable_overhead: 13,
  notice: 14,
  facility: 14,
  calling_in_point: 11,
  communication_area: 11,
  wreck: 12,
  anchorage: 12,
  anchor_berth: 12,
  mooring: 16,
  gate: 15,
  other: 15,
};

/**
 * IALA buoyage region heuristic: region B (red-to-starboard) covers the
 * Americas plus Japan, Korea, Taiwan and the Philippines. Everywhere else is
 * region A. Approximate by design, and documented as such in the README.
 */
export function ialaRegion(lat, lon) {
  if (lon >= -180 && lon <= -30) return 'B';
  if (lat >= 20 && lat <= 46 && lon >= 122 && lon <= 150) return 'B';
  return 'A';
}

function firstTag(tags, keys) {
  for (const key of keys) {
    const value = tags[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return null;
}

function formFor(type, tags) {
  if (type.startsWith('buoy') || type === 'light_float') return 'buoy';
  if (type.startsWith('beacon')) return 'beacon';
  if (type === 'lighthouse' || tags['man_made'] === 'lighthouse') return 'landmark';
  if (type.startsWith('light')) return 'light';
  if (tags['seamark:light:character'] || tags['seamark:light:1:character'] ||
    tags['seamark:light:colour'] || tags['seamark:light:1:colour']) return 'light';
  return 'mark';
}

/**
 * Seamark light categories are semicolon lists: a range light is often tagged
 * `upper;leading` or `lower;leading`, so a plain equality check misses it.
 */
function categoryTokens(category) {
  return (category || '')
    .split(';')
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
}

function isLeading(tags, type, category) {
  const tokens = categoryTokens(category);
  if (tokens.some((token) => ['leading', 'rear', 'front', 'upper', 'lower'].includes(token))) return true;
  // Range markers are often tagged only through the type or the name.
  if (type === 'leading_light' || type === 'range_marker' || type === 'leading_beacon') return true;
  const name = (tags.name || tags['seamark:name'] || '').toLowerCase();
  if (type.startsWith('light') || type.startsWith('beacon')) {
    if (/\brange\b|\bleading\b/.test(name)) return true;
  }
  return false;
}

/** Which end of the leading line the mark is: front/lower or rear/upper. */
function transitRoleFor(category) {
  const tokens = categoryTokens(category);
  if (tokens.includes('front') || tokens.includes('lower')) return 'front';
  if (tokens.includes('rear') || tokens.includes('upper')) return 'rear';
  return null;
}

function lateralCategory(category) {
  if (!category) return 'lateral_other';
  if (category === 'port') return 'lateral_port';
  if (category === 'starboard') return 'lateral_starboard';
  if (category === 'preferred_channel_port') return 'preferred_channel_port';
  if (category === 'preferred_channel_starboard') return 'preferred_channel_starboard';
  if (category.startsWith('preferred_channel')) return 'preferred_channel_port';
  return 'lateral_other';
}

/**
 * Decide what a tagged OSM seamark is, or null when it is not a point aid we
 * plot (areas, cables, shoreline features, unknown tags).
 */
export function classifyTags(tags) {
  const type = (tags['seamark:type'] || '').trim();
  const sectors = lightSectorsFromTags(tags);
  const lightChar = tags['seamark:light:character'] ?? sectors.find((sector) => sector.character)?.character;
  const category = firstTag(tags, [
    `seamark:${type}:category`,
    'seamark:category',
    'seamark:light:category',
  ]);
  const form = formFor(type, tags);
  const lit = Boolean(lightChar || tags['seamark:light:colour'] || tags['seamark:light:range'] || sectors.length);
  const leading = isLeading(tags, type, category);
  const transitRole = transitRoleFor(category);
  const base = { form, priority: PRIORITY.other, lit };

  if (!type) {
    if (tags['man_made'] === 'lighthouse') {
      return { ...base, category: 'major_light', priority: PRIORITY.major_light, lit: true };
    }
    // Wind turbines, wind farms and offshore platforms carry no seamark:type
    // in their usual tagging (power=generator/plant, man_made=offshore_platform),
    // so they are recognised here before the generic light fallback below —
    // a lit turbine is a turbine, not a generic light.
    if (tags.power === 'generator' && tags['generator:source'] === 'wind') {
      return { ...base, category: 'wind_turbine', priority: PRIORITY.wind_turbine };
    }
    if (tags.power === 'plant' && tags['plant:source'] === 'wind') {
      return { ...base, category: 'wind_farm', priority: PRIORITY.wind_farm };
    }
    if (tags['man_made'] === 'offshore_platform') {
      return { ...base, category: 'oil_rig', priority: PRIORITY.oil_rig };
    }
    if (lightChar) return { ...base, category: 'light', priority: PRIORITY.light };
    // A colour with no character is still a light: fixed harbour and pier
    // lights are often mapped with colour alone.
    if (tags['seamark:light:colour'] || tags['seamark:light:1:colour']) {
      return { ...base, category: 'light', priority: PRIORITY.light };
    }
    // Some wrecks are mapped without the seamark schema at all.
    if (tags['man_made'] === 'wreck' || tags['historic'] === 'wreck') {
      return { ...base, category: 'wreck', priority: PRIORITY.wreck };
    }
    return null;
  }

  // Anchorages, anchor berths and calling-in points are plotted as points even
  // when OSM maps them as an area or a line: the centre is the useful place.
  // They used to fall through to the null at the end of this function, which is
  // why Canadian anchor berths showed on OpenSeaMap but not in this overlay.
  if (type === 'anchorage' || type === 'anchorage_area') {
    return { ...base, category: 'anchorage', priority: PRIORITY.anchorage };
  }
  if (type === 'anchor_berth') {
    return { ...base, category: 'anchor_berth', priority: PRIORITY.anchor_berth };
  }
  if (type === 'calling_in_point' || type === 'calling-in_point') {
    return { ...base, category: 'calling_in_point', priority: PRIORITY.calling_in_point };
  }
  if (type === 'communication_area') {
    return { ...base, category: 'communication_area', priority: PRIORITY.communication_area };
  }

  // A wind-farm production area is a mark, not a dropped area — but only
  // when it is tagged as a wind farm; other production areas stay dropped.
  // Both spellings of the wind-farm production tag are accepted (the wiki
  // pages disagree). This check must sit before the area drop below.
  if (type === 'production_area' &&
    (category === 'wind_farm' || tags['seamark:landmark:production_area'] === 'wind_farm')) {
    return { ...base, category: 'wind_farm', priority: PRIORITY.wind_farm };
  }

  if (AREA_TYPES.has(type)) return null;

  // An offshore turbine mapped as a seamark landmark keeps its turbine
  // symbol even when it carries a light.
  if (type === 'landmark' && tags['seamark:landmark:category'] === 'windmotor') {
    return { ...base, category: 'wind_turbine', priority: PRIORITY.wind_turbine };
  }

  if (type === 'lighthouse' || type === 'landmark' || type === 'mast' || type === 'tower') {
    // A lighthouse is a major light, and so is any of these structures carrying
    // a mapped light. `lightChar` also covers lights mapped only as numbered
    // sector records (Hurst Point, St Catherine's Point), which the unnumbered
    // tag check used to miss and leave ranked as a plain landmark.
    if (type === 'lighthouse' || lightChar) {
      return { ...base, category: 'major_light', priority: PRIORITY.major_light, lit: true };
    }
    return { ...base, category: 'landmark', priority: PRIORITY.landmark };
  }

  if (type.startsWith('light') || type === 'leading_light') {
    if (leading && transitRole) {
      const key = `transit_${transitRole}`;
      return { ...base, category: key, priority: PRIORITY[key], lit: true };
    }
    if (leading) return { ...base, category: 'range', priority: PRIORITY.range, lit: true };
    if (type === 'light_major') return { ...base, category: 'major_light', priority: PRIORITY.major_light, lit: true };
    return { ...base, category: 'light', priority: PRIORITY.light, lit: true };
  }

  if (type.includes('lateral')) {
    const resolved = leading ? 'range' : lateralCategory(category);
    const priority = resolved === 'range' ? PRIORITY.range : PRIORITY[resolved] || PRIORITY.lateral_other;
    return { ...base, category: resolved, priority, lit: resolved === 'range' ? true : base.lit };
  }

  if (type.includes('cardinal')) {
    const side = (category || '').replace('cardinal_', '');
    const key = ['north', 'east', 'south', 'west'].includes(side) ? `cardinal_${side}` : 'cardinal_unspecified';
    return { ...base, category: key, priority: PRIORITY[key] };
  }

  if (type === 'safe_water' || type === 'buoy_safe_water' || type === 'beacon_safe_water') {
    return { ...base, category: 'safe_water', priority: PRIORITY.safe_water };
  }

  if (type.includes('isolated_danger') || type === 'isolated_danger') {
    return { ...base, category: 'isolated_danger', priority: PRIORITY.isolated_danger };
  }

  if (type.includes('special_purpose')) {
    if (leading) return { ...base, category: 'range', priority: PRIORITY.range, lit: true };
    return { ...base, category: 'special_purpose', priority: PRIORITY.special_purpose };
  }

  if (type === 'wreck') {
    // Only a wreck the source calls dangerous keeps the danger symbol; a
    // visible hull or a non-dangerous wreck is a wreck, not a generic hazard.
    const dangerous = category === 'dangerous';
    return {
      ...base,
      category: dangerous ? 'hazard_danger' : 'wreck',
      priority: dangerous ? PRIORITY.hazard_danger : PRIORITY.wreck,
    };
  }

  if (type === 'rock' || type === 'obstruction') {
    return { ...base, category: 'hazard', priority: PRIORITY.hazard };
  }

  if (type === 'harbour') {
    return { ...base, category: 'marina', priority: PRIORITY.marina };
  }

  // Offshore platforms are production structures, not generic facilities.
  if (type === 'platform') {
    return { ...base, category: 'oil_rig', priority: PRIORITY.oil_rig };
  }

  // A power pylon is a charted structure in its own right, lit or not: a
  // lit pylon keeps the tower symbol (with the light annotation on top)
  // instead of collapsing into a generic light.
  if (type === 'pylon') {
    return { ...base, category: 'pylon', priority: PRIORITY.pylon };
  }

  // A pile is a post standing in the water, lit or not: a lit pile keeps
  // the post symbol (with the light annotation on top) instead of
  // collapsing into a generic light.
  if (type === 'pile') {
    return { ...base, category: 'pile', priority: PRIORITY.pile };
  }

  // Overhead cables are line features, not points: they classify as their
  // own mark so the line draws and the clearance reaches the card.
  if (type === 'cable_overhead') {
    return { ...base, category: 'cable_overhead', priority: PRIORITY.cable_overhead };
  }

  if (
    type === 'small_craft_facility' ||
    type === 'mooring' ||
    type === 'berth' ||
    type === 'bridge' ||
    type === 'causeway' ||
    type === 'crane' ||
    type === 'building' ||
    type === 'rescue_station' ||
    type === 'coastguard_station' ||
    type === 'pilot_boarding' ||
    type === 'notice' ||
    type === 'gate'
  ) {
    if (type === 'mooring') return { ...base, category: 'mooring', priority: PRIORITY.mooring };
    if (type === 'notice') return { ...base, category: 'notice', priority: PRIORITY.notice };
    if (type === 'gate') return { ...base, category: 'gate', priority: PRIORITY.gate };
    // A bridge carrying a mapped light is charted as that light: the bridge
    // itself is already drawn by the bridge layer, so the facility dot at
    // its centre would hide the navigationally significant fact.
    if (type === 'bridge' && lit) return { ...base, category: 'light', priority: PRIORITY.light };
    return { ...base, category: 'facility', priority: PRIORITY.facility };
  }

  // Unknown but lit point marks still deserve plotting.
  if (lit && !AREA_TYPES.has(type)) {
    return { ...base, category: 'light', priority: PRIORITY.light };
  }
  return null;
}

/**
 * Compose one light from its tags: character, optional group in brackets,
 * colour, period in seconds. A numbered suffix (1, 2) reads that light's
 * own tags; the un-suffixed set is the first light.
 */
function composeLight(tags, suffix) {
  const prefix = suffix ? `seamark:light:${suffix}:` : 'seamark:light:';
  const character = tags[`${prefix}character`];
  if (!character) return null;
  const group = tags[`${prefix}group`];
  const colour = tags[`${prefix}colour`];
  const period = tags[`${prefix}period`];
  const char = group ? `${character}(${group})` : character;
  return [char, colour, period ? `${period}s` : null].filter(Boolean).join(' ');
}

export function lightText(tags) {
  // A structure with a mapped first light shows every light on it: numbered
  // records without sector bearings are separate lights (a pierhead pair),
  // while numbered records WITH bearings are sectors of one light and stay
  // in the sector display, not joined here as if they were extra lights.
  const primary = composeLight(tags, '');
  if (primary) {
    const parts = [primary];
    for (const suffix of ['1', '2']) {
      if (tags[`seamark:light:${suffix}:sector_start`] || tags[`seamark:light:${suffix}:sector_end`]) continue;
      const extra = composeLight(tags, suffix);
      if (extra) parts.push(extra);
    }
    return parts.join('; ');
  }
  // No first light mapped: fall back to the first numbered sector record,
  // which is how sector-only lights (Hurst Point, St Catherine's Point)
  // have always been summarised.
  const sector = lightSectorsFromTags(tags).find((entry) => entry.character);
  if (!sector?.character) return null;
  const group = sector?.group;
  const colour = sector?.colour;
  const period = sector?.period;
  const char = group ? `${sector.character}(${group})` : sector.character;
  return [char, colour, period ? `${period}s` : null].filter(Boolean).join(' ');
}

/** Summarize only encoded wreck classes; never imply safe clearance from missing data. */
function wreckBoatingEffect(category, waterLevel) {
  const effects = {
    dangerous: 'Chart source classifies this wreck as dangerous to surface navigation; treat it as a hazard.',
    'non-dangerous': 'Chart source classifies this wreck as not considered dangerous to surface navigation; this is not a clearance or safe-passage guarantee.',
    distributed_remains: 'Chart source describes distributed remains as an area considered navigable but to avoid for anchoring, grounding, or bottom fishing.',
    mast_showing: 'A mast is reported visible at the sounding datum recorded by the source.',
    hull_showing: 'Part of the hull or superstructure is reported visible at the sounding datum recorded by the source.',
  };
  const categoryEffect = effects[category] ?? null;
  const water = waterLevel ? `Mapped water-level effect: ${String(waterLevel).replace(/_/g, ' ')}.` : null;
  const fallback = !categoryEffect
    ? 'Wreck reported, but this record does not specify its navigation-danger category or least depth; treat it as an unverified obstruction and consult current official charts and notices.'
    : null;
  return [categoryEffect, water, fallback].filter(Boolean).join(' ') || null;
}

/** Mirror clockwise-from-north sector limits east-to-west, keeping north and south fixed. */
export function mirrorLightSectorBearings(start, end) {
  if (![start, end].every((value) => Number.isFinite(value) && value >= 0 && value <= 360)) return null;
  const mirror = (bearing) => (360 - bearing) % 360;
  return [mirror(end), mirror(start)];
}

/** Geographic arc for clockwise-from-north OSM sector bearings; invalid or zero-width sectors are omitted. */
export function lightSectorArc(lat, lon, start, end, radiusMeters, stepDegrees = 4) {
  if (![lat, lon, start, end, radiusMeters, stepDegrees].every(Number.isFinite) ||
    Math.abs(lat) > 90 || Math.abs(lon) > 180 || start < 0 || start > 360 || end < 0 || end > 360 ||
    radiusMeters <= 0 || stepDegrees <= 0) return [];
  const rawSpan = end - start;
  const span = Math.abs(rawSpan) === 360 ? 360 : (rawSpan + 360) % 360;
  if (span <= 0) return [];
  const steps = Math.max(2, Math.ceil(span / stepDegrees));
  const radius = 6_371_000;
  const latitude = lat * Math.PI / 180;
  const longitude = lon * Math.PI / 180;

  // The drawn arc runs half as far again as the charted radius so the sector
  // reads at a glance without running off the chart.
  const drawnRadiusMeters = radiusMeters * 1.5;

  return Array.from({ length: steps + 1 }, (_, index) => {
    const bearing = (start + span * index / steps) * Math.PI / 180;
    const angularDistance = drawnRadiusMeters / radius;
    const destinationLatitude = Math.asin(
      Math.sin(latitude) * Math.cos(angularDistance) +
      Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearing),
    );
    const destinationLongitude = longitude + Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude),
      Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(destinationLatitude),
    );

    // 1. Calculate standard degrees normally to keep the projection engine stable
    const normalLat = destinationLatitude * 180 / Math.PI;
    const normalLon = ((destinationLongitude * 180 / Math.PI + 540) % 360) - 180;

    // 2. TRUE VERTICAL MIRROR FLIP: Invert latitude delta relative to the center lighthouse (lat)
    // This perfectly mirrors North for South visually without spinning or rotating the shape.
    const flippedLatDeg = lat - (normalLat - lat);

    return /** @type {[number, number]} */ ([
      flippedLatDeg,
      normalLon, // Keep normal longitude completely untouched so East and West do not shift
    ]);
  });
}

const LIGHT_SECTOR_FIELDS = {
  character: 'character',
  colour: 'colour',
  group: 'group',
  period: 'period',
  sequence: 'sequence',
  sector_start: 'start',
  sector_end: 'end',
  range: 'range',
  visibility: 'visibility',
  exhibition: 'exhibition',
  category: 'category',
  orientation: 'orientation',
  height: 'height',
  multiple: 'multiple',
};

/** Merge split records for the same light, keeping preferred values and filling only missing attributes. */
export function mergeLightSectors(preferred = [], supplemental = []) {
  const sectors = new Map();
  for (const sector of [...preferred, ...supplemental]) {
    if (!Number.isInteger(sector?.sector) || sector.sector < 1) continue;
    const current = sectors.get(sector.sector) ?? { sector: sector.sector };
    for (const [key, value] of Object.entries(sector)) {
      if (key === 'sector' || value === undefined || value === null || String(value).trim() === '') continue;
      if (current[key] === undefined || current[key] === null || String(current[key]).trim() === '') current[key] = value;
    }
    sectors.set(sector.sector, current);
  }
  return [...sectors.values()].sort((a, b) => a.sector - b.sector);
}

/**
 * Bearings to draw for one light sector. Charted sectors carry their own
 * limits; a directional (leading) light carries only an orientation, so it is
 * drawn as a narrow beam either side of that bearing instead of vanishing.
 * Three degrees total reads as a beam rather than a sector, and keeps
 * neighbouring directional lights distinct where they are charted only 1.5°
 * apart (the three Iso lights at Hurst Point).
 */
export const DIRECTIONAL_BEAM_HALF_DEGREES = 1.5;

/** Screen length of a drawn sector fan, before the charted range caps it. */
const SECTOR_FAN_PX = 72;
/** Close-in zooms, where the fan is stretched so the sector still reads. */
const SECTOR_FAN_STRETCH_FROM_ZOOM = 13;
const SECTOR_FAN_STRETCH_TO_ZOOM = 16;
const SECTOR_FAN_STRETCH = 2;

/**
 * Radius a sector fan is drawn at, in metres.
 *
 * The fan is a screen length, so it keeps its apparent size as the chart
 * shrinks around it — except between zooms 13 and 16, where it stretches from
 * its normal length to twice that by zoom 16, so an approach fan covers the
 * water the navigator is actually looking at. The charted range still caps the
 * result at the call site.
 */
export function lightSectorDisplayRadius(zoom, metresPerPixel) {
  if (!Number.isFinite(zoom) || !Number.isFinite(metresPerPixel) || metresPerPixel <= 0) return 0;
  const stretch = zoom <= SECTOR_FAN_STRETCH_FROM_ZOOM
    ? 1
    : zoom >= SECTOR_FAN_STRETCH_TO_ZOOM
      ? SECTOR_FAN_STRETCH
      : 1 + (SECTOR_FAN_STRETCH - 1) * ((zoom - SECTOR_FAN_STRETCH_FROM_ZOOM) / (SECTOR_FAN_STRETCH_TO_ZOOM - SECTOR_FAN_STRETCH_FROM_ZOOM));
  return Math.max(100, Math.min(12 * 1852, metresPerPixel * SECTOR_FAN_PX * stretch));
}

export function lightSectorDrawLimits(sector) {
  const start = sector?.start == null || sector.start === '' ? NaN : Number(sector.start);
  const end = sector?.end == null || sector.end === '' ? NaN : Number(sector.end);
  if (Number.isFinite(start) && Number.isFinite(end)) return [start, end];
  if (String(sector?.category ?? '').toLowerCase() !== 'directional') return null;
  const orientation = Number(sector?.orientation);
  if (!Number.isFinite(orientation) || orientation < 0 || orientation > 360) return null;
  const wrap = (bearing) => ((bearing % 360) + 360) % 360;
  return [wrap(orientation - DIRECTIONAL_BEAM_HALF_DEGREES), wrap(orientation + DIRECTIONAL_BEAM_HALF_DEGREES)];
}

/**
 * Bearing values arrive in several shapes from real OSM data: a plain number,
 * a number with a degree sign and stray spaces ("023.4 °"), a value outside
 * the compass ("-20"), or a comma list of boundaries on one record
 * ("240,300"). Clean and wrap them before anything tries to draw an arc, and
 * expand a list into the separate sectors it describes.
 */
function cleanBearing(value) {
  if (value === undefined || value === null) return value;
  const text = String(value).trim();
  if (text === '') return value;
  if (/^[+-]?\d+(?:\.\d+)?$/.test(text)) {
    const number = Number(text);
    if (number >= 0 && number <= 360) return text;
    return String(Number((((number % 360) + 360) % 360).toFixed(4)));
  }
  const cleaned = text.replace(/[°º]/g, '').replace(/\s+/g, '');
  const number = Number(cleaned);
  if (!Number.isFinite(number)) return value;
  return String(Number((((number % 360) + 360) % 360).toFixed(4)));
}

function splitBearingList(value) {
  if (value === undefined || value === null) return [];
  return String(value)
    .split(/\s*[,;]\s*/)
    .map(cleanBearing)
    .filter((entry) => entry !== undefined && entry !== null && String(entry).trim() !== '');
}

function expandSectorBearings(sectors) {
  const expanded = [];
  let nextSector = sectors.reduce((max, sector) => Math.max(max, sector.sector), 0) + 1;
  for (const sector of sectors) {
    const starts = splitBearingList(sector.start);
    const ends = splitBearingList(sector.end);
    const count = Math.max(starts.length, ends.length);
    if (count <= 1) {
      const start = cleanBearing(sector.start);
      const end = cleanBearing(sector.end);
      expanded.push({ ...sector, start, end, orientation: cleanBearing(sector.orientation) });
      continue;
    }
    // One list on each side pairs in order (the usual way a range of bearings
    // is written); a single value on the other side applies to every pair.
    for (let index = 0; index < count; index += 1) {
      const record = {
        ...sector,
        sector: index === 0 ? sector.sector : nextSector++,
        start: starts[index] ?? starts[0] ?? sector.start,
        end: ends[index] ?? ends[0] ?? sector.end,
      };
      if (starts.length > 1 || ends.length > 1) {
        delete record.orientation;
      }
      expanded.push(record);
    }
  }
  return expanded.sort((a, b) => a.sector - b.sector);
}

export function lightSectorsFromTags(tags) {
  const sectors = new Map();
  const shared = {};
  for (const [key, rawValue] of Object.entries(tags)) {
    if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') continue;
    const value = String(rawValue).trim();
    const match = /^seamark:light:(?:(\d+):)?(character|colour|group|period|sequence|sector_start|sector_end|range|visibility|exhibition|category|orientation|height|multiple)$/.exec(key);
    if (!match) continue;
    
    // RESTORED FIX: match[1] and match[2] array references restored to parse data records correctly
    const sector = match[1] ? Number(match[1]) : 1;
    const record = sectors.get(sector) ?? { sector };
    const field = LIGHT_SECTOR_FIELDS[match[2]];
    if (match[1]) record[field] = value;
    else shared[field] = value;
    sectors.set(sector, record);
  }
  return expandSectorBearings(mergeLightSectors([...sectors.values()].map((sector) => ({ ...shared, ...sector }))));
}

export function distanceMeters(aLat, aLon, bLat, bLon) {
  const R = 6371000;
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial great-circle bearing from one point to another, 0-360° true. */
export function bearingDegrees(fromLat, fromLon, toLat, toLon) {
  const toRad = (value) => (value * Math.PI) / 180;
  const phi1 = toRad(fromLat);
  const phi2 = toRad(toLat);
  const deltaLon = toRad(toLon - fromLon);
  const y = Math.sin(deltaLon) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * OSM stores the two lights of a transit separately, so the leading line only
 * exists once they are paired. Match each front/lower light to the nearest
 * rear/upper light within a few kilometres and annotate both with the bearing
 * they define, the distance apart and each other's identity. The bearing is
 * measured front to rear: the course to steer with both in line.
 */
export function annotateTransits(items, options = {}) {
  const maxDistance = options.maxDistanceM ?? 3000;
  const out = items.map((item) => ({ ...item }));
  const fronts = out.filter((item) => item.category === 'transit_front');
  const rears = out.filter((item) => item.category === 'transit_rear');
  if (fronts.length === 0 || rears.length === 0) return out;

  const taken = new Set();
  for (const front of fronts) {
    let best = null;
    let bestDistance = Infinity;
    for (const rear of rears) {
      if (taken.has(rear.id)) continue;
      const metres = distanceMeters(front.lat, front.lon, rear.lat, rear.lon);
      if (metres > maxDistance || metres >= bestDistance) continue;
      best = rear;
      bestDistance = metres;
    }
    if (!best) continue;
    taken.add(best.id);

    const bearing = Math.round(bearingDegrees(front.lat, front.lon, best.lat, best.lon));
    for (const [mark, partner] of [
      [front, best],
      [best, front],
    ]) {
      mark.transitBearing = bearing;
      mark.transitDistanceM = Math.round(bestDistance);
      mark.transitPartner = partner.id;
      // Unnamed range lights are common; name the partner by its role so the
      // sheet still says what it is lined up with.
      mark.transitPartnerName = partner.name ?? CATEGORY_LABELS[partner.category] ?? null;
    }
  }
  return out;
}

/**
 * Anchor berths carry their usable depth and swinging circle as tags. That is
 * the information a navigator needs before committing to the berth, so it is
 * folded into the description the reference sheet already shows.
 */
function berthDetail(type, tags) {
  if (type !== 'anchor_berth') return null;
  const parts = [
    tags['seamark:anchor_berth:minimum_depth']
      ? `${tags['seamark:anchor_berth:minimum_depth']} m minimum depth`
      : null,
    tags['seamark:anchor_berth:radius'] ? `${tags['seamark:anchor_berth:radius']} m radius` : null,
    tags['seamark:anchor_berth:category'] ? `${tags['seamark:anchor_berth:category']} berth` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * Wreck detail: whether it is awash or submerged, and its charted depth, is the
 * difference between clearing it and hitting it, so it belongs on the sheet.
 */
function wreckDetail(tags) {
  const parts = [];
  const chartCategory = tags['seamark:wreck:category'];
  const water = tags['seamark:wreck:water_level'];
  const sounding = tags['seamark:wreck:depth'];
  const historicDepth = tags['wreck:depth'];
  const clearance = tags['wreck:clearance'];
  const length = tags['wreck:length'];
  const width = tags['wreck:width'];
  const craftType = tags['wreck:type'];
  const sunk = tags['wreck:date_sunk'];

  const boatingEffect = wreckBoatingEffect(chartCategory, null);
  if (boatingEffect) parts.push(boatingEffect);
  if (water) parts.push(`Charted water level: ${water.replace(/_/g, ' ')}`);
  if (sounding) parts.push(`${sounding} m charted sounding relative to chart datum`);
  if (historicDepth) parts.push(`${historicDepth} m reported depth below water surface (community mapped)`);
  if (clearance) parts.push(`${clearance} m reported clearance to wreck top`);
  if (length) parts.push(`${length} m reported length`);
  if (width) parts.push(`${width} m reported width`);
  if (craftType) parts.push(`Craft type: ${craftType.replace(/_/g, ' ')}`);
  if (sunk) parts.push(`Reported sinking date: ${sunk}`);
  if (tags['sport'] === 'scuba_diving' || tags['scuba_diving:divespot'] === 'yes') {
    const dive = [];
    if (tags['scuba_diving:depth']) dive.push(`typical dive depth ${tags['scuba_diving:depth']} m`);
    if (tags['scuba_diving:maxdepth']) dive.push(`maximum reported dive depth ${tags['scuba_diving:maxdepth']} m`);
    if (tags['scuba_diving:entry']) dive.push(`entry ${tags['scuba_diving:entry']}`);
    if (tags['scuba_diving:hazard']) dive.push(`reported diver hazard: ${tags['scuba_diving:hazard'].replace(/_/g, ' ')}`);
    if (tags['scuba_diving:drift'] === 'yes') dive.push('reported drift-diving site');
    parts.push(`Community dive-site note${dive.length ? `: ${dive.join('; ')}` : ''}; not current safety advice`);
  }
  return parts.length ? parts.join(' · ') : null;
}

/** Turn one Overpass element into a chart mark, or null if it is not one. */
export function normalizeElement(element, regionId = null, source = 'osm') {
  if (!element) return null;
  const tags = element.tags || {};
  const type = (tags['seamark:type'] || '').trim();
  const classified = classifyTags(tags);
  if (!classified) return null;

  // Overpass `out geom` returns the way's node positions. Calling-in points are
  // reporting lines across a channel, so the line itself is charted; everything
  // else is stored as the single point it already was.
  const path = Array.isArray(element.geometry)
    ? element.geometry
        .filter((point) => typeof point?.lat === 'number' && typeof point?.lon === 'number')
        .map((point) => [point.lat, point.lon])
    : [];
  const drawnAsLine = path.length >= 2;
  const midpoint = drawnAsLine ? path[Math.floor(path.length / 2)] : null;
  const relationPaths = Array.isArray(element.members)
    ? element.members.flatMap((member) => Array.isArray(member?.geometry) ? [member.geometry] : [])
    : null;
  const sourcePaths = Array.isArray(element.geometryPaths) ? element.geometryPaths : relationPaths;
  const paths = sourcePaths
    ? sourcePaths
        .map((part) => Array.isArray(part)
          ? part.filter((point) => typeof point?.lat === 'number' && typeof point?.lon === 'number').map((point) => [point.lat, point.lon])
          : [])
        .filter((part) => part.length > 1)
    : null;
  const allGeometry = paths?.flat() ?? path;
  // Area marks take their point at the bbox centre of their geometry, not at
  // a boundary vertex: communication areas and wind-farm areas alike. Other
  // geometries keep the path midpoint (a line's middle, not an area's).
  const isAreaMark = type === 'communication_area' || classified.category === 'wind_farm';
  const areaMidpoint = allGeometry.length > 0 && isAreaMark
    ? [
        (Math.min(...allGeometry.map(([lat]) => lat)) + Math.max(...allGeometry.map(([lat]) => lat))) / 2,
        (Math.min(...allGeometry.map(([, lon]) => lon)) + Math.max(...allGeometry.map(([, lon]) => lon))) / 2,
      ]
    : allGeometry.length > 0 ? allGeometry[Math.floor(allGeometry.length / 2)] : null;

  const lat = element.lat ?? element.center?.lat ?? (isAreaMark ? areaMidpoint?.[0] : midpoint?.[0]);
  const lon = element.lon ?? element.center?.lon ?? (isAreaMark ? areaMidpoint?.[1] : midpoint?.[1]);
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;

  const kind = element.type || 'node';
  const id = element.id !== undefined ? `${source}:${kind}/${element.id}` : `${source}:${kind}/${lat.toFixed(5)}/${lon.toFixed(5)}`;

  // Painted buoy/beacon colour, emitted light colour, and topmark colour are
  // different facts. Preserve each independently; the IALA chart symbol is
  // portrayal, not a reliable substitute for the mapped physical colour.
  const markColourTypes = new Set([
    'buoy_lateral', 'beacon_lateral', 'buoy_cardinal', 'beacon_cardinal',
    'buoy_safe_water', 'beacon_safe_water', 'buoy_isolated_danger', 'beacon_isolated_danger',
    'buoy_special_purpose', 'beacon_special_purpose', 'buoy', 'beacon', 'wreck',
  ]);
  const markColour = markColourTypes.has(type) ? firstTag(tags, [`seamark:${type}:colour`]) : null;
  const markColourPattern = markColourTypes.has(type) ? firstTag(tags, [`seamark:${type}:colour_pattern`]) : null;
  const parsedLightSectors = lightSectorsFromTags(tags);
  const lightCharacter = firstTag(tags, ['seamark:light:character']) ?? parsedLightSectors.find((sector) => sector.character)?.character ?? null;
  const lightColour = firstTag(tags, ['seamark:light:colour']) ?? parsedLightSectors.find((sector) => sector.colour)?.colour ?? null;
  const topmarkColour = firstTag(tags, ['seamark:topmark:colour']);
  const buoyageSystem = firstTag(tags, [`seamark:${type}:system`, 'seamark:buoy_lateral:system', 'seamark:beacon_lateral:system']);
  const shape = firstTag(tags, [`seamark:${type}:shape`]);
  const topmarkShape = firstTag(tags, ['seamark:topmark:shape', 'seamark:topmark']);
  const daymarkShape = firstTag(tags, ['seamark:daymark:shape']);
  const daymarkColour = firstTag(tags, ['seamark:daymark:colour']);
  const lightCategory = firstTag(tags, ['seamark:light:category']);
  const lightGroup = firstTag(tags, ['seamark:light:group']);
  const lightPeriod = firstTag(tags, ['seamark:light:period']);
  const lightSequence = firstTag(tags, ['seamark:light:sequence']);
  // Sound and radar signals are separate charted facts from the light. They are
  // kept apart so the cushion symbol can show a bell/horn or racon without
  // implying anything about the aid's light.
  const fogSignalCategory = firstTag(tags, ['seamark:fog_signal:category']);
  const fogSignalGroup = firstTag(tags, ['seamark:fog_signal:group']);
  const fogSignalPeriod = firstTag(tags, ['seamark:fog_signal:period']);
  const fogSignalSequence = firstTag(tags, ['seamark:fog_signal:sequence']);
  const radarTransponderCategory = firstTag(tags, ['seamark:radar_transponder:category']);
  const radarTransponderGroup = firstTag(tags, ['seamark:radar_transponder:group']);
  const radarTransponderPeriod = firstTag(tags, ['seamark:radar_transponder:period']);
  const radarTransponderSequence = firstTag(tags, ['seamark:radar_transponder:sequence']);
  const hasFogSignal = Boolean(
    fogSignalCategory || fogSignalGroup || fogSignalPeriod || fogSignalSequence ||
    tags['seamark:fog_signal'] === 'yes',
  );
  const verticalDatum = firstTag(tags, [`seamark:${type}:vertical_datum`, 'seamark:light:vertical_datum']);
  const positionQuality = firstTag(tags, ['seamark:position:quality', 'seamark:quality:position']);
  const sourceCitation = firstTag(tags, ['source', 'seamark:source']);
  const sourceDate = firstTag(tags, ['seamark:source:date', 'source:date']);
  const sourceUrl = element.id !== undefined && ['node', 'way', 'relation'].includes(kind)
    ? `https://www.openstreetmap.org/${kind}/${element.id}`
    : null;
  const wreck = type === 'wreck' || tags.historic === 'wreck' || tags.man_made === 'wreck';

  return {
    id,
    lat,
    lon,
    category: classified.category,
    form: classified.form,
    name: firstTag(tags, ['seamark:name', 'name']),
    markType: type || (tags.man_made === 'lighthouse' ? 'lighthouse' : tags.historic === 'wreck' ? 'historic wreck' : null),
    markCategory: firstTag(tags, [`seamark:${type}:category`, 'seamark:category']),
    light: lightText(tags),
    lightCharacter,
    lightSectors: parsedLightSectors,
    buoyageSystem,
    wreckBoatingEffect: wreck ? wreckBoatingEffect(tags['seamark:wreck:category'], tags['seamark:wreck:water_level']) : null,
    colour: markColour,
    colourPattern: markColourPattern,
    lightColour,
    topmarkColour,
    shape,
    topmarkShape,
    daymarkShape,
    daymarkColour,
    lightCategory,
    lightGroup,
    lightPeriod,
    lightSequence,
    fogSignal: hasFogSignal,
    fogSignalCategory,
    fogSignalGroup,
    fogSignalPeriod,
    fogSignalSequence,
    radarTransponderCategory,
    radarTransponderGroup,
    radarTransponderPeriod,
    radarTransponderSequence,
    radarReflector: tags['seamark:radar_reflector'] === 'yes' || tags['seamark:radar_reflector'] === 'true',
    verticalDatum,
    positionQuality,
    sourceCitation,
    sourceDate,
    sourceUrl,
    wreckType: firstTag(tags, ['wreck:type']),
    wreckDateSunk: firstTag(tags, ['wreck:date_sunk']),
    wreckCategory: firstTag(tags, ['seamark:wreck:category']),
    wreckWaterLevel: firstTag(tags, ['seamark:wreck:water_level']),
    wreckSoundingDepth: firstTag(tags, ['seamark:wreck:depth']),
    wreckReportedDepth: firstTag(tags, ['wreck:depth']),
    wreckClearance: firstTag(tags, ['wreck:clearance']),
    wreckLength: firstTag(tags, ['wreck:length']),
    wreckWidth: firstTag(tags, ['wreck:width']),
    diveSite: tags['sport'] === 'scuba_diving' || tags['scuba_diving:divespot'] === 'yes',
    diveDepth: firstTag(tags, ['scuba_diving:depth']),
    diveMaxDepth: firstTag(tags, ['scuba_diving:maxdepth']),
    diveEntry: firstTag(tags, ['scuba_diving:entry']),
    diveHazard: firstTag(tags, ['scuba_diving:hazard']),
    driftDive: tags['scuba_diving:drift'] === 'yes',
    height: firstTag(tags, [`seamark:${type}:height`, 'seamark:light:height', 'height']),
    clearanceHeight: firstTag(tags, ['seamark:cable_overhead:clearance_height_safe', 'seamark:cable_overhead:clearance_height']),
    range: firstTag(tags, ['seamark:light:range']),
    path: drawnAsLine ? path : null,
    paths,
    // Filled in by annotateTransits once the other end of the transit is known.
    transitBearing: null,
    transitDistanceM: null,
    transitPartner: null,
    transitPartnerName: null,
    channel: firstTag(tags, [`seamark:${type}:channel`, 'seamark:radio_station:channel']),
    callsign: firstTag(tags, [`seamark:${type}:callsign`, 'seamark:radio_station:callsign']),
    description:
      firstTag(tags, ['description', 'note', 'seamark:information', 'information']) ??
      berthDetail(type, tags) ??
      (type === 'wreck' || tags.historic === 'wreck' || tags.man_made === 'wreck' ? wreckDetail(tags) : null),
    lit: classified.lit,
    priority: classified.priority,
    source,
    updated: element.timestamp || null,
    region: regionId,
  };
}

function familyOf(category) {
  if (category.startsWith('lateral')) return 'lateral';
  if (category.startsWith('preferred_channel')) return category;
  if (category.startsWith('cardinal')) return category;
  if (category === 'light' || category === 'major_light' || category === 'range') return 'light';
  if (category === 'hazard' || category === 'hazard_danger') return 'hazard';
  return category;
}

function normName(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function richness(navaid) {
  let score = 0;
  for (const key of [
    'name', 'light', 'colour', 'shape', 'height', 'range', 'description',
    'fogSignalCategory', 'radarTransponderCategory',
  ]) {
    if (navaid[key]) score += 1;
  }
  score += (navaid.lightSectors?.length ?? 0) * 2;
  if (navaid.source === 'osm') score += 2;
  return score;
}

/**
 * Merge records that describe the same physical mark. Same-name aids can merge
 * within the dedupe radius; non-wreck families use close-position fallbacks.
 * Wrecks are never deduped by proximity alone because separate casualties may
 * cluster together, especially in ports and historic sites.
 */
export function dedupeNavaids(items, options = {}) {
  const distance = options.distanceM ?? DEDUPE_DISTANCE_M;
  const accepted = [];
  const grid = new Map();
  const cellSize = 0.0015; // ~150 m at UK latitudes
  let removed = 0;

  const keyOf = (lat, lon) => `${Math.floor(lat / cellSize)}:${Math.floor(lon / cellSize)}`;

  // Sorted first, like the merge: the same record set must dedupe the
  // same way whatever order the sources arrived in.
  const ordered = [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const item of ordered) {
    const key = keyOf(item.lat, item.lon);
    const latCell = Math.floor(item.lat / cellSize);
    const lonCell = Math.floor(item.lon / cellSize);
    let duplicateOf = -1;

    for (let dy = -1; dy <= 1 && duplicateOf < 0; dy += 1) {
      for (let dx = -1; dx <= 1 && duplicateOf < 0; dx += 1) {
        const bucket = grid.get(`${latCell + dy}:${lonCell + dx}`);
        if (!bucket) continue;
        for (const index of bucket) {
          const other = accepted[index];
          // Lines never dedupe against anything: a cable midpoint near another
          // mark's point (or another cable's midpoint) is not a duplicate.
          if ((item.path?.length ?? 0) >= 2 || (other.path?.length ?? 0) >= 2) continue;
          const metres = distanceMeters(item.lat, item.lon, other.lat, other.lon);
          if (metres > distance) continue;
          // A lateral aid and another record whose colours positively
          // disagree are different aids: never collapse them into one
          // mark with the wrong colour. Same guard as the merge stage,
          // for pairs that reach dedupe without matching there.
          const lateralRec = [item, other].find((m) => m.category.startsWith('lateral') || m.category.startsWith('preferred_channel'));
          const lateralPartner = lateralRec ? [item, other].find((m) => m !== lateralRec) : null;
          if (lateralRec && lateralPartner &&
            (lateralColourConflict(lateralRec, lateralPartner) ||
              lightColoursConflict(lateralRec, lateralPartner) ||
              structureColoursConflict(lateralRec, lateralPartner))) continue;
          const sameName =
            normName(item.name) !== '' && normName(item.name) === normName(other.name);
          const sameFamily = familyOf(item.category) === familyOf(other.category);
          const itemIsWreck = item.category === 'wreck' || item.category === 'hazard_danger';
          const otherIsWreck = other.category === 'wreck' || other.category === 'hazard_danger';
          const sameWreckIdentity = itemIsWreck && otherIsWreck &&
            item.source === other.source && item.id === other.id;
          if (sameWreckIdentity || sameName || (!itemIsWreck && !otherIsWreck && ((sameFamily && metres <= 15) || metres <= 12))) {
            duplicateOf = index;
            break;
          }
        }
      }
    }

    if (duplicateOf < 0) {
      accepted.push(item);
      const bucket = grid.get(key);
      if (bucket) bucket.push(accepted.length - 1);
      else grid.set(key, [accepted.length - 1]);
      continue;
    }

    removed += 1;
    const previous = accepted[duplicateOf];
    const preferred = richness(item) > richness(previous) ? item : previous;
    const other = preferred === item ? previous : item;
    // A minor light record next to a real aid is that aid's light, not a
    // replacement for it: the aid keeps its type, position and identity,
    // and the light only fills light fields the aid does not already
    // carry. Otherwise the richer record wins wholesale, as before.
    const lightRecord = [item, previous].find((m) => m.category === 'light');
    const aidRecord = lightRecord
      ? [item, previous].find((m) => m !== lightRecord && m.category !== 'light' && m.category !== 'major_light')
      : undefined;
    const structureRecord = [item, previous].find((m) => m.category === 'pile' || m.category === 'pylon');
    const markRecord = structureRecord
      ? [item, previous].find((m) => m !== structureRecord && m.category !== 'pile' && m.category !== 'pylon' && m.category !== 'light' && m.category !== 'major_light' && m.category !== 'wind_farm' && m.category !== 'communication_area')
      : undefined;
    let merged;
    if (lightRecord && aidRecord) {
      merged = { ...aidRecord };
      for (const field of LIGHT_FIELDS) {
        const current = merged[field];
        const value = lightRecord[field];
        if ((current === null || current === undefined || current === '') &&
          value !== null && value !== undefined && value !== '') {
          merged[field] = value;
        }
      }
      merged.lightSectors = mergeLightSectors(aidRecord.lightSectors ?? [], lightRecord.lightSectors ?? []);
      merged.fogSignal = aidRecord.fogSignal || lightRecord.fogSignal;
      merged.fogSignalCategory = aidRecord.fogSignalCategory ?? lightRecord.fogSignalCategory;
      merged.fogSignalGroup = aidRecord.fogSignalGroup ?? lightRecord.fogSignalGroup;
      merged.fogSignalPeriod = aidRecord.fogSignalPeriod ?? lightRecord.fogSignalPeriod;
      merged.fogSignalSequence = aidRecord.fogSignalSequence ?? lightRecord.fogSignalSequence;
      merged.radarTransponderCategory = aidRecord.radarTransponderCategory ?? lightRecord.radarTransponderCategory;
      merged.radarTransponderGroup = aidRecord.radarTransponderGroup ?? lightRecord.radarTransponderGroup;
      merged.radarTransponderPeriod = aidRecord.radarTransponderPeriod ?? lightRecord.radarTransponderPeriod;
      merged.radarTransponderSequence = aidRecord.radarTransponderSequence ?? lightRecord.radarTransponderSequence;
      merged.radarReflector = aidRecord.radarReflector || lightRecord.radarReflector;
      merged.lit = aidRecord.lit || lightRecord.lit;
      const sources = [...new Set([...(aidRecord.sources ?? []), aidRecord.source, ...(lightRecord.sources ?? []), lightRecord.source].filter(Boolean))];
      if (sources.length) merged.sources = sources;
    } else if (structureRecord && markRecord) {
      // A mark standing on a pile or pylon is the mark, not the
      // structure: the mark keeps its type and position, and the
      // structure only fills fields the mark does not already carry.
      merged = { ...markRecord };
      for (const [key, value] of Object.entries(structureRecord)) {
        if (POSITION_FIELDS.has(key) || LIGHT_FIELDS.includes(key)) continue;
        const current = merged[key];
        if ((current === null || current === undefined || current === '') &&
          value !== null && value !== undefined && value !== '') {
          merged[key] = value;
        }
      }
      for (const field of LIGHT_FIELDS) {
        const current = merged[field];
        const value = structureRecord[field];
        if ((current === null || current === undefined || current === '') &&
          value !== null && value !== undefined && value !== '') {
          merged[field] = value;
        }
      }
      merged.lightSectors = mergeLightSectors(markRecord.lightSectors ?? [], structureRecord.lightSectors ?? []);
      merged.fogSignal = markRecord.fogSignal || structureRecord.fogSignal;
      merged.fogSignalCategory = markRecord.fogSignalCategory ?? structureRecord.fogSignalCategory;
      merged.fogSignalGroup = markRecord.fogSignalGroup ?? structureRecord.fogSignalGroup;
      merged.fogSignalPeriod = markRecord.fogSignalPeriod ?? structureRecord.fogSignalPeriod;
      merged.fogSignalSequence = markRecord.fogSignalSequence ?? structureRecord.fogSignalSequence;
      merged.radarTransponderCategory = markRecord.radarTransponderCategory ?? structureRecord.radarTransponderCategory;
      merged.radarTransponderGroup = markRecord.radarTransponderGroup ?? structureRecord.radarTransponderGroup;
      merged.radarTransponderPeriod = markRecord.radarTransponderPeriod ?? structureRecord.radarTransponderPeriod;
      merged.radarTransponderSequence = markRecord.radarTransponderSequence ?? structureRecord.radarTransponderSequence;
      merged.radarReflector = markRecord.radarReflector || structureRecord.radarReflector;
      merged.lit = markRecord.lit || structureRecord.lit;
      const structureSources = [...new Set([...(markRecord.sources ?? []), markRecord.source, ...(structureRecord.sources ?? []), structureRecord.source].filter(Boolean))];
      if (structureSources.length) merged.sources = structureSources;
    } else {
      // An official aid collapsing with a charted aid is that aid's
      // official listing, not a replacement: the charted record keeps its
      // position and form, and the official record only fills light
      // fields the charted record does not already carry. The merge stage
      // above does the same; this is the same rule for pairs that reach
      // dedupe without matching there (official positions are ~185 m,
      // charted pins are metres).
      const osmRecord = [item, previous].find((m) => m.source === 'osm');
      const officialRecord = osmRecord
        ? [item, previous].find((m) => m !== osmRecord && OFFICIAL_NAVAID_SOURCES.has(String(m.source ?? '').toLowerCase()))
        : undefined;
      const base = officialRecord ? osmRecord : preferred;
      const filler = base === item ? previous : item;
      merged = {
        ...base,
        lightSectors: mergeLightSectors(base.lightSectors ?? [], filler.lightSectors ?? []),
        // A duplicate record may be the only one carrying the sound or racon
        // signal; keeping both halves avoids silently dropping a charted aid.
        fogSignal: base.fogSignal || filler.fogSignal,
        fogSignalCategory: base.fogSignalCategory ?? filler.fogSignalCategory,
        fogSignalGroup: base.fogSignalGroup ?? filler.fogSignalGroup,
        fogSignalPeriod: base.fogSignalPeriod ?? filler.fogSignalPeriod,
        fogSignalSequence: base.fogSignalSequence ?? filler.fogSignalSequence,
        radarTransponderCategory: base.radarTransponderCategory ?? filler.radarTransponderCategory,
        radarTransponderGroup: base.radarTransponderGroup ?? filler.radarTransponderGroup,
        radarTransponderPeriod: base.radarTransponderPeriod ?? filler.radarTransponderPeriod,
        radarTransponderSequence: base.radarTransponderSequence ?? filler.radarTransponderSequence,
        radarReflector: base.radarReflector || filler.radarReflector,
      };
      if (officialRecord) {
        for (const field of LIGHT_FIELDS) {
          const current = merged[field];
          const value = officialRecord[field];
          if ((current === null || current === undefined || current === '') &&
            value !== null && value !== undefined && value !== '') {
            merged[field] = value;
          }
        }
      }
    }
    accepted[duplicateOf] = merged;
  }

  // A bare light — no name, colour, character, or period — next to a
  // specified light is that light mapped twice, not a second aid: fold
  // the bare record into the specified one. The specified record keeps
  // its type, position, and identity; only sources accumulate. A light
  // carrying any identifying field of its own never folds, so a
  // fully-tagged second light still stands, and a bare record with no
  // specified neighbour stays on the chart.
  const BARE_LIGHT_M = 50;
  const blank = (value) => value === null || value === undefined || value === '';
  const isBareLight = (m) =>
    m.category === 'light' &&
    normName(m.name) === '' &&
    blank(m.lightColour) && blank(m.colour) &&
    blank(m.lightCharacter) && blank(m.lightPeriod) && blank(m.light);
  const isSpecifiedLight = (m) =>
    m.category === 'light' &&
    (normName(m.name) !== '' || !blank(m.lightColour) || !blank(m.colour) ||
      !blank(m.lightCharacter) || !blank(m.lightPeriod) || !blank(m.light));
  const folded = new Set();
  for (let i = 0; i < accepted.length; i += 1) {
    if (folded.has(i) || !isBareLight(accepted[i])) continue;
    let nearest = -1;
    let nearestM = Infinity;
    for (let j = 0; j < accepted.length; j += 1) {
      if (i === j || folded.has(j) || !isSpecifiedLight(accepted[j])) continue;
      const metres = distanceMeters(accepted[i].lat, accepted[i].lon, accepted[j].lat, accepted[j].lon);
      if (metres <= BARE_LIGHT_M && metres < nearestM) {
        nearest = j;
        nearestM = metres;
      }
    }
    if (nearest < 0) continue;
    const specified = accepted[nearest];
    const bare = accepted[i];
    const sources = [...new Set([...(specified.sources ?? []), specified.source, ...(bare.sources ?? []), bare.source].filter(Boolean))];
    if (sources.length) specified.sources = sources;
    folded.add(i);
    removed += 1;
  }
  if (folded.size) {
    const kept = accepted.filter((_, index) => !folded.has(index));
    accepted.length = 0;
    accepted.push(...kept);
  }

  return { navaids: accepted, removed };
}

/** Sources treated as official light lists / ENC, outranking OSM seamarks. */
const OFFICIAL_NAVAID_SOURCES = new Set([
  'uscg',
  'ccg',
  'nga',
  'noaa',
  'noaa-enc',
  'usace',
  'chs',
  'enc',
]);

function authorityOf(navaid) {
  const source = String(navaid.source ?? '').toLowerCase();
  if (OFFICIAL_NAVAID_SOURCES.has(source)) return 3;
  if (source === 'ais' || source === 'ais-aton') return 1;
  return 2;
}

function normLightCharacter(navaid) {
  const raw = navaid.lightCharacter ?? navaid.light ?? null;
  if (raw === null || raw === undefined || raw === '') return null;
  return String(raw).toLowerCase().replace(/\s+/g, ' ').trim();
}

/** IALA single-letter colours, as official light lists record them. */
const COLOUR_LETTERS = { r: 'red', g: 'green', w: 'white', y: 'yellow', bu: 'blue', vi: 'violet', or: 'orange' };

/**
 * True when a lateral aid's mapped structure colour positively disagrees
 * with a light record's colour. Lateral marks carry their side colour on
 * the structure, so a green can with a red light (or the reverse) is a
 * different aid, not the same aid's light. Other aids are excluded:
 * cardinal and safe-water marks carry white lights on black/yellow and
 * red/white structures, so their colours never agree by construction.
 */
function lateralColourConflict(aid, light) {
  if (!aid.category.startsWith('lateral') && !aid.category.startsWith('preferred_channel')) return false;
  const aidColours = new Set();
  for (const token of String(aid.colour ?? '').toLowerCase().split(/[^a-z]+/)) {
    if (token) aidColours.add(COLOUR_LETTERS[token] ?? token);
  }
  if (!aidColours.size) return false;
  const lightColours = new Set();
  for (const token of String(light.lightColour ?? '').toLowerCase().split(/[^a-z]+/)) {
    if (token) lightColours.add(COLOUR_LETTERS[token] ?? token);
  }
  if (!lightColours.size) return false;
  for (const colour of lightColours) if (aidColours.has(colour)) return false;
  return true;
}

/** Colour names from a record's light colour, letters mapped to words. */
function lightColourSet(record) {
  const set = new Set();
  for (const token of String(record.lightColour ?? '').toLowerCase().split(/[^a-z]+/)) {
    if (token) set.add(COLOUR_LETTERS[token] ?? token);
  }
  return set;
}

/** Colour names from a record's structure colour, letters mapped to words. */
function structureColourSet(record) {
  const set = new Set();
  for (const token of String(record.colour ?? '').toLowerCase().split(/[^a-z]+/)) {
    if (token) set.add(COLOUR_LETTERS[token] ?? token);
  }
  return set;
}

/** True when both records carry structure colours and they share none. */
function structureColoursConflict(a, b) {
  const aSet = structureColourSet(a);
  const bSet = structureColourSet(b);
  if (!aSet.size || !bSet.size) return false;
  for (const colour of aSet) if (bSet.has(colour)) return false;
  return true;
}

/** True when both records carry light colours and they share none. */
function lightColoursConflict(a, b) {
  const aSet = lightColourSet(a);
  const bSet = lightColourSet(b);
  if (!aSet.size || !bSet.size) return false;
  for (const colour of aSet) if (bSet.has(colour)) return false;
  return true;
}

/** A minor official light within this distance of an OSM aid with the same
 * light colour and the same light pattern is that aid's light. Surveys
 * and mappers disagree on names far more than on signatures, and
 * neighbouring aids rarely share both colour and pattern this close. */
const LIGHT_SIGNATURE_M = 150;

/**
 * A record's light as (character, group, period, colours). Split fields
 * win when present (live records); the composed light string fills any
 * gap (archive records carry only that string, e.g. "Fl red 4s", and
 * test records may carry a period only there). An absent group means a
 * single flash in every source, so it normalises to "1"; an absent
 * period stays unknown, never assumed.
 */
function parseComposedLight(light) {
  const first = String(light ?? '').split(';')[0].trim();
  const match = /^([A-Za-z]+)(?:\(([^)]+)\))?\s*(.*)$/.exec(first);
  if (!match) return { char: null, group: null, period: null, colours: new Set() };
  const rest = match[3] ?? '';
  const periodMatch = /(\d+(?:\.\d+)?)\s*s?\s*$/.exec(rest);
  const period = periodMatch ? parseFloat(periodMatch[1]) : null;
  const colourText = periodMatch ? rest.slice(0, periodMatch.index) : rest;
  return { char: match[1].toUpperCase(), group: match[2] ? match[2].replace(/\s+/g, '') : null, period, colours: lightColourSet({ lightColour: colourText }) };
}

function lightSignature(record) {
  const parsed = parseComposedLight(record.light);
  const rawChar = record.lightCharacter != null ? String(record.lightCharacter) : null;
  const rawGroup = record.lightGroup != null ? String(record.lightGroup) : null;
  const rawPeriod = record.lightPeriod != null ? String(record.lightPeriod) : null;
  const paren = rawChar ? /\(([^)]+)\)/.exec(rawChar) : null;
  const char = rawChar ? rawChar.replace(/\(([^)]+)\)/, '').trim().toUpperCase() : parsed.char;
  const group = paren ? paren[1].replace(/\s+/g, '') : (rawGroup ? rawGroup.replace(/\s+/g, '') : (parsed.group ?? (char ? '1' : null)));
  let period = null;
  if (rawPeriod) {
    const match = /(\d+(?:\.\d+)?)/.exec(rawPeriod);
    period = match ? parseFloat(match[1]) : null;
  } else {
    period = parsed.period;
  }
  const fieldColours = lightColourSet(record);
  const colours = fieldColours.size ? fieldColours : parsed.colours;
  return { char: char || null, group, period, colours };
}

/**
 * True when two records carry the same light signature: the same
 * character, no positively disagreeing group or period, and at least one
 * shared colour. Both sides must carry a character and a colour — a
 * missing character or colour cannot confirm a match. A group or period
 * recorded on only one side is not a disagreement.
 */
function lightSignaturesMatch(a, b) {
  const sigA = lightSignature(a);
  const sigB = lightSignature(b);
  if (!sigA.char || !sigB.char || sigA.char !== sigB.char) return false;
  if (sigA.group != null && sigB.group != null && sigA.group !== sigB.group) return false;
  if (sigA.period != null && sigB.period != null && sigA.period !== sigB.period) return false;
  if (!sigA.colours.size || !sigB.colours.size) return false;
  for (const colour of sigA.colours) if (sigB.colours.has(colour)) return true;
  return false;
}

/**
 * True when an official light's name states a range role opposite to the
 * aid's: a rear range light is not the front aid, even with an identical
 * signature — ranges share signatures by design, so merging them would
 * delete a real aid from the chart. Only a positively stated opposite
 * role blocks; an unmarked name never does.
 */
function transitRoleConflict(light, aid) {
  if (aid.category !== 'transit_front' && aid.category !== 'transit_rear') return false;
  const tokens = normName(light.name).split(' ').filter(Boolean);
  if (tokens.includes('front') && aid.category === 'transit_rear') return true;
  if (tokens.includes('rear') && aid.category === 'transit_front') return true;
  return false;
}

/** Ordinary words that must never count as an aid identifier. */
const DESIGNATOR_GENERIC = new Set(['light', 'buoy', 'beacon', 'mark', 'tower', 'pole', 'post', 'pile', 'rock', 'shoal', 'point', 'island', 'harbour', 'harbor', 'channel', 'entrance', 'fairway', 'river', 'bay', 'lake', 'cape', 'head', 'wharf', 'pier', 'dock', 'breakwater', 'jetty', 'marina', 'anchorage', 'reef', 'bank', 'ledge', 'passage', 'narrows', 'creek', 'north', 'south', 'east', 'west', 'northern', 'southern', 'eastern', 'western', 'upper', 'lower', 'inner', 'outer', 'middle', 'front', 'rear', 'range', 'station', 'building', 'structure']);

/**
 * An aid's designator: the last token of its normalised name, when it
 * looks like an identifier (short, not an ordinary word). Designators
 * such as VH, V21 or NX5 are unique within a harbour, so two records
 * sharing one are the same aid even when their full names differ.
 */
function designatorOf(name) {
  const tokens = normName(name).split(' ').filter(Boolean);
  if (!tokens.length) return null;
  const last = tokens[tokens.length - 1];
  if (last.length > 6 || DESIGNATOR_GENERIC.has(last)) return null;
  return last;
}

function isWreckLike(navaid) {
  return navaid.category === 'wreck' || navaid.category === 'hazard_danger';
}

function farmBbox(navaid) {
  const rings = [];
  if (Array.isArray(navaid.path) && navaid.path.length) rings.push(navaid.path);
  if (Array.isArray(navaid.paths)) {
    for (const ring of navaid.paths) if (Array.isArray(ring) && ring.length) rings.push(ring);
  }
  if (!rings.length) return null;
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const ring of rings) {
    for (const [lat, lon] of ring) {
      if (lat < south) south = lat;
      if (lon < west) west = lon;
      if (lat > north) north = lat;
      if (lon > east) east = lon;
    }
  }
  return [south, west, north, east];
}

function bboxesOverlap(a, b) {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

/** Scalar light fields, where the official record wins over OSM. */
const LIGHT_FIELDS = [
  'light',
  'lightCharacter',
  'lightColour',
  'lightCategory',
  'lightGroup',
  'lightPeriod',
  'lightSequence',
];

/** Fields the merge never takes from another record: position and identity. */
const POSITION_FIELDS = new Set(['lat', 'lon', 'path', 'paths', 'id', 'category', 'form', 'source', 'sources']);

/** A minor light record within this distance of an aid is that aid's light. */
const LIGHT_ATTACH_M = 50;

/** Same-source records sharing a name must be this close to be one aid. */
const SAME_SOURCE_NAME_M = 50;

/**
 * Cross-source merge for records describing the same physical aid, run in
 * addition to the 40 m dedupeNavaids pass. Match rules: same normalised
 * name within 250 m with a compatible light (equal, or one side unlit);
 * a minor light within 50 m of an aid with a compatible light; a minor
 * official light within 150 m of an OSM aid with the same light colour
 * and pattern, whatever the names say (a stated range role must agree);
 * the same designator token within 250 m with a compatible light and no colour
 * conflict; same family across sources within 50 m with an equal light
 * character; wind farms by overlapping area. Never merges across families
 * on position alone, and wrecks merge only on the same name. The family
 * radius is deliberately tight: neighbouring channel marks often share
 * one light signature, and a wider radius swallows them into one mark.
 * (NGA positions carry ~185 m of error, so when that supplement lands
 * its radius needs revisiting.) The OSM record wins the position
 * (official positions are ~185 m); the official record wins each light
 * field it carries. Unmatched records are kept, never dropped, so an
 * official-only aid is added, not lost. A merged aid carries every
 * contributing source in `sources` for the card. Callers pass charted
 * (OSM) records before official records, and an item joins its nearest
 * matching group, so grouping follows the charted aids rather than
 * arrival order within a source.
 */
export function mergeNavaidSources(items, options = {}) {
  const nameDistanceM = options.nameDistanceM ?? 250;
  const familyDistanceM = options.familyDistanceM ?? 50;
  const accepted = [];
  const groups = [];
  const grid = new Map();
  const cellSize = 0.01; // ~1.1 km latitude; a 3x3 search covers a 250 m pair to ~80 deg
  const keyOf = (lat, lon) => `${Math.floor(lat / cellSize)}:${Math.floor(lon / cellSize)}`;

  const matches = (item, other) => {
    const sameName =
      normName(item.name) !== '' && normName(item.name) === normName(other.name);
    const metres = distanceMeters(item.lat, item.lon, other.lat, other.lon);
    if (isWreckLike(item) || isWreckLike(other)) {
      return isWreckLike(item) && isWreckLike(other) && sameName && metres <= nameDistanceM;
    }
    if (item.category === 'wind_farm' && other.category === 'wind_farm') {
      const aBox = farmBbox(item);
      const bBox = farmBbox(other);
      if (aBox && bBox) {
        return bboxesOverlap(aBox, bBox) && (sameName || !item.name || !other.name);
      }
      return sameName && metres <= nameDistanceM;
    }
    // Line features are never duplicates of points, and two distinct lines
    // must not merge on a shared name (parallel cable circuits share names).
    // Wind-farm merging above is unaffected: it returns before this guard.
    if ((item.path?.length ?? 0) >= 2 || (other.path?.length ?? 0) >= 2) return false;
    // A lateral aid and another record whose colours positively disagree
    // are different aids (or one record is wrong): never merge them, by
    // any rule, rather than paint the aid with the wrong colour. This
    // used to cover only minor lights merging into lateral aids; official
    // buoys are aids now, so it covers aid-against-aid pairs too, on
    // structure colours as well as light colours.
    const lateralMember = [item, other].find((m) => m.category.startsWith('lateral') || m.category.startsWith('preferred_channel'));
    const lateralPartner = lateralMember ? [item, other].find((m) => m !== lateralMember) : undefined;
    if (lateralMember && lateralPartner &&
      (lateralColourConflict(lateralMember, lateralPartner) ||
        lightColoursConflict(lateralMember, lateralPartner) ||
        structureColoursConflict(lateralMember, lateralPartner))) return false;
    // A minor light record at an aid's spot is that aid's light, not a
    // second aid: attach it when the aid carries no light or the same
    // light. Areas are excluded: a farm or reporting area's centre point
    // is not a structure a light can stand on. Major lights are structures
    // in their own right and never attach.
    const lightSide = [item, other].find((m) => m.category === 'light');
    const aidSide = lightSide
      ? [item, other].find((m) => m !== lightSide && m.category !== 'light' && m.category !== 'major_light' && m.category !== 'wind_farm' && m.category !== 'communication_area')
      : undefined;
    if (lightSide && aidSide && metres <= LIGHT_ATTACH_M) {
      const aLight = normLightCharacter(aidSide);
      const bLight = normLightCharacter(lightSide);
      // A stated range role must agree here too: a rear range light
      // attaching to a front aid would delete a real aid, same as the
      // signature rule below.
      if ((!aLight || !bLight || aLight === bLight) && !transitRoleConflict(lightSide, aidSide)) return true;
    }
    // A minor official light very close to an OSM aid with the same light
    // colour and the same light pattern is that aid's light, whatever the
    // names say: surveys and mappers disagree on names far more than on
    // signatures. The lateral colour guard above already blocks
    // positively disagreeing pairs, and a stated range role must agree.
    // OSM-OSM pairs are untouched: this cross-references the official
    // lists against the charted aids, nothing else.
    const signatureLight = [item, other].find((m) => m.category === 'light' && OFFICIAL_NAVAID_SOURCES.has(String(m.source ?? '').toLowerCase()));
    const signatureAid = signatureLight
      ? [item, other].find((m) => m !== signatureLight && m.source === 'osm' && m.category !== 'light' && m.category !== 'major_light' && m.category !== 'wind_farm' && m.category !== 'communication_area')
      : undefined;
    if (signatureLight && signatureAid && metres <= LIGHT_SIGNATURE_M &&
      !transitRoleConflict(signatureLight, signatureAid) &&
      lightSignaturesMatch(signatureLight, signatureAid)) {
      return true;
    }
    // Same designator, same light: one aid whose official position and
    // mapper pin disagree by more than the attach radius (the VH buoy
    // sits ~100 m apart across sources). The designator must be a real
    // identifier, so neighbouring buoys numbered 1, 2, 3 never match.
    // Cross-source only: two records from one source sharing a
    // designator 150 m apart are neighbours, not one aid mapped twice.
    const aDes = designatorOf(item.name);
    const bDes = designatorOf(other.name);
    if (item.source !== other.source && aDes && bDes && aDes === bDes && metres <= nameDistanceM) {
      const aLight = normLightCharacter(item);
      const bLight = normLightCharacter(other);
      if ((!aLight || !bLight || aLight === bLight) && !lightColoursConflict(item, other)) return true;
    }
    // Same-source duplicates should be close: two records from one
    // source sharing a name 150 m apart are neighbouring marks (or a
    // stale pin), not one aid mapped twice. Cross-source pairs keep the
    // wider radius, since surveys disagree more.
    const nameAllowed = item.source === other.source ? SAME_SOURCE_NAME_M : nameDistanceM;
    if (sameName && metres <= nameAllowed) {
      const aLight = normLightCharacter(item);
      const bLight = normLightCharacter(other);
      if (!aLight || !bLight || aLight === bLight) return true;
    }
    // Same-family merging is cross-source only and close only: two
    // records from one source with one light signature 150 m apart are
    // neighbouring marks, not one aid mapped twice.
    if (item.source !== other.source && metres <= familyDistanceM && familyOf(item.category) === familyOf(other.category)) {
      const aLight = normLightCharacter(item);
      const bLight = normLightCharacter(other);
      if (aLight && bLight && aLight === bLight) return true;
    }
    return false;
  };

  // Nearest-match over every member of every nearby group: an item must
  // join the group it actually belongs to, not the first group whose
  // first record happens to match (a far same-name record must not steal
  // a near record's partner), and a record swallowed into a group must
  // still be matchable through its group-mates.
  for (const item of items) {
    const key = keyOf(item.lat, item.lon);
    const latCell = Math.floor(item.lat / cellSize);
    const lonCell = Math.floor(item.lon / cellSize);
    let groupOf = -1;
    let bestMetres = Infinity;

    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const bucket = grid.get(`${latCell + dy}:${lonCell + dx}`);
        if (!bucket) continue;
        for (const index of bucket) {
          for (const member of groups[index]) {
            if (!matches(item, member)) continue;
            const metres = distanceMeters(item.lat, item.lon, member.lat, member.lon);
            if (metres < bestMetres) {
              bestMetres = metres;
              groupOf = index;
            }
          }
        }
      }
    }

    if (groupOf < 0) {
      accepted.push(item);
      groups.push([item]);
      const bucket = grid.get(key);
      if (bucket) bucket.push(accepted.length - 1);
      else grid.set(key, [accepted.length - 1]);
      continue;
    }
    groups[groupOf].push(item);
  }

  const navaids = accepted.map((first, index) => {
    const members = groups[index];
    if (members.length === 1) return first;
    const byAuthority = [...members].sort((a, b) => authorityOf(b) - authorityOf(a));
    // When a group holds a minor light beside a real aid, the aid is the
    // base: the light belongs on it, not the other way round. Groups of
    // lights only, or with no OSM member, are unaffected.
    const base = members.find((m) => m.source === 'osm' && m.category !== 'light') ?? members.find((m) => m.source === 'osm') ?? byAuthority[0];
    const merged = { ...base };
    for (const field of LIGHT_FIELDS) {
      for (const member of byAuthority) {
        if (member[field] !== null && member[field] !== undefined && member[field] !== '') {
          merged[field] = member[field];
          break;
        }
      }
    }
    let sectors = base.lightSectors ?? [];
    for (const member of members) {
      if (member === base) continue;
      sectors = mergeLightSectors(sectors, member.lightSectors ?? []);
    }
    merged.lightSectors = sectors;
    if (members.some((m) => m.fogSignal)) merged.fogSignal = true;
    if (members.some((m) => m.radarReflector)) merged.radarReflector = true;
    for (const member of byAuthority) {
      if (member === base) continue;
      for (const [key, value] of Object.entries(member)) {
        if (POSITION_FIELDS.has(key) || LIGHT_FIELDS.includes(key)) continue;
        const current = merged[key];
        if ((current === null || current === undefined || current === '') &&
          value !== null && value !== undefined && value !== '') {
          merged[key] = value;
        }
      }
    }
    if (merged.light || merged.lightCharacter || (merged.lightSectors?.length ?? 0) > 0) {
      merged.lit = true;
    }
    merged.sources = [...new Set(members.map((m) => m.source).filter(Boolean))];
    return merged;
  });

  return { navaids, removed: items.length - navaids.length };
}

export function cellKey(lat, lon, size = DEFAULT_CELL_SIZE) {
  return `${Math.floor(lat / size)}:${Math.floor(lon / size)}`;
}

export function cellBounds(key, size = DEFAULT_CELL_SIZE) {
  const [latIndex, lonIndex] = key.split(':').map(Number);
  return [latIndex * size, lonIndex * size, (latIndex + 1) * size, (lonIndex + 1) * size];
}

export function minZoomFor(category) {
  return MIN_ZOOM[category] ?? 14;
}

export function priorityFor(category) {
  return PRIORITY[category] ?? PRIORITY.other;
}

/**
 * Visible marks: filters to the viewport, then caps the result by priority
 * and proximity to the chart centre. Mark classes are governed solely by the
 * Legend & mark filters — there is no zoom declutter any more.
 */
export function selectVisibleNavaids(navaids, options) {
  const { bounds } = options;
  const limit = options.limit ?? SHOW_ALL_LIMIT;
  const [south, west, north, east] = bounds;
  const centre = options.center ?? [(south + north) / 2, (west + east) / 2];

  const inView = navaids.filter((n) => {
    if (n.category === 'communication_area' && Array.isArray(n.paths)) {
      return n.paths.some((path) => {
        const lats = path.map(([lat]) => lat);
        const lons = path.map(([, lon]) => lon);
        return Math.min(...lats) <= north && Math.max(...lats) >= south && Math.min(...lons) <= east && Math.max(...lons) >= west;
      });
    }
    return n.lat >= south && n.lat <= north && n.lon >= west && n.lon <= east;
  });
  const visible = inView;
  if (visible.length <= limit) return visible;

  const scored = visible.map((n) => ({
    n,
    score:
      priorityFor(n.category) * 1000 -
      distanceMeters(centre[0], centre[1], n.lat, n.lon) / 100,
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((entry) => entry.n);
}

export const CATEGORY_LABELS = {
  lateral_port: 'Port-hand lateral mark',
  lateral_starboard: 'Starboard-hand lateral mark',
  preferred_channel_port: 'Preferred channel to port (bifurcation)',
  preferred_channel_starboard: 'Preferred channel to starboard (bifurcation)',
  lateral_other: 'Lateral mark',
  cardinal_north: 'North cardinal mark',
  cardinal_east: 'East cardinal mark',
  cardinal_south: 'South cardinal mark',
  cardinal_west: 'West cardinal mark',
  cardinal_unspecified: 'Cardinal mark (direction unspecified)',
  safe_water: 'Safe water mark',
  isolated_danger: 'Isolated danger mark',
  special_purpose: 'Special purpose mark',
  range: 'Leading / range mark',
  major_light: 'Major light',
  light: 'Minor light',
  hazard: 'Hazard',
  hazard_danger: 'Dangerous wreck',
  landmark: 'Landmark',
  marina: 'Marina / harbour',
  facility: 'Small craft facility',
  mooring: 'Mooring',
  transit_front: 'Transit front (lower)',
  transit_rear: 'Transit rear (higher)',
  wreck: 'Wreck',
  anchorage: 'Anchorage',
  anchor_berth: 'Anchor berth',
  calling_in_point: 'Calling-in point',
  communication_area: 'Vessel reporting / communication area',
  notice: 'Notice mark',
  gate: 'Gate / start-finish mark',
  wind_turbine: 'Wind turbine',
  wind_farm: 'Wind farm',
  oil_rig: 'Oil rig',
  pylon: 'Pylon',
  pile: 'Pile',
  cable_overhead: 'Overhead cable',
  other: 'Mark',
};
