import type { ChartFeature } from './overpass';

/**
 * On-device cache for drawn bridge/area features.
 *
 * The server's disk cache is wiped on every Render redeploy (free plan, no
 * persistent disk), so after each deploy every chart view the user revisits
 * pays a full mirror round trip again — the slow loads Doug kept seeing.
 * This store lives in the browser's IndexedDB, so it survives redeploys and
 * page reloads: a view already visited loads from the device at once.
 *
 * Freshness mirrors the server's policy: fresh for six hours, then served
 * stale for up to thirty days while a quiet refresh replaces it. The cache
 * is best-effort throughout — any IndexedDB failure falls back to a live
 * fetch, never to a failed overlay.
 */

export const CHART_FEATURE_STORE_FRESH_MS = 6 * 60 * 60 * 1000;
export const CHART_FEATURE_STORE_STALE_MS = 30 * 24 * 60 * 60 * 1000;

const DB_NAME = 'wheelover-chart-features';
const STORE_NAME = 'cells';
const MAX_CELLS = 500;
/** An IndexedDB open that never settles must not hang the overlay. */
const STORE_TIMEOUT_MS = 2000;

export interface StoredChartFeatureCell {
  key: string;
  features: ChartFeature[];
  at: number;
}

export function storedCellStatus(at: number, now = Date.now()): 'fresh' | 'stale' | 'expired' {
  const age = now - at;
  if (age < CHART_FEATURE_STORE_FRESH_MS) return 'fresh';
  if (age < CHART_FEATURE_STORE_STALE_MS) return 'stale';
  return 'expired';
}

let dbPromise: Promise<IDBDatabase> | null = null;

function indexedDBAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined';
  } catch {
    return false;
  }
}

function openStore(): Promise<IDBDatabase> {
  if (!indexedDBAvailable()) return Promise.reject(new Error('IndexedDB unavailable'));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error('IndexedDB open failed'));
    };
  });
  return dbPromise;
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('chart feature store timeout')), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function readCell(key: string): Promise<StoredChartFeatureCell | null> {
  return openStore().then(
    (db) =>
      new Promise<StoredChartFeatureCell | null>((resolve, reject) => {
        const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
        request.onsuccess = () => resolve((request.result as StoredChartFeatureCell | undefined) ?? null);
        request.onerror = () => reject(request.error ?? new Error('chart feature read failed'));
      }),
  );
}

export async function readChartFeatureCell(key: string): Promise<StoredChartFeatureCell | null> {
  try {
    return await withTimeout(readCell(key), STORE_TIMEOUT_MS);
  } catch {
    return null;
  }
}

function writeCell(cell: StoredChartFeatureCell): Promise<void> {
  return openStore().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        store.put(cell);
        // Keep the store bounded: drop the oldest cells past the cap. The
        // getAll runs after the put in the same transaction, so it sees the
        // cell just stored.
        const allRequest = store.getAll();
        allRequest.onsuccess = () => {
          const cells = (allRequest.result as StoredChartFeatureCell[]).sort((a, b) => a.at - b.at);
          for (let i = 0; i < cells.length - MAX_CELLS; i += 1) {
            store.delete(cells[i].key);
          }
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error('chart feature write failed'));
      }),
  );
}

export async function writeChartFeatureCell(key: string, features: ChartFeature[], at: number): Promise<void> {
  try {
    await withTimeout(writeCell({ key, features, at }), STORE_TIMEOUT_MS);
  } catch {
    // Best-effort: a failed device write must never fail the overlay.
  }
}
