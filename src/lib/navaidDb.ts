import type { Navaid } from './navaidTypes';
import seedExtract from '../data/solentNavaids.json';

export const MANIFEST_URL = '/navaid-db/manifest.json';
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_SHARDS_PER_LOAD = 14;
const DB_NAME = 'marnav-navaids';
const DB_VERSION = 1;

export type Bounds = [number, number, number, number];

export interface ShardRef {
  path: string;
  bounds: Bounds;
  count: number;
}

export interface RegionRef {
  id: string;
  name: string;
  bounds: Bounds;
  count: number;
  shards: ShardRef[];
  sources: string[];
}

export interface NavaidManifest {
  schema: number;
  version: string;
  generatedAt: string;
  cellSize: number;
  regions: RegionRef[];
  sources: { id: string; name: string }[];
  stats: { rawRecords: number; uniqueAids: number; duplicatesRemoved: number };
}

export interface SeedExtract {
  version: string;
  generatedAt: string;
  bounds: Bounds;
  navaids: Navaid[];
}

export interface LoadResult {
  navaids: Navaid[];
  shards: number;
  fetched: number;
}

const isBounds = (value: unknown): value is Bounds =>
  Array.isArray(value) &&
  value.length === 4 &&
  value.every((entry) => typeof entry === 'number' && Number.isFinite(entry));

export function validateManifest(value: unknown): NavaidManifest | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Partial<NavaidManifest>;
  if (input.schema !== 2 || typeof input.version !== 'string') return null;
  if (!Array.isArray(input.regions)) return null;
  const regions: RegionRef[] = [];
  for (const region of input.regions) {
    if (!region || typeof region.id !== 'string' || !isBounds(region.bounds)) return null;
    const shards: ShardRef[] = [];
    for (const shard of Array.isArray(region.shards) ? region.shards : []) {
      if (!shard || typeof shard.path !== 'string' || !isBounds(shard.bounds)) continue;
      shards.push({ path: shard.path, bounds: shard.bounds, count: Number(shard.count) || 0 });
    }
    regions.push({
      id: region.id,
      name: typeof region.name === 'string' ? region.name : region.id,
      bounds: region.bounds,
      count: Number(region.count) || 0,
      shards,
      sources: Array.isArray(region.sources) ? region.sources.map(String) : [],
    });
  }
  if (regions.length === 0) return null;
  return {
    schema: 2,
    version: input.version,
    generatedAt: typeof input.generatedAt === 'string' ? input.generatedAt : new Date(0).toISOString(),
    cellSize: Number(input.cellSize) || 0.25,
    regions,
    sources: Array.isArray(input.sources)
      ? input.sources
          .filter((source): source is { id: string; name: string } => Boolean(source) && typeof (source as { id?: unknown }).id === 'string')
          .map((source) => ({ id: source.id, name: String(source.name ?? source.id) }))
      : [],
    stats: {
      rawRecords: Number(input.stats?.rawRecords) || 0,
      uniqueAids: Number(input.stats?.uniqueAids) || 0,
      duplicatesRemoved: Number(input.stats?.duplicatesRemoved) || 0,
    },
  };
}

/**
 * A weekly no-store manifest check is only worth a request when the stored
 * stamp is missing or at least a week old.
 */
export function shouldRevalidate(checkedAt: number | null, now: number = Date.now(), maxAgeMs: number = WEEK_MS): boolean {
  if (checkedAt === null || !Number.isFinite(checkedAt)) return true;
  return now - checkedAt >= maxAgeMs;
}

export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  const [aSouth, aWest, aNorth, aEast] = a;
  const [bSouth, bWest, bNorth, bEast] = b;
  return aSouth <= bNorth && bSouth <= aNorth && aWest <= bEast && bWest <= aEast;
}

export function shardsForBounds(
  manifest: NavaidManifest,
  bounds: Bounds,
  limit: number = MAX_SHARDS_PER_LOAD,
): { region: RegionRef; shards: ShardRef[] }[] {
  const result: { region: RegionRef; shards: ShardRef[] }[] = [];
  for (const region of manifest.regions) {
    if (!boundsIntersect(region.bounds, bounds)) continue;
    const shards = region.shards
      .filter((shard) => boundsIntersect(shard.bounds, bounds))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
    if (shards.length > 0) result.push({ region, shards });
  }
  return result;
}

export function regionForPoint(manifest: NavaidManifest, lat: number, lon: number): RegionRef | null {
  return (
    manifest.regions.find(
      (region) =>
        lat >= region.bounds[0] && lat <= region.bounds[2] && lon >= region.bounds[1] && lon <= region.bounds[3],
    ) ?? null
  );
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      if (!db.objectStoreNames.contains('shards')) db.createObjectStore('shards');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function idbGet<T>(db: IDBDatabase, store: string, key: string): Promise<T | null> {
  return new Promise((resolve) => {
    try {
      const request = db.transaction(store, 'readonly').objectStore(store).get(key);
      request.onsuccess = () => resolve((request.result as T) ?? null);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function idbPut(db: IDBDatabase, store: string, key: string, value: unknown): Promise<void> {
  return new Promise((resolve) => {
    try {
      const request = db.transaction(store, 'readwrite').objectStore(store).put(value, key);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

function idbKeys(db: IDBDatabase, store: string): Promise<string[]> {
  return new Promise((resolve) => {
    try {
      const request = db.transaction(store, 'readonly').objectStore(store).getAllKeys();
      request.onsuccess = () => resolve((request.result as string[]) ?? []);
      request.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

function idbDelete(db: IDBDatabase, store: string, key: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const request = db.transaction(store, 'readwrite').objectStore(store).delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

interface StoredManifest {
  manifest: NavaidManifest;
  checkedAt: number;
}

export interface InitReport {
  manifest: NavaidManifest | null;
  checked: boolean;
  updated: boolean;
}

export class NavaidDatabase {
  private db: IDBDatabase | null = null;
  private dbPromise: Promise<IDBDatabase | null> | null = null;
  private manifest: NavaidManifest | null = null;
  private checkedAt: number | null = null;
  private memory = new Map<string, Navaid[]>();
  private inFlight = new Map<string, Promise<Navaid[]>>();

  private async database(): Promise<IDBDatabase | null> {
    if (this.db) return this.db;
    if (!this.dbPromise) this.dbPromise = openDatabase();
    this.db = await this.dbPromise;
    return this.db;
  }

  getManifest(): NavaidManifest | null {
    return this.manifest;
  }

  getCheckedAt(): number | null {
    return this.checkedAt;
  }

  seed(): Navaid[] {
    return (seedExtract as SeedExtract).navaids;
  }

  async init(): Promise<InitReport> {
    const db = await this.database();
    const stored = db ? await idbGet<StoredManifest>(db, 'meta', 'manifest') : null;
    if (stored && validateManifest(stored.manifest)) {
      this.manifest = stored.manifest;
      this.checkedAt = stored.checkedAt;
    }
    const checked = await this.ensureFresh(false);
    return { manifest: this.manifest, checked: checked.checked, updated: checked.updated };
  }

  async ensureFresh(force: boolean): Promise<{ checked: boolean; updated: boolean }> {
    const due = force || shouldRevalidate(this.checkedAt);
    if (!due) return { checked: false, updated: false };
    try {
      const response = await fetch(MANIFEST_URL, { cache: 'no-store' });
      if (!response.ok) return { checked: true, updated: false };
      const candidate = validateManifest(await response.json());
      if (!candidate) return { checked: true, updated: false };
      const previousVersion = this.manifest?.version ?? null;
      const updated = previousVersion !== candidate.version;
      this.manifest = candidate;
      this.checkedAt = Date.now();
      const db = await this.database();
      if (db) {
        await idbPut(db, 'meta', 'manifest', { manifest: candidate, checkedAt: this.checkedAt });
        if (updated && previousVersion) {
          const keys = await idbKeys(db, 'shards');
          for (const key of keys) {
            if (key.startsWith(`${previousVersion}|`)) await idbDelete(db, 'shards', key);
          }
          this.memory.clear();
        }
      }
      return { checked: true, updated };
    } catch {
      return { checked: true, updated: false };
    }
  }

  private async loadShard(version: string, path: string): Promise<Navaid[]> {
    const key = `${version}|${path}`;
    const memoryHit = this.memory.get(key);
    if (memoryHit) return memoryHit;

    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const promise = (async () => {
      const db = await this.database();
      if (db) {
        const cached = await idbGet<{ navaids: Navaid[] }>(db, 'shards', key);
        if (cached?.navaids) {
          this.memory.set(key, cached.navaids);
          return cached.navaids;
        }
      }
      try {
        const response = await fetch(`/navaid-db/${path}`);
        if (!response.ok) return [];
        const payload = (await response.json()) as { navaids?: Navaid[] };
        const navaids = Array.isArray(payload.navaids) ? payload.navaids : [];
        if (navaids.length > 0 && db) await idbPut(db, 'shards', key, { navaids, path });
        this.memory.set(key, navaids);
        return navaids;
      } catch {
        return [];
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise);
    return promise;
  }

  async load(bounds: Bounds): Promise<LoadResult> {
    if (!this.manifest) return { navaids: [], shards: 0, fetched: 0 };
    const selections = shardsForBounds(this.manifest, bounds);
    const version = this.manifest.version;
    const navaids: Navaid[] = [];
    let shards = 0;
    let fetched = 0;

    for (const selection of selections) {
      for (const shard of selection.shards) {
        shards += 1;
        const before = this.memory.has(`${version}|${shard.path}`);
        const loaded = await this.loadShard(version, shard.path);
        if (!before) fetched += 1;
        navaids.push(...loaded);
      }
    }

    return { navaids, shards, fetched };
  }

  /** Warm every shard of a region once the chart is idle; failures are silent. */
  async prefetchRegion(regionId: string): Promise<void> {
    if (!this.manifest) return;
    const region = this.manifest.regions.find((entry) => entry.id === regionId);
    if (!region) return;
    for (const shard of region.shards.slice(0, MAX_SHARDS_PER_LOAD)) {
      await this.loadShard(this.manifest.version, shard.path);
    }
  }
}

export const navaidDatabase = new NavaidDatabase();
