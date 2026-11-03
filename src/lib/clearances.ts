/**
 * Bridge clearances from authority datasets, joined to the bridges the chart
 * draws from OpenStreetMap.
 *
 * The one rule that shapes this module: a clearance figure is only usable
 * for judging passage at a given tide if the water level it was measured
 * from is known. So every figure carries its datum, and a figure whose
 * datum cannot be recovered is labelled "datum not stated" and must never
 * drive a tide-adjusted pass/fail — it is shown as a charted figure only.
 *
 * Sources (built by scripts/build-bridge-clearances.mjs into
 * public/bridge-clearances/):
 *  - NOAA ENC (US coastal waters): metres above Mean High Water, unless a
 *    per-feature VERDAT says otherwise.
 *  - USACE Inland ENC (US rivers): metres, datum not stated in the GIS feed.
 *  - EuRIS (13 European waterway authorities): closed/open heights, joined
 *    by bridge name + waterway (the API carries no coordinates), datum not
 *    stated in the response.
 *  - viadonau Danube list: metres above HNWL (highest navigable water
 *    level), with the reference gauge per bridge, joined by name to bridges
 *    crossing the Danube.
 *  - US Coast Pilot (built by scripts/build-coast-pilot-clearances.mjs):
 *    narrative sailing directions, feet above MHW (Great Lakes volume:
 *    Low Water Datum), converted to metres. Named passages join by name
 *    plus waterway or coordinates; passages that give one least figure
 *    for a group of bridges join by waterway plus kind, and render as a
 *    lower bound (least), never as an exact figure.
 */

export interface BridgeClearance {
  source: string;
  /** Standing (fixed, or closed for a movable bridge) figures, metres. */
  values: number[];
  /** True when every standing figure is a closed figure, not a fixed span. */
  closed: boolean;
  /** Movable-bridge open figures, metres. */
  openValues: number[];
  /** Most restrictive horizontal clearance, metres, if known. */
  horizontal: number | null;
  /** Reference water level, e.g. 'MHW' or 'HNWL'; null means not stated. */
  datum: string | null;
  /** Extra datum detail, e.g. the Danube reference gauge. */
  datumNote: string | null;
  /** True when the figure is a group least (a lower bound), not an exact figure. */
  least?: boolean;
  /** Bridge kind wording from a Coast Pilot passage, for a missing Type/Operation fact. */
  bridgeType?: string | null;
  /** Dataset retrieval date (YYYY-MM-DD) from the manifest. */
  retrieved: string;
}

export interface NoaaClearanceRecord {
  la: number;
  lo: number;
  n: string | null;
  v: number | null;
  c: number | null;
  o: number | null;
  h: number | null;
  d: string | null;
  k: string | null;
  s: string | null;
}

export interface UsaceClearanceRecord {
  la: number;
  lo: number;
  n: string | null;
  v: number | null;
  c: number | null;
  o: number | null;
  h: number | null;
  k: string | null;
  s: string | null;
}

export interface EurisClearanceRecord {
  n: string | null;
  w: string | null;
  hm: string | null;
  c: number | null;
  o: number | null;
  wd: number | null;
  a: string | null;
  l: string | null;
}

export interface DanubeClearanceRecord {
  km: number;
  rb: string;
  n: string;
  use: string;
  h1: number | null;
  w1: number | null;
  d1: string;
  h2: number | null;
  w2: number | null;
  d2: string;
  g: string;
  nt: string;
}

export interface CoastPilotClearanceRecord {
  n: string | null;
  w: string | null;
  la: number | null;
  lo: number | null;
  v: number[];
  c: boolean;
  o: number[] | null;
  h: number | null;
  d: string | null;
  least: boolean;
  g: string | null;
  t: string | null;
  ch: string;
}

export interface EaHeadwayRecord {
  n: string;
  w: string | null;
  v: number[];
  c: boolean;
  d: string | null;
  note: string | null;
  pg: string;
}

export interface ClearanceManifest {
  generatedAt: string;
  sources: Record<string, { label: string; datum: string | null; count: number; retrieved?: string }>;
  incomplete: string[];
}

export interface ClearanceDatasets {
  manifest: ClearanceManifest;
  noaa: NoaaClearanceRecord[];
  usace: UsaceClearanceRecord[];
  euris: EurisClearanceRecord[];
  danube: DanubeClearanceRecord[];
  /** Optional: the file does not exist until the Coast Pilot build runs. */
  coastpilot?: CoastPilotClearanceRecord[];
  /** Optional: the file does not exist until the EA headway build runs. */
  eaheadway?: EaHeadwayRecord[];
}

const EMPTY_DATASETS: ClearanceDatasets = {
  manifest: { generatedAt: '', sources: {}, incomplete: [] },
  noaa: [],
  usace: [],
  euris: [],
  danube: [],
  coastpilot: [],
  eaheadway: [],
};

let datasetsPromise: Promise<ClearanceDatasets> | null = null;

async function fetchDataset<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(path);
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/** Fetch the seven clearance files once; a missing file just means no rows. */
export function loadClearanceDatasets(): Promise<ClearanceDatasets> {
  datasetsPromise ??= (async () => {
    const [manifest, noaa, usace, euris, danube, coastpilot, eaheadway] = await Promise.all([
      fetchDataset<ClearanceManifest>('/bridge-clearances/manifest.json'),
      fetchDataset<NoaaClearanceRecord[]>('/bridge-clearances/noaa.json'),
      fetchDataset<UsaceClearanceRecord[]>('/bridge-clearances/usace.json'),
      fetchDataset<EurisClearanceRecord[]>('/bridge-clearances/euris.json'),
      fetchDataset<DanubeClearanceRecord[]>('/bridge-clearances/danube.json'),
      fetchDataset<CoastPilotClearanceRecord[]>('/bridge-clearances/coastpilot.json'),
      fetchDataset<EaHeadwayRecord[]>('/bridge-clearances/ea-headway.json'),
    ]);
    if (!manifest) return EMPTY_DATASETS;
    return {
      manifest,
      noaa: noaa ?? [],
      usace: usace ?? [],
      euris: euris ?? [],
      danube: danube ?? [],
      coastpilot: coastpilot ?? [],
      eaheadway: eaheadway ?? [],
    };
  })();
  return datasetsPromise;
}

/**
 * S-57 VERDAT codes to the datum a boater reads. Verified against the S-57
 * attribute list and NOAA survey reports: 12 is mean lower low water, not
 * mean high water — getting that backwards would overstate a clearance at
 * high tide by the whole tidal range. Codes outside this list fall back to
 * "chart datum" with the code kept, so nothing is silently relabelled.
 */
const VERDAT_NAMES: Record<string, string> = {
  '1': 'mean low water springs',
  '2': 'mean lower low water springs',
  '3': 'mean sea level',
  '4': 'lowest low water',
  '5': 'mean low water',
  '6': 'lowest low water springs',
  '7': 'approximate mean low water springs',
  '8': 'Indian spring low water',
  '9': 'low water springs',
  '10': 'approximate lowest astronomical tide',
  '11': 'nearly lowest low water',
  '12': 'MLLW',
  '13': 'low water',
  '14': 'approximate mean low water',
  '15': 'approximate mean lower low water',
  '16': 'MHW',
  '17': 'MHWS',
  '18': 'high water',
  '19': 'approximate mean sea level',
  '20': 'high water springs',
  '21': 'MHHW',
  // Extended codes from the IHO vertical-datum lists (S-65 conversion
  // table and the 2019 consistent-use presentation): 24 is a local datum,
  // not a tidal one — the Mississippi records carrying it must never be
  // presented as MHW.
  '22': 'equinoctial spring low water',
  '23': 'lowest astronomical tide',
  '24': 'local datum',
  '25': 'IGLD 1985',
  '26': 'mean water level',
  '27': 'lower low water large tide',
  '28': 'higher high water large tide',
  '29': 'nearly highest high water',
  '30': 'HAT',
};

function decodeVerdat(code: string | null): string | null {
  if (code === null || code === '') return null;
  return VERDAT_NAMES[code] ?? `chart datum VERDAT ${code}`;
}
export interface JoinableBridgeFeature {
  name: string;
  lat: number;
  lon: number;
  path: [number, number][];
  properties: Record<string, string>;
}

/** A clearance record only counts if it sits this close to the mapped crossing. */
const JOIN_TOLERANCE_METERS = 150;

/** Generic bridge words stripped when comparing names across languages. */
const GENERIC_WORDS = new Set([
  'bridge', 'bridges', 'brucke', 'bruecke', 'brug', 'bro', 'broen', 'bron',
  'ponte', 'pont', 'puente', 'most', 'hid', 'silta', 'tilt', 'overpass',
]);

/**
 * Names compared across sources: case, accents, punctuation, a trailing
 * parenthetical place note and generic bridge words do not make a different
 * bridge, so "Maximilianbrücke (Kelheim)" and "Maximilianbrucke" compare
 * equal, and "Eisenbahnbrücke Poikam" keeps its rail/road identity in the
 * remaining words.
 */
export function normalizeBridgeName(name: string): string {
  const words = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((word) => word !== '')
    .map((word) => {
      for (const generic of GENERIC_WORDS) {
        if (word.length > generic.length && word.endsWith(generic)) return word.slice(0, -generic.length);
      }
      return word;
    })
    .filter((word) => word !== '' && !GENERIC_WORDS.has(word));
  return words.join(' ');
}

function namesMatch(a: string, b: string): boolean {
  const na = normalizeBridgeName(a);
  const nb = normalizeBridgeName(b);
  if (na === '' || nb === '') return false;
  if (na === nb) return true;
  if (Math.min(na.length, nb.length) >= 4 && (na.includes(nb) || nb.includes(na))) return true;
  const ta = na.split(' ');
  const tb = nb.split(' ');
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return short.length >= 2 && short.every((word) => long.includes(word));
}

/**
 * A passage name is specific when it carries a proper noun beyond bridge
 * kinds and transport words: "Dumbarton Highway Bridge" is specific,
 * "vertical lift railroad bridge" is not — it names no bridge, only a kind.
 * Specific names must match the feature; generic ones are identified by
 * their coordinates alone.
 */
const NAME_FILLER_WORDS = new Set([
  'bascule', 'lift', 'lifting', 'swing', 'fixed', 'drawbridge', 'transporter',
  'pontoon', 'submersible', 'tilt', 'retractable', 'vertical', 'railroad',
  'railway', 'highway', 'road', 'foot', 'pedestrian', 'cycle', 'bicycle',
  'trestle', 'causeway', 'viaduct', 'aqueduct', 'roadway', 'street',
  'avenue', 'interstate', 'route', 'state', 'county', 'river', 'canal',
]);

function isSpecificBridgeName(name: string): boolean {
  return normalizeBridgeName(name)
    .split(' ')
    .filter((word) => word !== '')
    .some((word) => !NAME_FILLER_WORDS.has(word));
}

/**
 * Environment Agency headway matching is deliberately stricter than the
 * Coast Pilot matcher: EA rows carry no coordinates, so the name is the
 * only identifier. Parentheticals are kept as words (unlike
 * normalizeBridgeName), so 'Road Bridge (GT Barford)' cannot land on any
 * plain 'Road Bridge'; dual names ('X / Y') match on either side; a
 * trailing ', Place' is a location note with a guarded fallback (the
 * pre-comma part must name a bridge on its own); and a single-word side
 * never subset-matches, so 'Footbridge' cannot join every footbridge on
 * the river.
 */
const EA_STOPWORDS = new Set(['and', 'of', 'the', 'at', 'near', 'd', 's', 'u']);

export function eaNormalize(name: string): string {
  const words = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((word) => word !== '' && !EA_STOPWORDS.has(word))
    .map((word) => {
      for (const generic of GENERIC_WORDS) {
        if (word.length > generic.length && word.endsWith(generic)) return word.slice(0, -generic.length);
      }
      return word;
    })
    .filter((word) => word !== '' && !GENERIC_WORDS.has(word));
  return words.join(' ');
}

const EA_FILLER_WORDS = new Set([...NAME_FILLER_WORDS, 'foot', 'rail']);

/**
 * A row is joinable only when its name carries a proper noun. 'Road
 * Bridge', 'Footbridge' and 'Railway Bridge' name no bridge in
 * particular and, with no coordinates to anchor them, must never join.
 * They still ship in the dataset, refused here, so the gap stays visible.
 */
export function isEaJoinableName(name: string): boolean {
  return eaNormalize(name).split(' ').some((word) => !EA_FILLER_WORDS.has(word));
}

export function eaNamesMatch(rowName: string, featureName: string): boolean {
  const nf = eaNormalize(featureName);
  if (nf === '') return false;
  const fw = nf.split(' ');
  const matchPart = (part: string): boolean => {
    const nr = eaNormalize(part);
    if (nr === '') return false;
    if (nr === nf) return true;
    const rw = nr.split(' ');
    return rw.length >= 2 && rw.every((word) => fw.includes(word));
  };
  for (const alt of rowName.split('/')) {
    if (matchPart(alt)) return true;
    // A trailing ', Place' is a location note, not part of the name:
    // 'Halfpenny Bridge, Lechlade' is the Halfpenny Bridge. The fallback
    // runs only when the pre-comma part names a bridge on its own, so
    // 'Railway Bridge, Prickwillow' still cannot join a plain
    // 'Railway Bridge' -- the qualifier is what makes it attributable.
    const preComma = alt.split(',')[0].trim();
    if (preComma !== alt.trim() && isEaJoinableName(preComma) && matchPart(preComma)) return true;
  }
  return false;
}

function waterwayMatches(crossed: string, waterway: string): boolean {
  const a = crossed.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const b = waterway.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (a === '' || b === '') return false;
  return a.includes(b) || b.includes(a);
}

const DANUBE_WORDS = ['danube', 'donau', 'duna', 'dunav', 'dunarea', 'dunaj'];

function crossesDanube(properties: Record<string, string>): boolean {
  const crossed = (properties['water crossed'] ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return DANUBE_WORDS.some((word) => crossed.includes(word));
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Shortest distance from a point to a mapped path, in metres. */
function distanceToPathMeters(lat: number, lon: number, path: [number, number][]): number {
  if (path.length === 0) return Number.POSITIVE_INFINITY;
  const cosLat = Math.cos(toRadians(lat));
  const px = lon * cosLat;
  const py = lat;
  // Coordinates are pre-scaled by cosLat, so differences are plain degrees.
  const scaledDistance = (sx: number, sy: number): number => {
    const dx = (sx - px) * toRadians(1) * 6371000;
    const dy = (sy - py) * toRadians(1) * 6371000;
    return Math.hypot(dx, dy);
  };
  if (path.length === 1) return scaledDistance(path[0][1] * cosLat, path[0][0]);
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < path.length - 1; i++) {
    const [lat1, lon1] = path[i];
    const [lat2, lon2] = path[i + 1];
    const x1 = lon1 * cosLat;
    const y1 = lat1;
    const x2 = lon2 * cosLat;
    const y2 = lat2;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0 ? 0 : Math.min(1, Math.max(0, ((px - x1) * dx + (py - y1) * dy) / lengthSquared));
    best = Math.min(best, scaledDistance(x1 + t * dx, y1 + t * dy));
  }
  return best;
}

function unionSorted(values: (number | null | undefined)[]): number[] {
  return [...new Set(values.filter((value): value is number => value !== null && value !== undefined))].sort((a, b) => a - b);
}

function minValue(values: (number | null | undefined)[]): number | null {
  const present = values.filter((value): value is number => value !== null && value !== undefined);
  return present.length === 0 ? null : Math.min(...present);
}

/**
 * Every authority figure that belongs to this crossing, grouped by source.
 * Coordinate records join by proximity to the mapped path (nearest wins per
 * record is not enforced here — one crossing's card shows every record
 * within tolerance, merged); name records join by bridge name plus waterway.
 */
export function clearancesForFeature(feature: JoinableBridgeFeature, datasets: ClearanceDatasets): BridgeClearance[] {
  const retrieved = datasets.manifest.generatedAt;
  const out: BridgeClearance[] = [];
  const path: [number, number][] = feature.path.length > 0 ? feature.path : [[feature.lat, feature.lon]];
  const names = [feature.name, feature.properties['bridge:name'] ?? '', feature.properties['seamark:name'] ?? '']
    .filter((name) => name.trim() !== '');
  const crossed = feature.properties['water crossed'] ?? '';

  const noaaByDatum = new Map<string, { standing: (number | null)[]; open: (number | null)[]; horizontal: (number | null)[]; closed: boolean }>();
  for (const record of datasets.noaa) {
    const distance = distanceToPathMeters(record.la, record.lo, path);
    // A record joins on proximity, or on an equal name within 5 km: ENC
    // area centroids can sit hundreds of metres off the mapped centreline
    // (the Kittanning polygon centroid is ~360 m from its OSM path), while
    // a shared name at that range is still the same crossing.
    const nameHit = record.n !== null && namesMatch(feature.name, record.n) && distance <= 5000;
    if (distance > JOIN_TOLERANCE_METERS && !nameHit) continue;
    // A per-feature VERDAT overrides the Coast Pilot MHW default, and
    // figures from different datums must never be merged into one row.
    const datum = decodeVerdat(record.d) ?? 'MHW';
    let bucket = noaaByDatum.get(datum);
    if (!bucket) {
      bucket = { standing: [], open: [], horizontal: [], closed: true };
      noaaByDatum.set(datum, bucket);
    }
    bucket.standing.push(record.v ?? record.c);
    bucket.open.push(record.o);
    bucket.horizontal.push(record.h);
    if (record.v !== null) bucket.closed = false;
  }
  for (const [datum, bucket] of noaaByDatum) {
    const values = unionSorted(bucket.standing);
    if (values.length === 0) continue;
    out.push({
      source: 'NOAA ENC',
      values,
      closed: bucket.closed,
      openValues: unionSorted(bucket.open),
      horizontal: minValue(bucket.horizontal),
      datum,
      datumNote: null,
      retrieved,
    });
  }

  const usaceStanding: (number | null)[] = [];
  const usaceOpen: (number | null)[] = [];
  const usaceHorizontal: (number | null)[] = [];
  let usaceClosed = true;
  for (const record of datasets.usace) {
    const distance = distanceToPathMeters(record.la, record.lo, path);
    const nameHit = record.n !== null && namesMatch(feature.name, record.n) && distance <= 5000;
    if (distance > JOIN_TOLERANCE_METERS && !nameHit) continue;
    usaceStanding.push(record.v ?? record.c);
    usaceOpen.push(record.o);
    usaceHorizontal.push(record.h);
    if (record.v !== null) usaceClosed = false;
  }
  const usaceValues = unionSorted(usaceStanding);
  if (usaceValues.length > 0) {
    out.push({
      source: 'USACE Inland ENC',
      values: usaceValues,
      closed: usaceClosed,
      openValues: unionSorted(usaceOpen),
      horizontal: minValue(usaceHorizontal),
      datum: null,
      datumNote: null,
      retrieved,
    });
  }

  // One row per matched EuRIS record, each labelled with its river
  // kilometre: names repeat along a waterway (two Cernavodă crossings,
  // several Freudenau harbour bridges), and merging them would put
  // another structure's figure on this card. Exact duplicates of one
  // record collapse to a single row.
  const seenEuris = new Set<string>();
  for (const record of datasets.euris) {
    if (!record.n || !record.w) continue;
    if (!names.some((name) => namesMatch(name, record.n!))) continue;
    if (!waterwayMatches(crossed, record.w)) continue;
    const values = unionSorted([record.c]);
    if (values.length === 0) continue;
    const openValues = unionSorted([record.o]);
    const key = JSON.stringify([values, openValues, record.wd]);
    if (seenEuris.has(key)) continue;
    seenEuris.add(key);
    const km = record.hm !== null && /^\d+$/.test(record.hm) ? Number(record.hm) / 10 : null;
    out.push({
      source: 'EuRIS',
      values,
      // EuRIS heights are closed-bridge heights by definition.
      closed: true,
      openValues,
      horizontal: record.wd,
      datum: null,
      datumNote: km !== null ? `river km ${km}` : null,
      retrieved,
    });
  }

  // One row per matched Danube list entry, each labelled with its own
  // reference gauge, for the same reason: a Maximilianbrücke stands at
  // both Kelheim and Deggendorf, a Nibelungenbrücke at both Regensburg
  // and Linz. The gauge place tells the boater which row is theirs.
  if (crossesDanube(feature.properties)) {
    for (const record of datasets.danube) {
      if (!names.some((name) => namesMatch(name, record.n))) continue;
      const values = unionSorted([record.h1, record.h2]);
      if (values.length === 0) continue;
      out.push({
        source: 'viadonau Danube list',
        values,
        closed: false,
        openValues: [],
        horizontal: minValue([record.w1, record.w2]),
        datum: 'HNWL',
        datumNote: record.g !== '' ? `reference gauge ${record.g}` : null,
        retrieved,
      });
    }
  }

  // Coast Pilot narrative figures. Named passages join by name plus
  // waterway, or by proximity to the mapped path (the same 150 m /
  // name-within-5 km rules as the ENC sources). Group least figures join
  // by waterway plus kind — and the kind filter is safety-critical: a
  // highway group's least (15 ft on the Tidal Canal) must never land on
  // the neighbouring rail bridge whose own clearance is lower (13 ft).
  // A least figure is valid for every member of its group, so it renders
  // with a ≥ prefix and the group description, never as an exact figure.
  // Passages with no coordinates, no waterway and no usable name never
  // reach this code: the builder drops them as unjoinable.
  const seenCoastPilot = new Set<string>();
  for (const record of datasets.coastpilot ?? []) {
    if (record.least) {
      if (!record.w || !waterwayMatches(crossed, record.w)) continue;
      const group = (record.g ?? '').toLowerCase();
      if (group.includes('highway') && !feature.properties.highway) continue;
      if ((group.includes('railroad') || group.includes('railway')) && !feature.properties.railway) continue;
      const values = unionSorted(record.v);
      if (values.length === 0) continue;
      const key = JSON.stringify([values, record.g]);
      if (seenCoastPilot.has(key)) continue;
      seenCoastPilot.add(key);
      out.push({
        source: 'US Coast Pilot',
        values,
        closed: true,
        openValues: [],
        horizontal: record.h,
        datum: record.d,
        datumNote: record.g,
        least: true,
        bridgeType: record.t,
        retrieved,
      });
      continue;
    }
    if (!record.n) continue;
    const nameHit = names.some((name) => namesMatch(name, record.n!));
    let joined = false;
    if (record.la !== null && record.lo !== null) {
      const distance = distanceToPathMeters(record.la, record.lo, path);
      // A passage with a specific name joins only the bridge it names:
      // two adjacent bridges can share one paragraph position (the two
      // Dumbarton bridges), and proximity alone would put each figure on
      // both. A generic-named passage has no name to match, so its
      // coordinates are its identifier and the proximity rule stands.
      joined = isSpecificBridgeName(record.n)
        ? nameHit && distance <= 5000
        : distance <= JOIN_TOLERANCE_METERS || (nameHit && distance <= 5000);
    } else if (record.w) {
      joined = nameHit && waterwayMatches(crossed, record.w);
    }
    if (!joined) continue;
    const values = unionSorted(record.v);
    if (values.length === 0) continue;
    const key = JSON.stringify([record.n, values, record.d, record.w]);
    if (seenCoastPilot.has(key)) continue;
    seenCoastPilot.add(key);
    out.push({
      source: 'US Coast Pilot',
      values,
      closed: record.c,
      openValues: unionSorted(record.o ?? []),
      horizontal: record.h,
      datum: record.d,
      datumNote: null,
      least: false,
      bridgeType: record.t,
      retrieved,
    });
  }

  // Environment Agency headways: name + waterway only, because the EA
  // tables carry no coordinates. The strict matcher above is the whole
  // safety case: a generic name can never join, and a qualified name
  // joins only a feature carrying every word of it. The figure is the
  // standing headway above standard water level as published, stated
  // approximate -- it carries no tidal datum and must never be
  // tide-adjusted, which the disclaimer states in full.
  const seenEa = new Set<string>();
  for (const record of datasets.eaheadway ?? []) {
    if (!isEaJoinableName(record.n)) continue;
    if (!record.w || !waterwayMatches(crossed, record.w)) continue;
    if (!names.some((name) => eaNamesMatch(record.n, name))) continue;
    const values = unionSorted(record.v);
    if (values.length === 0) continue;
    const key = JSON.stringify([record.n, values, record.w]);
    if (seenEa.has(key)) continue;
    seenEa.add(key);
    out.push({
      source: 'Environment Agency',
      values,
      closed: record.c,
      openValues: [],
      horizontal: null,
      datum: record.d,
      datumNote: record.note,
      retrieved,
    });
  }

  return out;
}

/**
 * Actual clearance at a water level above the figure's datum, same units:
 * water above the datum eats the clearance metre for metre; water below
 * it gives it back. Pass only if air draft plus a safety margin is under it.
 */
export function clearanceAtLevel(charted: number, levelAboveDatum: number): number {
  return charted - levelAboveDatum;
}
