import type { Navaid } from './navaidTypes';
import { loadShardBatch, marineDataUrl } from './marineDb';
import { fillSignalDetails, signalDetailsMissing } from './signalDetails';

/**
 * Light sectors for the worldwide mark archive.
 *
 * The archive is built from a planet snapshot that carries a light summary but
 * no per-sector bearings, so only the regional bundles had sectors to draw.
 * Sector bearings are few enough worldwide to ship as their own small index and
 * attach to the archive marks by OSM id when the viewport changes.
 */
export type LightSectorRecord = NonNullable<Navaid['lightSectors']>[number];

export interface LightSectorEntry {
  sectors: LightSectorRecord[];
  /** Exact source character for the whole light, e.g. Fl, Iso. */
  character?: string;
  colour?: string;
  category?: string;
  /** OSM `seamark:type`, used to decide whether a proximity attach is safe. */
  type?: string;
  /** Charted name of the light, when OSM carries one. */
  name?: string;
  /** Set at build time when no archive mark exists for this light anywhere. */
  standalone?: boolean;
  /** Sound signal on the light, drawn on the mark as a fog signal. */
  fogSignal?: boolean;
  fogSignalCategory?: string;
  fogSignalGroup?: string;
  fogSignalPeriod?: string;
  fogSignalSequence?: string;
  /** Radar transponder on the light, drawn on the mark as a racon ring. */
  radarTransponderCategory?: string;
  radarTransponderGroup?: string;
  radarTransponderPeriod?: string;
  radarTransponderSequence?: string;
  /** Position of the lit object, for lights whose OSM id has no archive mark. */
  lat?: number;
  lon?: number;
}

export interface LightSectorCell {
  path: string;
  bounds: [number, number, number, number];
  count: number;
}

export interface LightSectorManifest {
  schema: number;
  generatedAt: string;
  sourceTimestamp: string | null;
  count: number;
  cells: LightSectorCell[];
}

const isBounds = (value: unknown): value is [number, number, number, number] =>
  Array.isArray(value) &&
  value.length === 4 &&
  value.every((entry) => typeof entry === 'number' && Number.isFinite(entry));

const isSector = (value: unknown): value is LightSectorRecord => {
  if (!value || typeof value !== 'object') return false;
  const sector = value as Partial<LightSectorRecord>;
  return Number.isInteger(sector.sector) && (sector.sector ?? 0) >= 1;
};

export function validateLightSectorManifest(value: unknown): LightSectorManifest | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Partial<LightSectorManifest>;
  if (input.schema !== 1 || !Array.isArray(input.cells)) return null;
  const cells: LightSectorCell[] = [];
  for (const cell of input.cells) {
    if (!cell || typeof cell.path !== 'string' || !isBounds(cell.bounds)) continue;
    cells.push({ path: cell.path, bounds: cell.bounds, count: Number(cell.count) || 0 });
  }
  if (cells.length === 0) return null;
  return {
    schema: 1,
    generatedAt: typeof input.generatedAt === 'string' ? input.generatedAt : new Date(0).toISOString(),
    sourceTimestamp: typeof input.sourceTimestamp === 'string' ? input.sourceTimestamp : null,
    count: Number(input.count) || cells.reduce((total, cell) => total + cell.count, 0),
    cells,
  };
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined;

export function validateLightSectorCell(value: unknown): Map<string, LightSectorEntry> | null {
  if (!value || typeof value !== 'object') return null;
  const lights = (value as { lights?: unknown }).lights;
  if (!lights || typeof lights !== 'object') return null;
  const entries = new Map<string, LightSectorEntry>();
  for (const [id, raw] of Object.entries(lights as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const input = raw as Partial<LightSectorEntry>;
    if (!Array.isArray(input.sectors)) continue;
    const sectors = input.sectors.filter(isSector);
    if (sectors.length === 0) continue;
    const lat = Number(input.lat);
    const lon = Number(input.lon);
    entries.set(id, {
      sectors,
      character: typeof input.character === 'string' ? input.character : undefined,
      colour: typeof input.colour === 'string' ? input.colour : undefined,
      category: typeof input.category === 'string' ? input.category : undefined,
      type: typeof input.type === 'string' ? input.type : undefined,
      name: typeof input.name === 'string' ? input.name : undefined,
      standalone: input.standalone === true,
      fogSignal: input.fogSignal === true,
      fogSignalCategory: text(input.fogSignalCategory),
      fogSignalGroup: text(input.fogSignalGroup),
      fogSignalPeriod: text(input.fogSignalPeriod),
      fogSignalSequence: text(input.fogSignalSequence),
      radarTransponderCategory: text(input.radarTransponderCategory),
      radarTransponderGroup: text(input.radarTransponderGroup),
      radarTransponderPeriod: text(input.radarTransponderPeriod),
      radarTransponderSequence: text(input.radarTransponderSequence),
      lat: Number.isFinite(lat) && Math.abs(lat) <= 90 ? lat : undefined,
      lon: Number.isFinite(lon) && Math.abs(lon) <= 180 ? lon : undefined,
    });
  }
  return entries.size > 0 ? entries : null;
}

const intersects = (a: [number, number, number, number], b: [number, number, number, number]): boolean =>
  a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

export function lightSectorCellsForBounds(
  manifest: LightSectorManifest,
  bounds: [number, number, number, number],
): LightSectorCell[] {
  return manifest.cells.filter((cell) => intersects(cell.bounds, bounds));
}

async function readManifest(baseUrl?: string): Promise<LightSectorManifest> {
  const response = await fetch(marineDataUrl('light-sectors/manifest.json', baseUrl), { cache: 'no-store' });
  if (!response.ok) throw new Error(`Light-sector manifest unavailable (HTTP ${response.status})`);
  const manifest = validateLightSectorManifest(await response.json());
  if (!manifest) throw new Error('Light-sector manifest is invalid');
  return manifest;
}

/** Sector entries for one viewport, keyed by mark id. */
export async function loadLightSectors(
  bounds: [number, number, number, number],
  options: { signal?: AbortSignal; baseUrl?: string } = {},
): Promise<Map<string, LightSectorEntry>> {
  const manifest = await readManifest(options.baseUrl);
  return readSectorCells(lightSectorCellsForBounds(manifest, bounds), options);
}

/**
 * Read the cells with a bounded number of requests in flight, skipping any that
 * fail. A single unreadable cell used to reject the whole index, which removed
 * every light sector on the chart instead of the sectors for that one cell.
 */
async function readSectorCells(
  cells: LightSectorCell[],
  options: { signal?: AbortSignal; baseUrl?: string },
): Promise<Map<string, LightSectorEntry>> {
  const merged = new Map<string, LightSectorEntry>();
  const responses = await loadShardBatch(
    cells.map((cell) => cell.path),
    async (path) => {
      try {
        const response = await fetch(marineDataUrl(path, options.baseUrl), { signal: options.signal });
        if (!response.ok) return null;
        return validateLightSectorCell(await response.json());
      } catch (error) {
        if (options.signal?.aborted) throw error;
        return null;
      }
    },
    options,
  );
  for (const entries of responses) {
    if (!entries) continue;
    for (const [id, entry] of entries) merged.set(id, entry);
  }
  return merged;
}

function sectorRangeNm(entry: LightSectorEntry): number {
  let best = 0;
  for (const sector of entry.sectors) {
    const range = Number(sector.range);
    if (Number.isFinite(range) && range > best) best = range;
  }
  return best;
}

/** Sector fields the index can supply when the archive record left them out. */
const SECTOR_FILL_FIELDS = [
  'start', 'end', 'category', 'orientation', 'character', 'colour', 'group',
  'period', 'sequence', 'range', 'visibility', 'height', 'multiple',
] as const;

/**
 * Fill blank fields on an archive mark's own sectors from the index.
 *
 * The archive snapshot keeps the bearings but drops the detail that decides
 * whether a sector can be drawn at all: a directional light records only its
 * `category` and `orientation`, never a `start`/`end` pair, so an archive copy
 * without those two fields silently loses sectors the index does have.
 * Existing values are never overwritten, so a regional record that was checked
 * against the charted bearings still wins.
 */
function fillSectorDetail(
  current: LightSectorRecord[],
  indexed: LightSectorRecord[],
): LightSectorRecord[] | null {
  const bySector = new Map(indexed.map((sector) => [sector.sector, sector]));
  let changed = false;
  const merged = current.map((sector) => {
    const source = bySector.get(sector.sector);
    if (!source) return sector;
    let next = sector;
    for (const key of SECTOR_FILL_FIELDS) {
      const value = source[key];
      if (value === undefined || value === null || value === '') continue;
      const existing = sector[key];
      if (existing !== undefined && existing !== null && existing !== '') continue;
      if (next === sector) next = { ...sector };
      next[key] = value;
      changed = true;
    }
    return next;
  });
  return changed ? merged : null;
}

/**
 * Attach the indexed sectors to an archive mark.
 *
 * A regional record that already carries sectors wins: it was checked against
 * the charted bearings. It can still be thinner than the index, so any field
 * the archive left blank is filled in per sector rather than dropped. A
 * landmark the archive ranked as unlit is a lighthouse carrying a sector
 * light, so it is re-ranked as a light — otherwise its zoom floor stays at
 * landmark level and the sectors only appear close in.
 */
export function applyLightSectors(
  mark: Navaid,
  entry: LightSectorEntry | undefined,
): Navaid {
  if (!entry) return mark;
  const hasSectors = (mark.lightSectors?.length ?? 0) > 0;
  const settled = hasSectors && mark.lit;
  const filled = hasSectors ? fillSectorDetail(mark.lightSectors!, entry.sectors) : null;
  if (settled && !filled && !signalDetailsMissing(mark, entry)) return mark;

  const next: Navaid = { ...mark };
  if (!hasSectors) next.lightSectors = entry.sectors.map((sector) => ({ ...sector }));
  else if (filled) next.lightSectors = filled;
  if (!next.lightCharacter && entry.character) next.lightCharacter = entry.character;
  if (!next.lightColour && entry.colour) next.lightColour = entry.colour;
  if (!next.lightCategory && entry.category) next.lightCategory = entry.category;
  next.lit = true;

  // A mark whose light was already settled keeps its class; only a scan that
  // needed the index for its light gets re-ranked — to the lighthouse tower
  // when the indexed light is a lighthouse, otherwise to the sector beacon.
  // Range still sets the priority, so a long-range sector light keeps the
  // prominence it had as a major light.
  if (!settled && (mark.category === 'landmark' || mark.category === 'other')) {
    next.category = entry.type === 'lighthouse' ? 'lighthouse' : 'sector_beacon';
    next.priority = sectorRangeNm(entry) >= 10 ? 100 : 66;
  }
  fillSignalDetails(next, entry);
  return next;
}

/**
 * Seamark types whose sectors may be attached to a nearby mark when no mark
 * shares their OSM id. A lighthouse is often mapped as a multipolygon (or the
 * light sits on the building outline) while the archive carries the structure
 * under an id of its own, so matching ids alone drops those lights.
 */
const PROXIMITY_ATTACH_TYPES = new Set([
  'light_major',
  'light_minor',
  'light',
  'lighthouse',
  'beacon',
]);

/** Reach of a fallback attach. Two objects this far apart on the same quay are
 * different lights, so anything beyond it would be a guess. */
export const PROXIMITY_ATTACH_M = 250;

function metersBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function applyLightSectorIndex(marks: Navaid[], index: Map<string, LightSectorEntry>): Navaid[] {
  if (index.size === 0) return marks;
  let changed = false;
  const claimed = new Set<string>();
  const out = marks.map((mark) => {
    const entry = index.get(mark.id);
    if (!entry) return mark;
    claimed.add(mark.id);
    const next = applyLightSectors(mark, entry);
    if (next !== mark) changed = true;
    return next;
  });

  // Fallback for lights whose own OSM id has no archive mark: attach to the
  // nearest unclaimed lit mark or landmark within reach, nearest pair first so
  // a light can never be pulled onto a neighbouring mark that is closer to a
  // different one.
  const pending = [...index].filter(([id, entry]) =>
    !claimed.has(id) &&
    entry.type !== undefined &&
    PROXIMITY_ATTACH_TYPES.has(entry.type) &&
    entry.lat !== undefined &&
    entry.lon !== undefined,
  );
  if (pending.length === 0) return changed ? out : marks;

  const candidates: { entryId: string; entry: LightSectorEntry; markIndex: number; distance: number }[] = [];
  for (const [entryId, entry] of pending) {
    for (let i = 0; i < out.length; i += 1) {
      const candidate = out[i];
      if (claimed.has(candidate.id)) continue;
      if (!candidate.lit && candidate.category !== 'landmark' && candidate.category !== 'other') continue;
      const distance = metersBetween(entry.lat!, entry.lon!, candidate.lat, candidate.lon);
      if (distance <= PROXIMITY_ATTACH_M) candidates.push({ entryId, entry, markIndex: i, distance });
    }
  }
  if (candidates.length === 0) return changed ? out : marks;

  candidates.sort((a, b) => a.distance - b.distance || a.markIndex - b.markIndex);
  const attached = new Set<string>();
  let result = out;
  for (const candidate of candidates) {
    if (attached.has(candidate.entryId)) continue;
    const target = result[candidate.markIndex];
    if (claimed.has(target.id)) continue;
    claimed.add(target.id);
    attached.add(candidate.entryId);
    const next = applyLightSectors(target, candidate.entry);
    if (next === target) continue;
    if (result === out) result = [...out];
    result[candidate.markIndex] = next;
    changed = true;
  }
  return changed ? result : marks;
}

/** The mark the chart draws for an indexed light the archive has no mark for. */
function standaloneMark(id: string, entry: LightSectorEntry): Navaid {
  const ranges = entry.sectors
    .map((sector) => Number(sector.range))
    .filter((range) => Number.isFinite(range) && range > 0);
  const bestRange = ranges.length > 0 ? Math.max(...ranges) : 0;
  // An indexed light is a sector light by definition: the lighthouse tower
  // when the index says lighthouse, otherwise the sector beacon. Range
  // still sets the priority, so a long-range sector light keeps the
  // prominence it had as a major light.
  const category: Navaid['category'] = entry.type === 'lighthouse' ? 'lighthouse' : 'sector_beacon';
  return {
    id,
    lat: entry.lat!,
    lon: entry.lon!,
    category,
    form: category === 'lighthouse' ? 'landmark' : 'light',
    name: entry.name ?? null,
    markType: entry.type ?? null,
    light: null,
    lightCharacter: entry.character ?? entry.sectors.find((sector) => sector.character)?.character ?? null,
    lightSectors: entry.sectors.map((sector) => ({ ...sector })),
    lightColour: entry.colour ?? null,
    lightCategory: entry.category ?? null,
    fogSignal: entry.fogSignal === true ? true : undefined,
    fogSignalCategory: entry.fogSignalCategory ?? null,
    fogSignalGroup: entry.fogSignalGroup ?? null,
    fogSignalPeriod: entry.fogSignalPeriod ?? null,
    fogSignalSequence: entry.fogSignalSequence ?? null,
    radarTransponderCategory: entry.radarTransponderCategory ?? null,
    radarTransponderGroup: entry.radarTransponderGroup ?? null,
    radarTransponderPeriod: entry.radarTransponderPeriod ?? null,
    radarTransponderSequence: entry.radarTransponderSequence ?? null,
    colour: null,
    shape: null,
    height: null,
    range: bestRange > 0 ? String(bestRange) : null,
    path: null,
    transitBearing: null,
    transitDistanceM: null,
    transitPartner: null,
    transitPartnerName: null,
    channel: null,
    description: null,
    lit: true,
    priority: bestRange >= 10 ? 100 : 66,
    source: 'osm',
    updated: null,
    region: null,
  };
}

/**
 * Light marks for the few indexed lights that no archive mark can carry.
 *
 * These are charted lights the planet snapshot behind the archive never kept
 * (a handful of beacons and mole lights worldwide), so their sectors had
 * nowhere to draw and simply vanished. The build flags them `standalone`; here
 * they become ordinary light marks, still skipped if a mark is already plotted
 * at that position so a newer archive can never double them up.
 */
export function standaloneLightMarks(
  index: Map<string, LightSectorEntry>,
  marks: Navaid[],
): Navaid[] {
  const out: Navaid[] = [];
  if (index.size === 0) return out;
  const known = new Set(marks.map((mark) => mark.id));
  for (const [id, entry] of index) {
    if (!entry.standalone || known.has(id)) continue;
    if (!Number.isFinite(entry.lat) || !Number.isFinite(entry.lon)) continue;
    const alreadyPlotted = marks.some(
      (mark) =>
        (mark.id === id || mark.lit || mark.category === 'landmark' || mark.category === 'other') &&
        metersBetween(entry.lat!, entry.lon!, mark.lat, mark.lon) <= PROXIMITY_ATTACH_M,
    );
    if (alreadyPlotted) continue;
    out.push(standaloneMark(id, entry));
  }
  return out;
}
