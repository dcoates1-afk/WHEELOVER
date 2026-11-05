/**
 * Pure mapping from NOAA ENC Direct ATON features to WHEELOVER Navaid records.
 *
 * Source: NOAA ENC Direct to GIS ArcGIS REST services
 * (https://encdirect.noaa.gov/arcgis/rest/services/encdirect/<band>/MapServer),
 * the same service the app already uses for bridge clearances
 * (scripts/build-bridge-clearances.mjs). ENC Direct does not expose raw S-57
 * object classes; it exposes pre-classified point layers by mark type
 * (Buoy_Lateral, Beacon_Lateral, Light, Landmark, ...). Field lists are
 * identical across bands for a given layer; only the paging id differs
 * (OBJECTID everywhere except approach, which uses a layer-specific .FID).
 *
 * Encoding traps (from ~/workspace/noaa-enc-discovery.md, Nov 5 2026):
 * - COLOUR / CAT* / LITCHR are numeric codes, multi-valued comma-separated
 *   ("6,2,6" = yellow-black-yellow, top to bottom); shapes and several
 *   categories arrive as words (BOYSHP "can", CATLIT "aero light").
 * - Blank values are " " (single space); word values can carry trailing
 *   spaces. Trim everything; treat whitespace-only as null.
 * - One LIGHTS feature per sector (IHO UOC 12.8.6.1); sectors of one light
 *   share an exact position; arcs run clockwise SECTR1 -> SECTR2, wrapping
 *   through 360 when SECTR2 < SECTR1. Group Light features by exact position.
 * - CATLIT "aero light" / "air obstruction light" are aircraft lights, not
 *   navigation marks: filter them out of the Light layer.
 * - Light_Float carries no light fields; its light lives on a co-located
 *   LIGHTS feature. Fog_Signal and Radar_Transponder_Beacon merge into
 *   co-located marks, never plot alone. Radio_Station, Retro_Reflector and
 *   Topmark are skipped as standalone layers.
 * - No STATUS field anywhere; no LITVES layer; no enc_overview band.
 *
 * Enumerations below are the S-57 values verified in the discovery report
 * (IHO S-57 Appendix A excerpts + data confirmation). Unverified values are
 * marked as such in comments and fall through to null rather than a guess,
 * except COLOUR 7 (grey): the standard S-57 catalogue value, the only gap
 * in the otherwise complete 1-13 list, flagged here so a wrong grey is easy
 * to trace.
 */
import { distanceMeters, ialaRegion, priorityFor } from '../shared/navaid-core.mjs';

/** S-57 COLOUR codes (IHO App. A; 2 black data-confirmed; 7 grey by elimination). */
export const COLOUR_WORDS = {
  1: 'white', 2: 'black', 3: 'red', 4: 'green', 5: 'blue', 6: 'yellow',
  7: 'grey', 8: 'brown', 9: 'amber', 10: 'violet', 11: 'orange', 12: 'magenta', 13: 'pink',
};

/** IALA light-list letters for the display string (not the beam colour). */
export const COLOUR_LETTERS = {
  white: 'W', black: 'Bk', red: 'R', green: 'G', blue: 'Bu', yellow: 'Y',
  grey: 'Gy', brown: 'Br', amber: 'Am', violet: 'Vi', orange: 'Or', magenta: 'Mg', pink: 'Pk',
};

/** S-57 LITCHR codes (verified 1-11 and 28; anything else is not a charted light character). */
export const LITCHR_CODES = {
  1: 'F', 2: 'Fl', 3: 'LFl', 4: 'Q', 5: 'VQ', 6: 'UQ', 7: 'Iso', 8: 'Oc',
  9: 'IQ', 10: 'IVQ', 11: 'IUQ', 28: 'Al',
};

/** S-57 CATLAM: 1 port, 2 starboard (2 verified in a DTON report; 1 data-consistent). 3/4 are the standard preferred-channel values. */
export const CATLAM_CATEGORIES = {
  1: 'lateral_port', 2: 'lateral_starboard',
  3: 'preferred_channel_port', 4: 'preferred_channel_starboard',
};

/** S-57 CATCAM: 1 north, 2 east, 4 west data-verified via IALA banding; 3 south by elimination. */
export const CATCAM_CATEGORIES = { 1: 'cardinal_north', 2: 'cardinal_east', 3: 'cardinal_south', 4: 'cardinal_west' };

/** IALA banding (top-to-bottom colour codes) that identifies a cardinal direction when CATCAM is blank. */
export const CARDINAL_BANDING = {
  '2,6': 'cardinal_north', '2,6,2': 'cardinal_east', '6,2': 'cardinal_south', '6,2,6': 'cardinal_west',
};

/** ENC Direct BOYSHP words -> app shape values. */
export const BOY_SHAPES = {
  can: 'can', conical: 'conical', spar: 'spar', spherical: 'sphere',
  pillar: 'pillar', barrel: 'barrel', cylindrical: 'cylinder',
};

/** S-57 TOPSHP codes -> daymark board shapes (19 square observed; 21 rectangle and 12 rhombus from the Inland Encoding Guide). */
export const TOPSHP_BOARDS = {
  19: 'square', 21: 'rectangle', 24: 'triangle', 25: 'triangle, point down', 12: 'diamond',
};

/** ENC Direct ATON layers the build fetches, with the S-57 class each one carries. */
export const ATON_LAYERS = [
  'Beacon_Lateral', 'Beacon_Cardinal', 'Beacon_Isolated_Danger', 'Beacon_Safe_Water',
  'Beacon_Special_Purpose_General', 'Buoy_Cardinal', 'Buoy_Isolated_Danger', 'Buoy_Lateral',
  'Buoy_Safe_Water', 'Buoy_Special_Purpose_General', 'Daymark', 'Fog_Signal', 'Light',
  'Light_Float', 'Landmark', 'Offshore_Platform', 'Pile', 'Radar_Transponder_Beacon',
];

/** Layers that never plot alone: their records attach to a co-located mark. */
export const ATTACH_ONLY_LAYERS = new Set(['Daymark', 'Fog_Signal', 'Radar_Transponder_Beacon']);

/** Bands in detail order: the first band holding an aid is the one kept at dedupe. */
export const BAND_ORDER = ['enc_harbour', 'enc_approach', 'enc_coastal', 'enc_general', 'enc_berthing'];

/** CATLIT word values that are aircraft/obstruction lights, not navigation marks. */
const NON_NAVIGATION_LIGHTS = new Set(['aero light', 'air obstruction light']);

/** Trim a value; whitespace-only, null, undefined and NaN become null. */
export function clean(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

/** Split a comma-separated coded list into trimmed tokens. */
export function splitCodes(value) {
  const text = clean(value);
  if (text === null) return [];
  return text.split(',').map((token) => token.trim()).filter(Boolean);
}

/** S-57 COLOUR codes -> colour words, in banded (top-to-bottom) order. */
export function colourWords(value) {
  const words = [];
  for (const token of splitCodes(value)) {
    const word = COLOUR_WORDS[Number(token)];
    if (word) words.push(word);
  }
  return words;
}

/** The painted colours of a mark, ";"-joined in banded order (the renderer splits on [;,]). */
export function colourBanding(value) {
  const words = colourWords(value);
  return words.length > 0 ? words.join(';') : null;
}

/** First colour word, for the light beam and the structure colour fallback. */
export function firstColour(value) {
  return colourWords(value)[0] ?? null;
}

/** SIGGRP "(2)" / "2" -> "2"; "()" / blank -> null. */
export function groupNumber(value) {
  const text = clean(value);
  if (text === null) return null;
  const match = /(\d+)/.exec(text);
  return match ? match[1] : null;
}

/** Racon SIGGRP "(N)" -> "N": the Morse letter, not a flash count. */
export function morseLetter(value) {
  const text = clean(value);
  if (text === null) return null;
  const letter = text.replace(/[()]/g, '').trim();
  return /^[A-Za-z]$/.test(letter) ? letter.toUpperCase() : null;
}

/** SIGPER "25.0" -> "25"; "0.5" stays "0.5". */
export function periodSeconds(value) {
  const text = clean(value);
  if (text === null) return null;
  return text.replace(/\.0+$/, '');
}

/** A bearing "61.0" -> "61"; "214.0" -> "214". Bearings are drawn from the number, the string is the record. */
export function bearingString(value) {
  const text = clean(value);
  if (text === null) return null;
  return text.replace(/\.0+$/, '');
}

/** SORDAT "20131001" -> "2013-10-01"; "200704" -> "2007-04". Anything else -> null. */
export function sourceDate(value) {
  const text = clean(value);
  if (text === null) return null;
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  if (/^\d{6}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}`;
  return null;
}

/**
 * Build an IALA light-list string from the coded fields, e.g. "Fl(2) R W 10s",
 * "F R", "Iso W 6s". Unknown character codes leave the character blank rather
 * than inventing one; a light with no character, colour or period has no string.
 */
export function lightString({ character, group, colours, period }) {
  const parts = [];
  // A group of one is written without the group: "Fl", not "Fl(1)".
  if (character) parts.push(group && group !== '1' ? `${character}(${group})` : character);
  for (const word of colours ?? []) {
    const letter = COLOUR_LETTERS[word];
    if (letter) parts.push(letter);
  }
  if (period) parts.push(`${period}s`);
  return parts.length > 0 ? parts.join(' ') : null;
}

/** Light fields shared by a Light feature and its sectors. */
export function lightFields(attrs) {
  const character = LITCHR_CODES[Number(clean(attrs.LITCHR))] ?? null;
  const group = groupNumber(attrs.SIGGRP);
  const colours = colourWords(attrs.COLOUR);
  const period = periodSeconds(attrs.SIGPER);
  return {
    character,
    group,
    colours,
    period,
    light: lightString({ character, group, colours, period }),
    lightColour: colours[0] ?? null,
    lightSequence: clean(attrs.SIGSEQ),
    range: clean(attrs.VALNMR) === null ? null : periodSeconds(attrs.VALNMR),
    height: clean(attrs.HEIGHT) === null ? null : periodSeconds(attrs.HEIGHT),
  };
}

/** One sector entry for a Light feature, or null when it carries no sector bearings. */
export function sectorEntry(attrs, sectorNumber) {
  const start = bearingString(attrs.SECTR1);
  const end = bearingString(attrs.SECTR2);
  if (start === null || end === null) return null;
  const fields = lightFields(attrs);
  return {
    sector: sectorNumber,
    character: fields.character ?? undefined,
    colour: fields.lightColour ?? undefined,
    group: fields.group ?? undefined,
    period: fields.period ?? undefined,
    sequence: fields.lightSequence ?? undefined,
    start,
    end,
    range: fields.range ?? undefined,
    orientation: clean(attrs.ORIENT) ?? undefined,
  };
}

/** A Light feature whose CATLIT marks it as an aircraft/obstruction light, not a navigation mark. */
export function isNonNavigationLight(attrs) {
  const catlit = clean(attrs.CATLIT);
  return catlit !== null && NON_NAVIGATION_LIGHTS.has(catlit.toLowerCase());
}

/**
 * A Landmark that is a lighthouse. FUNCTN 33 marks a landmark that carries a
 * light, not a lighthouse specifically: airport beacons, monuments, towers,
 * terminals and traffic lights all carry it (observed in the data: "Miami
 * International Airport Light", "Perry Memorial Monument Light", "Traffic
 * Light"). So a name, when one exists, must say the aid IS a light — "Light",
 * "Lighthouse", "Lights", "Lt" — and must not say it is something else that
 * carries one. A bare place name (Jacksonville, Fort Pierce) is a landmark,
 * not a light. With no name at all there is nothing to contradict, and a lit
 * landmark reads as a lighthouse tower.
 */
const NON_LIGHTHOUSE_WORDS = [
  'airport', 'airfield', 'aero', 'air force', 'monument', 'tower',
  'terminal', 'traffic', 'beam',
];

export function isLighthouse(attrs) {
  const functn33 = Number(clean(attrs.FUNCTN)) === 33;
  const name = clean(attrs.OBJNAM);
  const nameEndsLighthouse = name !== null && name.toLowerCase().endsWith('lighthouse');
  if (!functn33 && !nameEndsLighthouse) return false;
  if (name === null) return functn33;
  const lower = name.toLowerCase();
  if (!/light|lighthouse|\blt\b/.test(lower)) return false;
  return !NON_LIGHTHOUSE_WORDS.some((word) => lower.includes(word));
}

/**
 * Lateral category for a buoy/beacon: CATLAM wins; otherwise the first red or
 * green colour with the IALA region at the position (Region B: red starboard,
 * green port; Region A: the reverse). No hand and no red/green -> lateral_other.
 */
export function lateralCategory(attrs, lat, lon) {
  const catlam = Number(clean(attrs.CATLAM));
  if (CATLAM_CATEGORIES[catlam]) return CATLAM_CATEGORIES[catlam];
  const colours = colourWords(attrs.COLOUR);
  const sideColour = colours.find((word) => word === 'red' || word === 'green');
  if (!sideColour) return 'lateral_other';
  const region = ialaRegion(lat, lon);
  const isStarboard = (sideColour === 'red') === (region === 'B');
  return isStarboard ? 'lateral_starboard' : 'lateral_port';
}

/**
 * Cardinal category for a buoy/beacon: CATCAM wins; otherwise the IALA banding
 * (black-yellow = north, black-yellow-black = east, yellow-black = south,
 * yellow-black-yellow = west). Unresolvable -> null (the record is dropped,
 * not drawn with a guessed direction).
 */
export function cardinalCategory(attrs) {
  const catcam = Number(clean(attrs.CATCAM));
  if (CATCAM_CATEGORIES[catcam]) return CATCAM_CATEGORIES[catcam];
  const banding = splitCodes(attrs.COLOUR).join(',');
  return CARDINAL_BANDING[banding] ?? null;
}

/** Common record fields every mapped ENC feature carries. */
function baseRecord({ layer, band, objectId, lat, lon, attrs }) {
  return {
    id: `noaa-enc:${layer}:${objectId}`,
    lat,
    lon,
    name: clean(attrs.OBJNAM),
    description: clean(attrs.INFORM),
    source: 'noaa-enc',
    sourceCitation: 'NOAA ENC Direct to GIS',
    sourceUrl: `https://encdirect.noaa.gov/arcgis/rest/services/encdirect/${band}/MapServer`,
    sourceDate: sourceDate(attrs.SORDAT),
    lit: false,
    light: null,
    lightCharacter: null,
    lightColour: null,
    lightPeriod: null,
    lightSequence: null,
    lightSectors: null,
    colour: null,
    shape: null,
    height: null,
    range: null,
    fogSignal: false,
    fogSignalCategory: null,
    fogSignalGroup: null,
    fogSignalPeriod: null,
    fogSignalSequence: null,
    radarTransponderCategory: null,
    radarTransponderGroup: null,
    radarTransponderPeriod: null,
    radarTransponderSequence: null,
    daymarkShape: null,
    daymarkColour: null,
    path: null,
    paths: null,
    transitBearing: null,
    transitDistanceM: null,
    transitPartner: null,
    transitPartnerName: null,
    channel: null,
    updated: null,
    region: null,
  };
}

/** Finish a mapped record: priority from its category, and the category itself. */
function finish(record, category, form) {
  return { ...record, category, form, priority: priorityFor(category) };
}

/** Map one ENC Direct feature to a Navaid record (or null when the feature is not a mark). */
export function mapFeature({ layer, band, objectId, lat, lon, attrs }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const base = baseRecord({ layer, band, objectId, lat, lon, attrs });
  const colour = colourBanding(attrs.COLOUR);
  switch (layer) {
    case 'Light': {
      if (isNonNavigationLight(attrs)) return null;
      const fields = lightFields(attrs);
      const sector = sectorEntry(attrs, 1);
      const record = {
        ...base,
        lit: true,
        light: fields.light,
        lightCharacter: fields.character,
        lightColour: fields.lightColour,
        lightPeriod: fields.period,
        lightSequence: fields.lightSequence,
        lightSectors: sector ? [sector] : null,
        colour,
        height: fields.height,
        range: fields.range,
      };
      // Sectors are grouped by position in groupLightFeatures; a lone sector
      // feature is already a sector beacon, a plain feature a minor light.
      // Directional lights (ORIENT, no bearings) stay minor lights with the
      // orientation carried on the sector entry.
      if (sector) return finish(record, 'sector_beacon', 'light');
      if (clean(attrs.ORIENT) !== null) {
        record.lightSectors = [{
          sector: 1,
          character: fields.character ?? undefined,
          colour: fields.lightColour ?? undefined,
          group: fields.group ?? undefined,
          period: fields.period ?? undefined,
          sequence: fields.lightSequence ?? undefined,
          orientation: clean(attrs.ORIENT),
        }];
      }
      return finish(record, 'light', 'light');
    }
    case 'Light_Float': {
      // No light fields on the layer: the LIGHTS join (joinLightFloats) fills
      // them from a co-located Light feature. Until then it is an unlit float.
      return finish({ ...base, colour }, 'light', 'buoy');
    }
    case 'Buoy_Lateral': {
      const shape = BOY_SHAPES[clean(attrs.BOYSHP)?.toLowerCase()] ?? null;
      return finish({ ...base, colour, shape }, lateralCategory(attrs, lat, lon), 'buoy');
    }
    case 'Buoy_Cardinal': {
      const category = cardinalCategory(attrs);
      if (category === null) return null;
      const shape = BOY_SHAPES[clean(attrs.BOYSHP)?.toLowerCase()] ?? null;
      return finish({ ...base, colour, shape }, category, 'buoy');
    }
    case 'Buoy_Isolated_Danger': {
      const shape = BOY_SHAPES[clean(attrs.BOYSHP)?.toLowerCase()] ?? null;
      return finish({ ...base, colour, shape }, 'isolated_danger', 'buoy');
    }
    case 'Buoy_Safe_Water': {
      const shape = BOY_SHAPES[clean(attrs.BOYSHP)?.toLowerCase()] ?? null;
      return finish({ ...base, colour, shape }, 'safe_water', 'buoy');
    }
    case 'Buoy_Special_Purpose_General': {
      const shape = BOY_SHAPES[clean(attrs.BOYSHP)?.toLowerCase()] ?? null;
      return finish({ ...base, colour, shape }, 'special_purpose', 'buoy');
    }
    case 'Beacon_Lateral':
      return finish({ ...base, colour }, lateralCategory(attrs, lat, lon), 'beacon');
    case 'Beacon_Cardinal': {
      const category = cardinalCategory(attrs);
      if (category === null) return null;
      return finish({ ...base, colour }, category, 'beacon');
    }
    case 'Beacon_Isolated_Danger':
      return finish({ ...base, colour }, 'isolated_danger', 'beacon');
    case 'Beacon_Safe_Water':
      return finish({ ...base, colour }, 'safe_water', 'beacon');
    case 'Beacon_Special_Purpose_General':
      return finish({ ...base, colour }, 'special_purpose', 'beacon');
    case 'Landmark': {
      const lighthouse = isLighthouse(attrs);
      return finish(
        { ...base, colour, height: clean(attrs.HEIGHT) === null ? null : periodSeconds(attrs.HEIGHT) },
        lighthouse ? 'lighthouse' : 'landmark',
        'landmark',
      );
    }
    case 'Offshore_Platform': {
      const catofp = (clean(attrs.CATOFP) ?? '').toLowerCase();
      const category = catofp.includes('wind') ? 'wind_turbine' : 'oil_rig';
      return finish({ ...base, colour }, category, 'mark');
    }
    case 'Pile':
      return finish({ ...base, colour }, 'pile', 'mark');
    default:
      return null;
  }
}

/**
 * Group Light records by exact position into one record per light, unioning
 * sectors across bands and collapsing exact-duplicate sectors. A position
 * holding any sector becomes a sector beacon; a plain Light feature at the
 * same position supplies the top-level light string when one exists.
 */
export function groupLightFeatures(records) {
  const groups = new Map();
  for (const record of records) {
    const key = `${record.lat.toFixed(6)}:${record.lon.toFixed(6)}`;
    const group = groups.get(key) ?? { plain: null, sectorRecord: null, sectors: [], names: [] };
    if (record.name) group.names.push(record.name);
    // Only charted sectors (both bearings) count as sectors. An orientation-only
    // entry is a directional light, not a sector: it stays on its own record.
    const charted = (record.lightSectors ?? []).filter((s) => s.start != null && s.end != null);
    if (charted.length > 0) {
      group.sectors.push(...charted);
      group.sectorRecord ??= record;
    } else if (!group.plain) {
      group.plain = record;
    }
    groups.set(key, group);
  }
  const out = [];
  for (const [key, group] of groups) {
    const seen = new Set();
    const sectors = [];
    for (const sector of group.sectors) {
      const sectorKey = [sector.start, sector.end, sector.colour, sector.character, sector.group, sector.period].join('|');
      if (seen.has(sectorKey)) continue;
      seen.add(sectorKey);
      sectors.push(sector);
    }
    sectors.sort((a, b) => a.sector - b.sector);
    // Renumber sequentially: sector numbers only order the arcs.
    sectors.forEach((sector, index) => { sector.sector = index + 1; });
    // The anchor record carries position, name and id; sectors come from the group.
    const base = group.plain ?? group.sectorRecord;
    if (!base) continue;
    const name = group.names[0] ?? base.name;
    const sectorSource = group.sectorRecord;
    out.push({
      ...base,
      name,
      light: group.plain?.light ?? sectorSource?.light ?? null,
      lightCharacter: group.plain?.lightCharacter ?? sectorSource?.lightCharacter ?? null,
      lightColour: group.plain?.lightColour ?? sectorSource?.lightColour ?? null,
      lightPeriod: group.plain?.lightPeriod ?? sectorSource?.lightPeriod ?? null,
      lightSequence: group.plain?.lightSequence ?? sectorSource?.lightSequence ?? null,
      lightSectors: sectors.length > 0 ? sectors : (group.plain?.lightSectors ?? null),
      category: sectors.length > 0 ? 'sector_beacon' : 'light',
      form: 'light',
      priority: priorityFor(sectors.length > 0 ? 'sector_beacon' : 'light'),
      lit: true,
    });
  }
  return out;
}

/**
 * Fill each Light_Float from the grouped Light at its exact position. A float
 * with no co-located Light stays unlit (lit false, no light fields).
 */
export function joinLightFloats(floats, groupedLights) {
  const byPosition = new Map();
  for (const light of groupedLights) {
    byPosition.set(`${light.lat.toFixed(6)}:${light.lon.toFixed(6)}`, light);
  }
  return floats.map((float) => {
    const light = byPosition.get(`${float.lat.toFixed(6)}:${float.lon.toFixed(6)}`);
    if (!light) return float;
    return {
      ...float,
      lit: true,
      light: light.light,
      lightCharacter: light.lightCharacter,
      lightColour: light.lightColour,
      lightPeriod: light.lightPeriod,
      lightSequence: light.lightSequence,
      lightSectors: light.lightSectors,
    };
  });
}

const SIGNAL_JOIN_M = 25;

/** Nearest mark within 25 m of a signal record, or null. */
export function nearestMark(marks, lat, lon) {
  let best = null;
  let bestDistance = SIGNAL_JOIN_M;
  for (const mark of marks) {
    const metres = distanceMeters(lat, lon, mark.lat, mark.lon);
    if (metres <= bestDistance) {
      best = mark;
      bestDistance = metres;
    }
  }
  return best;
}

/**
 * Attach fog signals, racons and daymarks to the nearest mark within 25 m.
 * Orphan signals (no mark that close) are dropped, not plotted alone: a bell,
 * a racon letter or a board without its aid is a floating dot, not a mark.
 * Returns { marks, attached, orphaned } with counts per signal kind.
 */
export function joinSignals(marks, fogSignals, racons, daymarks) {
  const attached = { fog: 0, racon: 0, daymark: 0 };
  const orphaned = { fog: 0, racon: 0, daymark: 0 };
  for (const signal of fogSignals) {
    const mark = nearestMark(marks, signal.lat, signal.lon);
    if (!mark) { orphaned.fog += 1; continue; }
    mark.fogSignal = true;
    mark.fogSignalCategory = (clean(signal.attrs.CATFOG) ?? '').toLowerCase() || null;
    mark.fogSignalGroup = groupNumber(signal.attrs.SIGGRP);
    mark.fogSignalPeriod = periodSeconds(signal.attrs.SIGPER);
    mark.fogSignalSequence = clean(signal.attrs.SIGSEQ);
    attached.fog += 1;
  }
  for (const signal of racons) {
    const mark = nearestMark(marks, signal.lat, signal.lon);
    if (!mark) { orphaned.racon += 1; continue; }
    mark.radarTransponderCategory = 'racon';
    mark.radarTransponderGroup = morseLetter(signal.attrs.SIGGRP);
    mark.radarTransponderPeriod = periodSeconds(signal.attrs.SIGPER);
    mark.radarTransponderSequence = clean(signal.attrs.SIGSEQ);
    attached.racon += 1;
  }
  for (const signal of daymarks) {
    const mark = nearestMark(marks, signal.lat, signal.lon);
    if (!mark) { orphaned.daymark += 1; continue; }
    const board = TOPSHP_BOARDS[Number(clean(signal.attrs.TOPSHP))] ?? null;
    if (board) mark.daymarkShape = board;
    const colour = firstColour(signal.attrs.COLOUR);
    if (colour) mark.daymarkColour = colour;
    attached.daymark += 1;
  }
  return { marks, attached, orphaned };
}
