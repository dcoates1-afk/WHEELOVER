import type { AisVessel } from './ais';

/**
 * AIS static data (name, type, callsign, dimensions, destination) is broadcast
 * every six minutes at best, while positions arrive every few seconds. Without
 * a cache a target that has just come into range reads as a bare MMSI until its
 * next static slot comes round. The relay retains statics while it runs; this
 * cache carries them across reloads and chart moves so a name appears at once.
 */

export const AIS_STATIC_STORAGE_KEY = 'wheel-over:ais-static';
const LEGACY_AIS_STATIC_STORAGE_KEYS = ['leeward:ais-static', 'marnav:ais-static'] as const;
const MAX_ENTRIES = 2500;
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;

export interface AisStaticRecord {
  name: string | null;
  shipType: string | null;
  typeCode: number | null;
  destination: string | null;
  callSign: string | null;
  imo: number | null;
  draught: number | null;
  length: number | null;
  beam: number | null;
  eta: string | null;
  transponder: 'A' | 'B' | null;
  savedAt: number;
}

export type AisStaticMap = Map<number, AisStaticRecord>;

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
const number = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

function record(value: unknown): AisStaticRecord | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const transponder = input.transponder === 'A' || input.transponder === 'B' ? input.transponder : null;
  const savedAt = number(input.savedAt) ?? 0;
  return {
    name: text(input.name),
    shipType: text(input.shipType),
    typeCode: number(input.typeCode),
    destination: text(input.destination),
    callSign: text(input.callSign),
    imo: number(input.imo),
    draught: number(input.draught),
    length: number(input.length),
    beam: number(input.beam),
    eta: text(input.eta),
    transponder,
    savedAt,
  };
}

/** Invalid, oversized or stale entries are dropped rather than trusted. */
export function readAisStaticCache(
  storage: Pick<Storage, 'getItem'> | null | undefined,
  now: number = Date.now(),
): AisStaticMap {
  const cache: AisStaticMap = new Map();
  if (!storage) return cache;
  let parsed: unknown;
  try {
    const raw =
      storage.getItem(AIS_STATIC_STORAGE_KEY) ??
      LEGACY_AIS_STATIC_STORAGE_KEYS.map((key) => storage.getItem(key)).find((value) => value !== null);
    if (!raw) return cache;
    parsed = JSON.parse(raw);
  } catch {
    return cache;
  }
  if (!parsed || typeof parsed !== 'object') return cache;
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const mmsi = Number(key);
    if (!Number.isInteger(mmsi) || mmsi < 100_000_000 || mmsi > 999_999_999) continue;
    const entry = record(value);
    if (!entry) continue;
    if (entry.savedAt > 0 && now - entry.savedAt > KEEP_MS) continue;
    if (!hasStaticContent(entry)) continue;
    cache.set(mmsi, entry);
  }
  return cache;
}

export function writeAisStaticCache(
  storage: Pick<Storage, 'setItem'> | null | undefined,
  cache: AisStaticMap,
): void {
  if (!storage) return;
  const entries = [...cache.entries()]
    .sort((a, b) => b[1].savedAt - a[1].savedAt)
    .slice(0, MAX_ENTRIES);
  const payload: Record<string, AisStaticRecord> = {};
  for (const [mmsi, entry] of entries) payload[String(mmsi)] = entry;
  try {
    storage.setItem(AIS_STATIC_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage full or blocked: the cache is an optimisation, not a dependency.
  }
}

/** Fill only what the live report left blank; the live value always wins. */
export function applyStaticInfo(vessel: AisVessel, info: AisStaticRecord | undefined): AisVessel {
  if (!info) return vessel;
  return {
    ...vessel,
    name: vessel.name ?? info.name,
    shipType: vessel.shipType ?? info.shipType,
    typeCode: vessel.typeCode ?? info.typeCode,
    destination: vessel.destination ?? info.destination,
    callSign: vessel.callSign ?? info.callSign,
    imo: vessel.imo ?? info.imo,
    draught: vessel.draught ?? info.draught,
    length: vessel.length ?? info.length,
    beam: vessel.beam ?? info.beam,
    eta: vessel.eta ?? info.eta,
    transponder: vessel.transponder ?? info.transponder,
    staticAt: vessel.staticAt ?? (info.savedAt > 0 ? info.savedAt : null),
  };
}

/** A transponder class alone does not identify a vessel, so it is not enough. */
function hasStaticContent(entry: AisStaticRecord): boolean {
  return (
    entry.name !== null ||
    entry.shipType !== null ||
    entry.typeCode !== null ||
    entry.destination !== null ||
    entry.callSign !== null ||
    entry.imo !== null ||
    entry.draught !== null ||
    entry.length !== null ||
    entry.beam !== null ||
    entry.eta !== null
  );
}

const SAME_FIELDS: (keyof AisStaticRecord)[] = [
  'name',
  'shipType',
  'typeCode',
  'destination',
  'callSign',
  'imo',
  'draught',
  'length',
  'beam',
  'eta',
  'transponder',
];

/**
 * Fold the current snapshot into the cache. `savedAt` only moves when a field
 * actually changes, so the write throttle and the freshness order stay honest.
 */
export function rememberVessels(
  cache: AisStaticMap,
  vessels: AisVessel[],
  now: number = Date.now(),
): { cache: AisStaticMap; changed: boolean } {
  let changed = false;
  const next: AisStaticMap = new Map(cache);
  for (const vessel of vessels) {
    if (
      vessel.name === null &&
      vessel.shipType === null &&
      vessel.typeCode === null &&
      vessel.destination === null &&
      vessel.callSign === null &&
      vessel.imo === null &&
      vessel.draught === null &&
      vessel.length === null &&
      vessel.beam === null &&
      vessel.eta === null
    ) {
      continue;
    }
    const candidate: AisStaticRecord = {
      name: vessel.name,
      shipType: vessel.shipType,
      typeCode: vessel.typeCode,
      destination: vessel.destination,
      callSign: vessel.callSign,
      imo: vessel.imo,
      draught: vessel.draught,
      length: vessel.length,
      beam: vessel.beam,
      eta: vessel.eta,
      transponder: vessel.transponder,
      savedAt: now,
    };
    const existing = next.get(vessel.mmsi);
    if (existing && SAME_FIELDS.every((key) => existing[key] === candidate[key])) continue;
    next.set(vessel.mmsi, candidate);
    changed = true;
  }
  return { cache: next, changed };
}
