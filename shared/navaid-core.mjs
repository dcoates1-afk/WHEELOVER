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
  if (tags['seamark:light:character']) return 'light';
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
    if (lightChar) return { ...base, category: 'light', priority: PRIORITY.light };
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

  if (AREA_TYPES.has(type)) return null;

  if (type === 'lighthouse' || type === 'landmark' || type === 'mast' || type === 'tower') {
    if (type === 'lighthouse' || tags['seamark:light:character']) {
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

  if (type === 'rock' || type === 'obstruction' || type === 'pile') {
    return { ...base, category: 'hazard', priority: PRIORITY.hazard };
  }

  if (type === 'harbour') {
    return { ...base, category: 'marina', priority: PRIORITY.marina };
  }

  if (
    type === 'small_craft_facility' ||
    type === 'mooring' ||
    type === 'berth' ||
    type === 'bridge' ||
    type === 'causeway' ||
    type === 'platform' ||
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
    return { ...base, category: 'facility', priority: PRIORITY.facility };
  }

  // Unknown but lit point marks still deserve plotting.
  if (lit && !AREA_TYPES.has(type)) {
    return { ...base, category: 'light', priority: PRIORITY.light };
  }
  return null;
}

export function lightText(tags) {
  const sector = lightSectorsFromTags(tags).find((entry) => entry.character);
  const character = tags['seamark:light:character'] ?? sector?.character;
  if (!character) return null;
  const group = tags['seamark:light:group'] ?? sector?.group;
  const colour = tags['seamark:light:colour'] ?? sector?.colour;
  const period = tags['seamark:light:period'] ?? sector?.period;
  const char = group ? `${character}(${group})` : character;
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
  
  // Adding +360 handles cases near 0/360 smoothly, ensuring a clean vertical axis reflection line
  const mirror = (bearing) => (360 - bearing + 360) % 360;
  
  // The swap is required to reverse the arc's drawing direction, keeping North/South locked down
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
  return Array.from({ length: steps + 1 }, (_, index) => {
    const bearing = (start + span * index / steps) * Math.PI / 180;
    const angularDistance = radiusMeters / radius;
    const destinationLatitude = Math.asin(
      Math.sin(latitude) * Math.cos(angularDistance) +
      Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearing),
    );
    const destinationLongitude = longitude + Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude),
      Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(destinationLatitude),
    );
    return /** @type {[number, number]} */ ([
      destinationLatitude * 180 / Math.PI,
      ((destinationLongitude * 180 / Math.PI + 540) % 360) - 180,
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

function lightSectorsFromTags(tags) {
  const sectors = new Map();
  const shared = {};
  for (const [key, rawValue] of Object.entries(tags)) {
    if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') continue;
    const value = String(rawValue).trim();
    const match = /^seamark:light:(?:(\d+):)?(character|colour|group|period|sequence|sector_start|sector_end|range|visibility|exhibition|category|orientation|height|multiple)$/.exec(key);
    if (!match) continue;
    const sector = match[1] ? Number(match[1]) : 1;
    const record = sectors.get(sector) ?? { sector };
    const field = LIGHT_SECTOR_FIELDS[match[2]];
    if (match[1]) record[field] = value;
    else shared[field] = value;
    sectors.set(sector, record);
  }
  return mergeLightSectors([...sectors.values()].map((sector) => ({ ...shared, ...sector })));
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
  const areaMidpoint = allGeometry.length > 0 && type === 'communication_area'
    ? [
        (Math.min(...allGeometry.map(([lat]) => lat)) + Math.max(...allGeometry.map(([lat]) => lat))) / 2,
        (Math.min(...allGeometry.map(([, lon]) => lon)) + Math.max(...allGeometry.map(([, lon]) => lon))) / 2,
      ]
    : allGeometry.length > 0 ? allGeometry[Math.floor(allGeometry.length / 2)] : null;

  const lat = element.lat ?? element.center?.lat ?? (type === 'communication_area' ? areaMidpoint?.[0] : midpoint?.[0]);
  const lon = element.lon ?? element.center?.lon ?? (type === 'communication_area' ? areaMidpoint?.[1] : midpoint?.[1]);
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

  for (const item of items) {
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
          const metres = distanceMeters(item.lat, item.lon, other.lat, other.lon);
          if (metres > distance) continue;
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
    accepted[duplicateOf] = {
      ...preferred,
      lightSectors: mergeLightSectors(preferred.lightSectors ?? [], other.lightSectors ?? []),
      // A duplicate record may be the only one carrying the sound or racon
      // signal; keeping both halves avoids silently dropping a charted aid.
      fogSignal: preferred.fogSignal || other.fogSignal,
      fogSignalCategory: preferred.fogSignalCategory ?? other.fogSignalCategory,
      fogSignalGroup: preferred.fogSignalGroup ?? other.fogSignalGroup,
      fogSignalPeriod: preferred.fogSignalPeriod ?? other.fogSignalPeriod,
      fogSignalSequence: preferred.fogSignalSequence ?? other.fogSignalSequence,
      radarTransponderCategory: preferred.radarTransponderCategory ?? other.radarTransponderCategory,
      radarTransponderGroup: preferred.radarTransponderGroup ?? other.radarTransponderGroup,
      radarTransponderPeriod: preferred.radarTransponderPeriod ?? other.radarTransponderPeriod,
      radarTransponderSequence: preferred.radarTransponderSequence ?? other.radarTransponderSequence,
      radarReflector: preferred.radarReflector || other.radarReflector,
    };
  }

  return { navaids: accepted, removed };
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
 * Zoom declutter. Honours "Show all marks", filters to the viewport, then caps
 * the result by priority and proximity to the chart centre.
 */
export function selectVisibleNavaids(navaids, options) {
  const { zoom, bounds, showAll = false } = options;
  const limit = options.limit ?? (showAll ? SHOW_ALL_LIMIT : DEFAULT_MARK_LIMIT);
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
  const visible = showAll ? inView : inView.filter((n) => zoom >= minZoomFor(n.category));
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
  other: 'Mark',
};
