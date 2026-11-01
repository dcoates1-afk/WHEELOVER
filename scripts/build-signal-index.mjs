#!/usr/bin/env node
/**
 * Build the worldwide mark-signal index.
 *
 * The mark archive was built from a planet snapshot that kept a light's
 * character and sectors but dropped every sound signal and radar transponder,
 * so a buoy with a bell or a racon was drawn without them. Signals are sparse
 * enough worldwide (a few thousand objects) to ship as their own small index
 * and attach to the archive marks by OSM id when the viewport changes.
 *
 * The Overpass pull must union the presence tag and the detail tags, or a
 * signal recorded only as `seamark:fog_signal:category` is lost:
 *   [out:json][timeout:900];
 *   (
 *     nwr["seamark:fog_signal"="yes"];
 *     nwr["seamark:fog_signal:category"];
 *     nwr["seamark:radar_transponder:category"];
 *   );
 *   out center tags;
 *
 * Input:  data-raw/osm-signals.json (Overpass `out center tags`)
 * Output: public/marine-db/signals/{cell}.json + manifest.json
 *
 * Usage:
 *   node scripts/build-signal-index.mjs
 *   node scripts/build-signal-index.mjs --input path/to/overpass.json
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const inputIndex = args.indexOf('--input');
const inputPath = inputIndex >= 0 ? resolve(args[inputIndex + 1]) : join(root, 'data-raw', 'osm-signals.json');
const outputIndex = args.indexOf('--output');
const outputDir = outputIndex >= 0
  ? resolve(args[outputIndex + 1])
  : join(root, 'public', 'marine-db', 'signals');
const CELL_SIZE = 5;

const FOG_FIELDS = {
  fogSignalCategory: 'seamark:fog_signal:category',
  fogSignalGroup: 'seamark:fog_signal:group',
  fogSignalPeriod: 'seamark:fog_signal:period',
  fogSignalSequence: 'seamark:fog_signal:sequence',
};

const RACON_FIELDS = {
  radarTransponderCategory: 'seamark:radar_transponder:category',
  radarTransponderGroup: 'seamark:radar_transponder:group',
  radarTransponderPeriod: 'seamark:radar_transponder:period',
  radarTransponderSequence: 'seamark:radar_transponder:sequence',
};

const text = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

const payload = JSON.parse(readFileSync(inputPath, 'utf8'));
const elements = Array.isArray(payload.elements) ? payload.elements : [];
const cells = new Map();
let withFog = 0;
let withRacon = 0;
let skipped = 0;
let noPosition = 0;

function cellFor(lat, lon) {
  const y = Math.floor((lat + 90) / CELL_SIZE);
  const x = Math.floor((lon + 180) / CELL_SIZE);
  const bounds = [y * CELL_SIZE - 90, x * CELL_SIZE - 180, (y + 1) * CELL_SIZE - 90, (x + 1) * CELL_SIZE - 180];
  return { id: `${y}_${x}`, bounds };
}

for (const element of elements) {
  const tags = element.tags ?? {};
  const entry = {};
  for (const [field, key] of Object.entries(FOG_FIELDS)) {
    const value = text(tags[key]);
    if (value) entry[field] = value;
  }
  // `seamark:fog_signal=yes` alone is enough to mark the signal, even when the
  // mapping carries no category or timing.
  const hasFog = tags['seamark:fog_signal'] === 'yes' || Boolean(entry.fogSignalCategory);
  if (hasFog) entry.fogSignal = true;
  for (const [field, key] of Object.entries(RACON_FIELDS)) {
    const value = text(tags[key]);
    if (value) entry[field] = value;
  }
  const hasRacon = Boolean(
    entry.radarTransponderCategory ?? entry.radarTransponderGroup ??
      entry.radarTransponderPeriod ?? entry.radarTransponderSequence,
  );
  if (!hasFog && !hasRacon) {
    skipped++;
    continue;
  }

  const lat = element.lat ?? element.center?.lat;
  const lon = element.lon ?? element.center?.lon;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    noPosition++;
    continue;
  }
  entry.lat = Number(lat.toFixed(6));
  entry.lon = Number(lon.toFixed(6));
  const type = text(tags['seamark:type']);
  if (type) entry.type = type;

  const cell = cellFor(lat, lon);
  const bucket = cells.get(cell.id) ?? { bounds: cell.bounds, marks: {} };
  bucket.marks[`osm:${element.type ?? 'node'}/${element.id}`] = entry;
  cells.set(cell.id, bucket);
  if (hasFog) withFog++;
  if (hasRacon) withRacon++;
}

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });

const shards = [];
for (const [id, bucket] of [...cells].sort(([a], [b]) => a.localeCompare(b))) {
  const count = Object.keys(bucket.marks).length;
  writeFileSync(join(outputDir, `${id}.json`), JSON.stringify(bucket));
  shards.push({ path: `signals/${id}.json`, bounds: bucket.bounds, count });
}

const manifest = {
  schema: 1,
  generatedAt: new Date().toISOString(),
  source: 'OpenStreetMap contributors (ODbL)',
  sourceTimestamp: payload.osm3s?.timestamp_osm_base ?? null,
  count: shards.reduce((total, shard) => total + shard.count, 0),
  fogSignals: withFog,
  racons: withRacon,
  cells: shards,
};
writeFileSync(join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
console.log(
  `Mark-signal index: ${manifest.count} marks (${withFog} fog signals, ${withRacon} racons) ` +
    `in ${shards.length} cells (${skipped} without a signal, ${noPosition} without position) → ${outputDir}`,
);
