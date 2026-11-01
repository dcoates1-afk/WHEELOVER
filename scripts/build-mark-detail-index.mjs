#!/usr/bin/env node
/**
 * Build the worldwide mark-detail index.
 *
 * The mark archive was built from a planet snapshot that kept a name, a
 * category and a light summary, so almost every mark reaches the chart with its
 * topmark, shape, colour pattern, structure, height and light reference blank.
 * Those fields are all present in the OpenStreetMap tags the archive was built
 * from, and the pulls already held in `data-raw/` carry them in full.
 *
 * The index is cell-sharded like the sector and signal indices and attaches to
 * the archive marks by OSM id when the viewport changes.
 *
 * Input:  any OpenStreetMap pulls using `out center tags`, by default
 *         data-raw/osm-light-sectors.json and data-raw/osm-signals.json.
 *         Pass more with repeated `--input` flags — the same script accepts a
 *         worldwide seamark pull once one is available.
 * Output: public/marine-db/mark-details/{cell}.json + manifest.json
 *
 * Usage:
 *   node scripts/build-mark-detail-index.mjs
 *   node scripts/build-mark-detail-index.mjs --input a.json --input b.json
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { markDetailFields } from '../shared/mark-detail-core.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

function flagValues(name) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1]) values.push(resolve(args[index + 1]));
  }
  return values;
}

const inputs = flagValues('--input');
const inputPaths = inputs.length > 0
  ? inputs
  : [
      join(root, 'data-raw', 'osm-light-sectors.json'),
      join(root, 'data-raw', 'osm-signals.json'),
    ];
const outputFlag = flagValues('--output')[0];
const outputDir = outputFlag ?? join(root, 'public', 'marine-db', 'mark-details');
const CELL_SIZE = 5;

const cells = new Map();
const sources = [];
let elements = 0;
let skipped = 0;
let noPosition = 0;
let newestSnapshot = null;

function cellFor(lat, lon) {
  const y = Math.floor((lat + 90) / CELL_SIZE);
  const x = Math.floor((lon + 180) / CELL_SIZE);
  const bounds = [y * CELL_SIZE - 90, x * CELL_SIZE - 180, (y + 1) * CELL_SIZE - 90, (x + 1) * CELL_SIZE - 180];
  return { id: `${y}_${x}`, bounds };
}

for (const path of inputPaths) {
  const payload = JSON.parse(readFileSync(path, 'utf8'));
  const snapshot = payload.osm3s?.timestamp_osm_base ?? null;
  if (snapshot && (!newestSnapshot || snapshot > newestSnapshot)) newestSnapshot = snapshot;
  sources.push({ path: path.replace(`${root}\\`, '').replace(`${root}/`, ''), snapshot });
  for (const element of Array.isArray(payload.elements) ? payload.elements : []) {
    elements += 1;
    const { fields, details } = markDetailFields(element.tags ?? {});
    const lat = element.lat ?? element.center?.lat;
    const lon = element.lon ?? element.center?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      noPosition += 1;
      continue;
    }
    if (Object.keys(fields).length === 0 && Object.keys(details).length === 0) {
      skipped += 1;
      continue;
    }
    const id = `osm:${element.type ?? 'node'}/${element.id}`;
    const cell = cellFor(lat, lon);
    const bucket = cells.get(cell.id) ?? { bounds: cell.bounds, marks: {} };
    const existing = bucket.marks[id] ?? {};
    // The first pull that carries a value wins; later pulls only fill gaps, so
    // an input order of detail-first keeps the most specific source.
    const merged = { ...existing };
    for (const [field, value] of Object.entries(fields)) {
      if (merged[field] === undefined) merged[field] = value;
    }
    if (Object.keys(details).length > 0) {
      merged.details = { ...(merged.details ?? {}) };
      for (const [key, value] of Object.entries(details)) {
        if (merged.details[key] === undefined) merged.details[key] = value;
      }
    }
    merged.lat = Number(lat.toFixed(6));
    merged.lon = Number(lon.toFixed(6));
    bucket.marks[id] = merged;
    cells.set(cell.id, bucket);
  }
}

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });

const shards = [];
for (const [id, bucket] of [...cells].sort(([a], [b]) => a.localeCompare(b))) {
  const count = Object.keys(bucket.marks).length;
  writeFileSync(join(outputDir, `${id}.json`), JSON.stringify(bucket));
  shards.push({ path: `mark-details/${id}.json`, bounds: bucket.bounds, count });
}

const manifest = {
  schema: 1,
  generatedAt: new Date().toISOString(),
  source: 'OpenStreetMap contributors (ODbL)',
  sourceTimestamp: newestSnapshot,
  sources,
  count: shards.reduce((total, shard) => total + shard.count, 0),
  cells: shards,
};
writeFileSync(join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
console.log(
  `Mark-detail index: ${manifest.count} marks in ${shards.length} cells ` +
    `from ${inputPaths.length} pull(s) of ${elements} elements ` +
    `(${skipped} without detail, ${noPosition} without position) → ${outputDir}`,
);
