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
  preferred_channel_port: 86,
  preferred_channel_starboard: 86,
  lateral_starboard: 84,
  lateral_port: 84,
  hazard_danger: 78,
  // Calling-in points are harbour-control reporting lines, so they matter as
  // much as a buoy when planning an approach through a narrow pass.
  calling_in_point: 76,
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
  const lightChar = tags['seamark:light:character'];
  const category = firstTag(tags, [
    `seamark:${type}:category`,
    'seamark:category',
    'seamark:light:category',
  ]);
  const form = formFor(type, tags);
  const lit = Boolean(lightChar || tags['seamark:light:colour'] || tags['seamark:light:range']);
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
    const key = ['north', 'east', 'south', 'west'].includes(side) ? `cardinal_${side}` : 'cardinal_north';
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
  const character = tags['seamark:light:character'];
  if (!character) return null;
  const group = tags['seamark:light:group'];
  const colour = tags['seamark:light:colour'];
  const period = tags['seamark:light:period'];
  const char = group ? `${character}(${group})` : character;
  return [char, colour, period ? `${period}s` : null].filter(Boolean).join(' ');
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
function wreckDetail(type, tags) {
  if (type !== 'wreck') return null;
  const water = tags['seamark:wreck:water_level'];
  const depth = tags['seamark:wreck:depth'];
  const parts = [
    water ? water.replace(/_/g, ' ') : null,
    depth ? `${depth} m charted depth` : null,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return parts.join(' · ').replace(/^./, (c) => c.toUpperCase());
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

  const lat = element.lat ?? element.center?.lat ?? midpoint?.[0];
  const lon = element.lon ?? element.center?.lon ?? midpoint?.[1];
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;

  const kind = element.type || 'node';
  const id = element.id !== undefined ? `osm:${kind}/${element.id}` : `osm:${kind}/${lat.toFixed(5)}/${lon.toFixed(5)}`;

  const colour = firstTag(tags, [
    `seamark:${type}:colour`,
    'seamark:light:colour',
    'seamark:topmark:colour',
  ]);
  const shape = firstTag(tags, [
    `seamark:${type}:shape`,
    'seamark:topmark:shape',
    'seamark:topmark',
  ]);

  return {
    id,
    lat,
    lon,
    category: classified.category,
    form: classified.form,
    name: firstTag(tags, ['seamark:name', 'name', 'ref']),
    light: lightText(tags),
    colour,
    shape,
    height: firstTag(tags, [`seamark:${type}:height`, 'seamark:light:height', 'height']),
    range: firstTag(tags, ['seamark:light:range']),
    path: drawnAsLine ? path : null,
    // Filled in by annotateTransits once the other end of the transit is known.
    transitBearing: null,
    transitDistanceM: null,
    transitPartner: null,
    transitPartnerName: null,
    channel: firstTag(tags, [`seamark:${type}:channel`, 'seamark:radio_station:channel']),
    description:
      firstTag(tags, ['description', 'note']) ??
      berthDetail(type, tags) ??
      wreckDetail(type, tags),
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
  for (const key of ['name', 'light', 'colour', 'shape', 'height', 'range', 'description']) {
    if (navaid[key]) score += 1;
  }
  if (navaid.source === 'osm') score += 2;
  return score;
}

/**
 * Merge records that describe the same physical mark: same name within 60 m,
 * or any two aids of the same family within 15 m. The richer record wins.
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
          if (sameName || (sameFamily && metres <= 15) || metres <= 12) {
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
    if (richness(item) > richness(accepted[duplicateOf])) {
      accepted[duplicateOf] = item;
    }
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

  const inView = navaids.filter(
    (n) => n.lat >= south && n.lat <= north && n.lon >= west && n.lon <= east,
  );
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
  notice: 'Notice mark',
  gate: 'Gate / start-finish mark',
  other: 'Mark',
};
