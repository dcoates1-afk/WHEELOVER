import type { Navaid } from './navaidTypes';
import { marineDataUrl } from './marineDb';
import { markDetailFields } from '../../shared/mark-detail-core.mjs';

/**
 * Charted detail for the worldwide mark archive.
 *
 * The archive snapshot kept a mark's name, class and light summary and dropped
 * the rest of the charted detail. Those fields are indexed worldwide by OSM id
 * and attached here when the viewport changes, so a mark card can show its
 * topmark, shape, colour pattern, structure, height, light reference and the
 * other tags the source actually maps.
 */
export type MarkDetailEntry = Partial<
  Pick<
    Navaid,
    | 'name'
    | 'markType'
    | 'markCategory'
    | 'colour'
    | 'colourPattern'
    | 'shape'
    | 'topmarkShape'
    | 'topmarkColour'
    | 'height'
    | 'range'
    | 'lightCharacter'
    | 'lightColour'
    | 'lightGroup'
    | 'lightPeriod'
    | 'lightSequence'
    | 'lightCategory'
    | 'buoyageSystem'
  >
> & {
  details?: Record<string, string>;
  lat?: number;
  lon?: number;
};

export interface MarkDetailCell {
  path: string;
  bounds: [number, number, number, number];
  count: number;
}

export interface MarkDetailManifest {
  schema: number;
  generatedAt: string;
  sourceTimestamp: string | null;
  count: number;
  cells: MarkDetailCell[];
}

const DETAIL_FIELDS = [
  'name',
  'markType',
  'markCategory',
  'colour',
  'colourPattern',
  'shape',
  'topmarkShape',
  'topmarkColour',
  'height',
  'range',
  'lightCharacter',
  'lightColour',
  'lightGroup',
  'lightPeriod',
  'lightSequence',
  'lightCategory',
  'buoyageSystem',
] as const;

const isBounds = (value: unknown): value is [number, number, number, number] =>
  Array.isArray(value) &&
  value.length === 4 &&
  value.every((entry) => typeof entry === 'number' && Number.isFinite(entry));

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined;

export function validateMarkDetailManifest(value: unknown): MarkDetailManifest | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Partial<MarkDetailManifest>;
  if (input.schema !== 1 || !Array.isArray(input.cells)) return null;
  const cells: MarkDetailCell[] = [];
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

export function validateMarkDetailCell(value: unknown): Map<string, MarkDetailEntry> | null {
  if (!value || typeof value !== 'object') return null;
  const marks = (value as { marks?: unknown }).marks;
  if (!marks || typeof marks !== 'object') return null;
  const entries = new Map<string, MarkDetailEntry>();
  for (const [id, raw] of Object.entries(marks as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const input = raw as Record<string, unknown>;
    const entry: MarkDetailEntry = {};
    let filled = false;
    for (const field of DETAIL_FIELDS) {
      const value = text(input[field]);
      if (value === undefined) continue;
      entry[field] = value;
      filled = true;
    }
    if (input.details && typeof input.details === 'object') {
      const details: Record<string, string> = {};
      for (const [key, rawValue] of Object.entries(input.details as Record<string, unknown>)) {
        const value = text(rawValue);
        if (value !== undefined) details[key] = value;
      }
      if (Object.keys(details).length > 0) {
        entry.details = details;
        filled = true;
      }
    }
    if (!filled) continue;
    const lat = Number(input.lat);
    const lon = Number(input.lon);
    if (Number.isFinite(lat) && Math.abs(lat) <= 90) entry.lat = lat;
    if (Number.isFinite(lon) && Math.abs(lon) <= 180) entry.lon = lon;
    entries.set(id, entry);
  }
  return entries.size > 0 ? entries : null;
}

const intersects = (a: [number, number, number, number], b: [number, number, number, number]): boolean =>
  a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

export function markDetailCellsForBounds(
  manifest: MarkDetailManifest,
  bounds: [number, number, number, number],
): MarkDetailCell[] {
  return manifest.cells.filter((cell) => intersects(cell.bounds, bounds));
}

async function readManifest(baseUrl?: string): Promise<MarkDetailManifest> {
  const response = await fetch(marineDataUrl('mark-details/manifest.json', baseUrl), { cache: 'no-store' });
  if (!response.ok) throw new Error(`Mark-detail manifest unavailable (HTTP ${response.status})`);
  const manifest = validateMarkDetailManifest(await response.json());
  if (!manifest) throw new Error('Mark-detail manifest is invalid');
  return manifest;
}

/** Detail entries for one viewport, keyed by mark id. */
export async function loadMarkDetails(
  bounds: [number, number, number, number],
  options: { signal?: AbortSignal; baseUrl?: string } = {},
): Promise<Map<string, MarkDetailEntry>> {
  const manifest = await readManifest(options.baseUrl);
  const cells = markDetailCellsForBounds(manifest, bounds);
  const responses = await Promise.all(
    cells.map(async (cell) => {
      const response = await fetch(marineDataUrl(cell.path, options.baseUrl), { signal: options.signal });
      if (!response.ok) throw new Error(`Mark-detail shard unavailable: ${cell.path}`);
      return validateMarkDetailCell(await response.json());
    }),
  );
  const merged = new Map<string, MarkDetailEntry>();
  for (const entries of responses) {
    if (!entries) continue;
    for (const [id, entry] of entries) merged.set(id, entry);
  }
  return merged;
}

const isBlank = (value: unknown): boolean =>
  value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

/**
 * Fill the detail an archive mark is missing, never replacing a value it
 * already carries: a regional record was checked against the charted mark and
 * wins over the worldwide index.
 */
export function applyMarkDetails(mark: Navaid, entry: MarkDetailEntry | undefined): Navaid {
  if (!entry) return mark;
  let next: Navaid | null = null;
  const target = () => {
    if (!next) next = { ...mark };
    return next;
  };
  for (const field of DETAIL_FIELDS) {
    const value = entry[field];
    if (value === undefined) continue;
    if (!isBlank(mark[field])) continue;
    (target() as unknown as Record<string, unknown>)[field] = value;
  }
  const details = entry.details;
  if (details) {
    const merged = { ...(mark.details ?? {}) };
    let added = false;
    for (const [key, value] of Object.entries(details)) {
      if (!isBlank(merged[key])) continue;
      merged[key] = value;
      added = true;
    }
    if (added) target().details = merged;
  }
  return next ?? mark;
}

/** Detail for every mark in view that the index has a record for. */
export function applyMarkDetailIndex(marks: Navaid[], index: Map<string, MarkDetailEntry>): Navaid[] {
  if (index.size === 0) return marks;
  let changed = false;
  const out = marks.map((mark) => {
    const entry = index.get(mark.id);
    if (!entry) return mark;
    const next = applyMarkDetails(mark, entry);
    if (next !== mark) changed = true;
    return next;
  });
  return changed ? out : marks;
}

/** Detail taken from a live viewport query, which carries the full tag set. */
export function markDetailsFromTags(tags: Record<string, string> | undefined): MarkDetailEntry | null {
  if (!tags) return null;
  const { fields, details } = markDetailFields(tags);
  const entry: MarkDetailEntry = {};
  for (const field of DETAIL_FIELDS) {
    const value = fields[field];
    if (typeof value === 'string' && value.trim() !== '') entry[field] = value;
  }
  if (Object.keys(details).length > 0) entry.details = details;
  return Object.keys(entry).length > 0 ? entry : null;
}
