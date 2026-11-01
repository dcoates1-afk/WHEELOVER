import type { Navaid } from './navaidTypes';
import { loadShardBatch, marineDataUrl } from './marineDb';
import { fillSignalDetails, signalDetailsMissing, type SignalDetails } from './signalDetails';

/**
 * Worldwide sound signals and racons.
 *
 * The mark archive kept a light's character and sectors but dropped every
 * `seamark:fog_signal` and `seamark:radar_transponder` tag, so a buoy with a
 * bell or a racon was drawn without either. The signals are sparse enough
 * worldwide to ship as their own compact index and attach to the archive marks
 * by OSM id when the viewport changes.
 */
export type SignalEntry = SignalDetails & {
  /** Position of the object, kept so an audit can place an unattached signal. */
  lat?: number;
  lon?: number;
  type?: string;
};

export interface SignalCell {
  path: string;
  bounds: [number, number, number, number];
  count: number;
}

export interface SignalManifest {
  schema: number;
  generatedAt: string;
  sourceTimestamp: string | null;
  count: number;
  fogSignals: number;
  racons: number;
  cells: SignalCell[];
}

const isBounds = (value: unknown): value is [number, number, number, number] =>
  Array.isArray(value) &&
  value.length === 4 &&
  value.every((entry) => typeof entry === 'number' && Number.isFinite(entry));

export function validateSignalManifest(value: unknown): SignalManifest | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Partial<SignalManifest>;
  if (input.schema !== 1 || !Array.isArray(input.cells)) return null;
  const cells: SignalCell[] = [];
  for (const cell of input.cells) {
    if (!cell || typeof cell.path !== 'string' || !isBounds(cell.bounds)) continue;
    cells.push({ path: cell.path, bounds: cell.bounds, count: Number(cell.count) || 0 });
  }
  if (cells.length === 0) return null;
  return {
    schema: 1,
    generatedAt: typeof input.generatedAt === 'string' ? input.generatedAt : new Date(0).toISOString(),
    sourceTimestamp: typeof input.sourceTimestamp === 'string' ? input.sourceTimestamp : null,
    count: Number(input.count) || 0,
    fogSignals: Number(input.fogSignals) || 0,
    racons: Number(input.racons) || 0,
    cells,
  };
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined;

export function validateSignalCell(value: unknown): Map<string, SignalEntry> | null {
  if (!value || typeof value !== 'object') return null;
  const marks = (value as { marks?: unknown }).marks;
  if (!marks || typeof marks !== 'object') return null;
  const entries = new Map<string, SignalEntry>();
  for (const [id, raw] of Object.entries(marks as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const input = raw as Partial<SignalEntry>;
    const entry: SignalEntry = {
      fogSignal: input.fogSignal === true,
      fogSignalCategory: text(input.fogSignalCategory),
      fogSignalGroup: text(input.fogSignalGroup),
      fogSignalPeriod: text(input.fogSignalPeriod),
      fogSignalSequence: text(input.fogSignalSequence),
      radarTransponderCategory: text(input.radarTransponderCategory),
      radarTransponderGroup: text(input.radarTransponderGroup),
      radarTransponderPeriod: text(input.radarTransponderPeriod),
      radarTransponderSequence: text(input.radarTransponderSequence),
      lat: Number.isFinite(Number(input.lat)) ? Number(input.lat) : undefined,
      lon: Number.isFinite(Number(input.lon)) ? Number(input.lon) : undefined,
      type: text(input.type),
    };
    const hasRacon = Boolean(
      entry.radarTransponderCategory ?? entry.radarTransponderGroup ??
        entry.radarTransponderPeriod ?? entry.radarTransponderSequence,
    );
    if (!entry.fogSignal && !hasRacon) continue;
    entries.set(id, entry);
  }
  return entries.size > 0 ? entries : null;
}

const intersects = (a: [number, number, number, number], b: [number, number, number, number]): boolean =>
  a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

export function signalCellsForBounds(
  manifest: SignalManifest,
  bounds: [number, number, number, number],
): SignalCell[] {
  return manifest.cells.filter((cell) => intersects(cell.bounds, bounds));
}

async function readManifest(baseUrl?: string): Promise<SignalManifest> {
  const response = await fetch(marineDataUrl('signals/manifest.json', baseUrl), { cache: 'no-store' });
  if (!response.ok) throw new Error(`Mark-signal manifest unavailable (HTTP ${response.status})`);
  const manifest = validateSignalManifest(await response.json());
  if (!manifest) throw new Error('Mark-signal manifest is invalid');
  return manifest;
}

/** Signal entries for one viewport, keyed by mark id. */
export async function loadMarkSignals(
  bounds: [number, number, number, number],
  options: { signal?: AbortSignal; baseUrl?: string } = {},
): Promise<Map<string, SignalEntry>> {
  const manifest = await readManifest(options.baseUrl);
  const cells = signalCellsForBounds(manifest, bounds);
  // A cell that cannot be read is skipped: one bad request used to reject the
  // whole index and strip every bell, horn and racon from the chart.
  const responses = await loadShardBatch(
    cells.map((cell) => cell.path),
    async (path) => {
      try {
        const response = await fetch(marineDataUrl(path, options.baseUrl), { signal: options.signal });
        if (!response.ok) return null;
        return validateSignalCell(await response.json());
      } catch (error) {
        if (options.signal?.aborted) throw error;
        return null;
      }
    },
    options,
  );
  const merged = new Map<string, SignalEntry>();
  for (const entries of responses) {
    if (!entries) continue;
    for (const [id, entry] of entries) merged.set(id, entry);
  }
  return merged;
}

/** Fill in a missing sound signal or racon on every mark the index covers. */
export function applyMarkSignals(marks: Navaid[], index: Map<string, SignalEntry>): Navaid[] {
  if (index.size === 0) return marks;
  let changed = false;
  const out = marks.map((mark) => {
    const details = index.get(mark.id);
    if (!details || !signalDetailsMissing(mark, details)) return mark;
    const next: Navaid = { ...mark };
    fillSignalDetails(next, details);
    changed = true;
    return next;
  });
  return changed ? out : marks;
}
