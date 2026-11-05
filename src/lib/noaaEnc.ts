import type { Navaid } from './navaidTypes';
import {
  MAX_SHARDS_PER_LOAD,
  shardsForBounds,
  validateManifest,
  type Bounds,
  type NavaidManifest,
} from './navaidDb';

/**
 * NOAA ENC aids to navigation, built by scripts/build-noaa-enc-marks.mjs from
 * NOAA ENC Direct to GIS into 0.25 deg cell shards under
 * public/noaa-enc-marks/. The client fetches only the shards intersecting the
 * viewport — the same pattern as the built Solent/NY Harbor database
 * (src/lib/navaidDb.ts), but without the IndexedDB layer: shards are cached
 * in memory for the session, and the browser cache covers repeat visits.
 *
 * Records are already classified at build time (official tier, source
 * 'noaa-enc'); the loader only fetches and filters. The app-level
 * merge/dedupe in App.tsx then folds ENC marks onto their OSM twins, the
 * same way CCG and USCG records join.
 */
export const NOAA_ENC_MANIFEST_URL = '/noaa-enc-marks/manifest.json';

let manifest: NavaidManifest | null = null;
let manifestPromise: Promise<NavaidManifest | null> | null = null;
const memory = new Map<string, Navaid[]>();
const inFlight = new Map<string, Promise<Navaid[]>>();

export function getNoaaEncManifest(): NavaidManifest | null {
  return manifest;
}

export function loadNoaaEncManifest(): Promise<NavaidManifest | null> {
  if (manifestPromise) return manifestPromise;
  manifestPromise = (async () => {
    try {
      const response = await fetch(NOAA_ENC_MANIFEST_URL, { cache: 'no-store' });
      if (!response.ok) return null;
      manifest = validateManifest(await response.json());
      return manifest;
    } catch {
      return null;
    }
  })();
  return manifestPromise;
}

async function loadShard(path: string): Promise<Navaid[]> {
  const memoryHit = memory.get(path);
  if (memoryHit) return memoryHit;
  const existing = inFlight.get(path);
  if (existing) return existing;
  const promise = (async () => {
    try {
      const response = await fetch(`/noaa-enc-marks/${path}`);
      if (!response.ok) return [];
      const payload = (await response.json()) as { navaids?: Navaid[] };
      const navaids = Array.isArray(payload.navaids) ? payload.navaids : [];
      memory.set(path, navaids);
      return navaids;
    } catch {
      return [];
    } finally {
      inFlight.delete(path);
    }
  })();
  inFlight.set(path, promise);
  return promise;
}

/** Marks in the shards intersecting the viewport (at most 14 shards, densest first). */
export async function loadNoaaEncMarks(bounds: Bounds): Promise<Navaid[]> {
  const current = manifest ?? (await loadNoaaEncManifest());
  if (!current) return [];
  const selections = shardsForBounds(current, bounds, MAX_SHARDS_PER_LOAD);
  const navaids: Navaid[] = [];
  for (const selection of selections) {
    for (const shard of selection.shards) {
      navaids.push(...(await loadShard(shard.path)));
    }
  }
  return navaids;
}

/** Test-only reset for the module-level caches. */
export function __resetNoaaEncCache(): void {
  manifest = null;
  manifestPromise = null;
  memory.clear();
  inFlight.clear();
}
