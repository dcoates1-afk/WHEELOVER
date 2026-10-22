#!/usr/bin/env node
/**
 * Build the offline NAVAID database from the raw OSM snapshots.
 *
 *   node scripts/build-navaid-db.mjs            # rebuild from data-raw
 *   node scripts/build-navaid-db.mjs --refresh  # fetch fresh OSM data first
 *
 * Output:
 *   public/navaid-db/manifest.json   version, regions, shard index, sources
 *   public/navaid-db/<region>/*.json per-cell shards
 *   src/data/solentNavaids.json      seed extract for instant first paint
 *
 * A zero-aid build is refused: publishing an empty chart database is worse
 * than keeping the previous one.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeElement,
  dedupeNavaids,
  cellKey,
  cellBounds,
  DEFAULT_CELL_SIZE,
} from '../shared/navaid-core.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const registry = JSON.parse(readFileSync(resolve(root, 'src/data/navaidSources.json'), 'utf8'));
const outDir = resolve(root, 'public/navaid-db');
const refresh = process.argv.includes('--refresh');
const MIRRORS = [
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

function query(bounds) {
  const [w, s, e, n] = bounds;
  const box = `${s},${w},${n},${e}`;
  return `[out:json][timeout:120];(node["seamark:type"](${box});way["seamark:type"](${box})["seamark:type"!="calling-in_point"];node["man_made"="lighthouse"](${box});node["seamark:light:character"](${box}););out center tags;way["seamark:type"="calling-in_point"](${box});out geom;`;
}

async function fetchRegion(region) {
  const body = new URLSearchParams({ data: query(region.bounds) });
  let lastError = null;
  for (const mirror of MIRRORS) {
    try {
      const response = await fetch(mirror, {
        method: 'POST',
        headers: { 'User-Agent': 'wheel-over-navaid-build/1.0', 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(150_000),
      });
      if (!response.ok) {
        lastError = new Error(`${mirror} -> HTTP ${response.status}`);
        continue;
      }
      const payload = await response.json();
      if (!Array.isArray(payload.elements) || payload.elements.length === 0) {
        lastError = new Error(`${mirror} -> 0 elements`);
        continue;
      }
      return payload;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error('all Overpass mirrors failed');
}

function stamp(iso) {
  return iso.slice(0, 19).replace(/[:T]/g, '').replace(/-/g, '');
}

async function main() {
  const built = [];
  let totalRaw = 0;
  let totalUnique = 0;
  let totalDuplicates = 0;
  const usedSources = new Set();

  for (const region of registry.regions) {
    let snapshot;
    if (refresh) {
      console.log(`[db] fetching ${region.id} from Overpass…`);
      snapshot = await fetchRegion(region);
      writeFileSync(resolve(root, region.snapshot), JSON.stringify(snapshot));
    } else {
      snapshot = JSON.parse(readFileSync(resolve(root, region.snapshot), 'utf8'));
    }

    const normalized = [];
    for (const element of snapshot.elements ?? []) {
      const navaid = normalizeElement(element, region.id, 'osm');
      if (navaid) normalized.push(navaid);
    }
    const { navaids, removed } = dedupeNavaids(normalized);
    if (navaids.length === 0) {
      throw new Error(`refusing to publish an empty database for ${region.id}`);
    }

    // Group into cells so the client can fetch only what is on screen.
    const cells = new Map();
    for (const navaid of navaids) {
      const key = cellKey(navaid.lat, navaid.lon, DEFAULT_CELL_SIZE);
      const bucket = cells.get(key) ?? [];
      bucket.push(navaid);
      cells.set(key, bucket);
    }

    const shards = [];
    const regionDir = resolve(outDir, region.id);
    rmSync(regionDir, { recursive: true, force: true });
    mkdirSync(regionDir, { recursive: true });
    for (const [key, aids] of [...cells.entries()].sort((a, b) => b[1].length - a[1].length)) {
      const bounds = cellBounds(key, DEFAULT_CELL_SIZE);
      const path = `${region.id}/${key.replace(':', '_')}.json`;
      writeFileSync(
        resolve(outDir, path),
        JSON.stringify({ cell: key, bounds, navaids: aids }),
      );
      shards.push({ path, bounds, count: aids.length });
    }

    totalRaw += (snapshot.elements ?? []).length;
    totalUnique += navaids.length;
    totalDuplicates += removed;
    for (const source of region.sources) usedSources.add(source);

    const categoryCounts = {};
    for (const navaid of navaids) {
      categoryCounts[navaid.category] = (categoryCounts[navaid.category] ?? 0) + 1;
    }

    built.push({
      id: region.id,
      name: region.name,
      bounds: region.bounds,
      count: navaids.length,
      sources: region.sources,
      shards,
      categoryCounts,
    });
    console.log(
      `[db] ${region.id}: ${normalized.length} parsed, ${navaids.length} unique, ${removed} duplicates, ${shards.length} shards`,
    );
  }

  if (totalUnique === 0) throw new Error('refusing to publish an empty database');

  const generatedAt = new Date().toISOString();
  const fingerprint = createHash('sha1')
    .update(JSON.stringify(built.map((region) => [region.id, region.count, region.shards.map((s) => s.path)])))
    .update(String(totalUnique))
    .digest('hex')
    .slice(0, 10);

  const manifest = {
    schema: 2,
    version: `${stamp(generatedAt)}-${fingerprint}`,
    generatedAt,
    cellSize: DEFAULT_CELL_SIZE,
    regions: built,
    sources: registry.sources.filter((source) => usedSources.has(source.id)),
    sourceRegistry: registry.sources.map((source) => ({
      id: source.id,
      name: source.name,
      enabled: source.enabled,
      redistribution: source.redistribution,
      licence: source.licence,
    })),
    stats: {
      rawRecords: totalRaw,
      uniqueAids: totalUnique,
      duplicatesRemoved: totalDuplicates,
    },
  };

  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // Seed extract: the highest-priority aids charted instantly before shards load.
  const solent = built.find((region) => region.id === 'solent') ?? built[0];
  const all = [];
  for (const shard of solent.shards) {
    const payload = JSON.parse(readFileSync(resolve(outDir, shard.path), 'utf8'));
    all.push(...payload.navaids);
  }
  all.sort((a, b) => b.priority - a.priority);
  const seed = all.slice(0, 400);
  writeFileSync(
    resolve(root, 'src/data/solentNavaids.json'),
    JSON.stringify(
      {
        version: manifest.version,
        generatedAt,
        bounds: solent.bounds,
        navaids: seed,
      },
      null,
      0,
    ),
  );

  console.log(
    `[db] wrote ${totalUnique} aids across ${built.length} regions; version ${manifest.version}; seed ${seed.length}`,
  );
}

main().catch((error) => {
  console.error('[db] build failed:', error.message);
  process.exitCode = 1;
});
