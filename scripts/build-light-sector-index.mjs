#!/usr/bin/env node
/**
 * Build the worldwide light-sector index.
 *
 * The worldwide mark archive is built from a planet snapshot that predates the
 * per-sector light fields, so its marks carry a light summary but no bearing
 * limits. Sector bearings are few enough (a few thousand lights worldwide) to
 * ship as their own small index and attach to the archive marks by OSM id on
 * load.
 *
 * The Overpass pull must use a key regex, not just the light-1 and unnumbered
 * keys, or lights whose first charted sector starts on light 2 are lost:
 *   [out:json][timeout:500];
 *   ( nwr[~"^seamark:light:([0-9]+:)?sector_start$"~"."]; );
 *   out center tags;
 *
 * Input:  data-raw/osm-light-sectors.json (Overpass `out center tags`)
 * Output: public/marine-db/light-sectors/{cell}.json + manifest.json
 *
 * Usage:
 *   node scripts/build-light-sector-index.mjs
 *   node scripts/build-light-sector-index.mjs --input path/to/overpass.json
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lightSectorsFromTags } from '../shared/navaid-core.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const inputIndex = args.indexOf('--input');
const inputPath = inputIndex >= 0 ? resolve(args[inputIndex + 1]) : join(root, 'data-raw', 'osm-light-sectors.json');
const outputIndex = args.indexOf('--output');
const outputDir = outputIndex >= 0
  ? resolve(args[outputIndex + 1])
  : join(root, 'public', 'marine-db', 'light-sectors');
const CELL_SIZE = 5;

const SECTOR_FIELDS = [
  'character', 'colour', 'group', 'period', 'sequence', 'start', 'end',
  'range', 'visibility', 'exhibition', 'category', 'orientation', 'height', 'multiple',
];

function firstTag(tags, keys) {
  for (const key of keys) {
    const value = tags[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function compactSectors(sectors) {
  return sectors.map((sector) => {
    const record = { sector: sector.sector };
    for (const field of SECTOR_FIELDS) {
      const value = sector[field];
      if (typeof value === 'string' && value.trim()) record[field] = value.trim();
    }
    return record;
  });
}

/**
 * Index lights the worldwide archive has no mark for at all.
 *
 * The archive is built from a planet snapshot that skips some objects which do
 * carry light tags (a handful of beacons and mole lights worldwide), so those
 * sectors had nowhere to draw. Those entries are flagged `standalone` and the
 * chart draws a light mark for them; every other entry must attach to a mark.
 */
const ARCHIVE_DIR = join(root, 'public', 'marine-db', 'navaids');
const PROXIMITY_TYPES = new Set(['light_major', 'light_minor', 'light', 'lighthouse', 'beacon']);
const PROXIMITY_M = 250;

function metersBetween(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(a)));
}

function readArchiveMarks() {
  const ids = new Set();
  /** 0.01° buckets of marks a light could attach to. */
  const grid = new Map();
  const fileNames = readdirSync(ARCHIVE_DIR).filter((name) => name.endsWith('.json'));
  for (const name of fileNames) {
    const shard = JSON.parse(readFileSync(join(ARCHIVE_DIR, name), 'utf8'));
    for (const feature of shard.features ?? []) {
      const mark = feature?.navaid ?? feature;
      if (!mark || !Number.isFinite(mark.lat) || !Number.isFinite(mark.lon)) continue;
      ids.add(mark.id);
      if (!mark.lit && mark.category !== 'landmark' && mark.category !== 'other') continue;
      const key = `${Math.floor(mark.lat * 100)}_${Math.floor(mark.lon * 100)}`;
      const bucket = grid.get(key) ?? [];
      bucket.push(mark);
      grid.set(key, bucket);
    }
  }
  return { ids, grid };
}

function hasMarkNear(grid, lat, lon) {
  const y = Math.floor(lat * 100);
  const x = Math.floor(lon * 100);
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      for (const mark of grid.get(`${y + dy}_${x + dx}`) ?? []) {
        if (metersBetween(lat, lon, mark.lat, mark.lon) <= PROXIMITY_M) return true;
      }
    }
  }
  return false;
}

const payload = JSON.parse(readFileSync(inputPath, 'utf8'));
const elements = Array.isArray(payload.elements) ? payload.elements : [];
const cells = new Map();
let withSectors = 0;
let records = 0;
let skipped = 0;
let noPosition = 0;
let withSignals = 0;

function cellFor(lat, lon) {
  const y = Math.floor((lat + 90) / CELL_SIZE);
  const x = Math.floor((lon + 180) / CELL_SIZE);
  const bounds = [y * CELL_SIZE - 90, x * CELL_SIZE - 180, (y + 1) * CELL_SIZE - 90, (x + 1) * CELL_SIZE - 180];
  return { id: `${y}_${x}`, bounds };
}

for (const element of elements) {
  const tags = element.tags ?? {};
  const type = element.type ?? 'node';
  const id = `osm:${type}/${element.id}`;
  const lat = element.lat ?? element.center?.lat;
  const lon = element.lon ?? element.center?.lon;
  const sectors = lightSectorsFromTags(tags);
  if (sectors.length === 0) {
    skipped++;
    continue;
  }
  const hasLimits = sectors.some((sector) =>
    (Number.isFinite(Number(sector.start)) && sector.start !== '') &&
    (Number.isFinite(Number(sector.end)) && sector.end !== ''),
  );
  const directional = sectors.some((sector) =>
    String(sector.category ?? '').toLowerCase() === 'directional' && Number.isFinite(Number(sector.orientation)),
  );
  if (!hasLimits && !directional) {
    skipped++;
    continue;
  }
  const entry = { sectors: compactSectors(sectors) };
  const name = firstTag(tags, ['seamark:name', 'name']);
  if (name) entry.name = name;
  // Position and seamark type travel with the entry so a light mapped as a
  // multipolygon can still be attached to the archive mark for the same
  // structure, which carries a different (often synthetic) id.
  const seamarkType = typeof tags['seamark:type'] === 'string' ? tags['seamark:type'].trim() : null;
  // A handful of charted lights carry light tags without a seamark type; they
  // are still lights, so they stay eligible for a position-based attach.
  entry.type = seamarkType || 'light';
  const character = firstTag(tags, ['seamark:light:character']) ?? sectors.find((sector) => sector.character)?.character ?? null;
  const colour = firstTag(tags, ['seamark:light:colour']) ?? sectors.find((sector) => sector.colour)?.colour ?? null;
  const category = firstTag(tags, ['seamark:light:category']) ?? null;
  if (character) entry.character = character;
  if (colour) entry.colour = colour;
  if (category) entry.category = category;
  // Sound and radar signals are drawn on the mark, so they travel with it. A
  // light the chart has to draw from the index would otherwise lose its bell
  // or racon even though OSM records one.
  const fogSignalCategory = firstTag(tags, ['seamark:fog_signal:category']);
  const fogSignalGroup = firstTag(tags, ['seamark:fog_signal:group']);
  const fogSignalPeriod = firstTag(tags, ['seamark:fog_signal:period']);
  const fogSignalSequence = firstTag(tags, ['seamark:fog_signal:sequence']);
  if (fogSignalCategory || fogSignalGroup || fogSignalPeriod || fogSignalSequence || tags['seamark:fog_signal'] === 'yes') {
    entry.fogSignal = true;
    if (fogSignalCategory) entry.fogSignalCategory = fogSignalCategory;
    if (fogSignalGroup) entry.fogSignalGroup = fogSignalGroup;
    if (fogSignalPeriod) entry.fogSignalPeriod = fogSignalPeriod;
    if (fogSignalSequence) entry.fogSignalSequence = fogSignalSequence;
    withSignals++;
  }
  const radarTransponderCategory = firstTag(tags, ['seamark:radar_transponder:category']);
  const radarTransponderGroup = firstTag(tags, ['seamark:radar_transponder:group']);
  const radarTransponderPeriod = firstTag(tags, ['seamark:radar_transponder:period']);
  const radarTransponderSequence = firstTag(tags, ['seamark:radar_transponder:sequence']);
  if (radarTransponderCategory || radarTransponderGroup || radarTransponderPeriod || radarTransponderSequence) {
    if (radarTransponderCategory) entry.radarTransponderCategory = radarTransponderCategory;
    if (radarTransponderGroup) entry.radarTransponderGroup = radarTransponderGroup;
    if (radarTransponderPeriod) entry.radarTransponderPeriod = radarTransponderPeriod;
    if (radarTransponderSequence) entry.radarTransponderSequence = radarTransponderSequence;
    withSignals++;
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    noPosition++;
    continue;
  }
  entry.lat = Number(lat.toFixed(6));
  entry.lon = Number(lon.toFixed(6));
  const cell = cellFor(lat, lon);
  const bucket = cells.get(cell.id) ?? { bounds: cell.bounds, lights: {} };
  bucket.lights[id] = entry;
  cells.set(cell.id, bucket);
  withSectors++;
  records += sectors.length;
}

// Flag the few lights the archive cannot carry a mark for. `--no-archive`
// skips this and leaves every entry to attach by id or proximity.
let standalone = 0;
if (!args.includes('--no-archive')) {
  const archive = readArchiveMarks();
  for (const bucket of cells.values()) {
    for (const [id, entry] of Object.entries(bucket.lights)) {
      if (archive.ids.has(id)) continue;
      if (!PROXIMITY_TYPES.has(String(entry.type ?? ''))) continue;
      if (!Number.isFinite(entry.lat) || !Number.isFinite(entry.lon)) continue;
      if (hasMarkNear(archive.grid, entry.lat, entry.lon)) continue;
      entry.standalone = true;
      standalone += 1;
    }
  }
}

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });
const shards = [];
for (const [id, bucket] of [...cells].sort(([a], [b]) => a.localeCompare(b))) {
  const count = Object.keys(bucket.lights).length;
  writeFileSync(join(outputDir, `${id}.json`), JSON.stringify(bucket));
  shards.push({ path: `light-sectors/${id}.json`, bounds: bucket.bounds, count });
}

const manifest = {
  schema: 1,
  generatedAt: new Date().toISOString(),
  source: 'OpenStreetMap contributors (ODbL)',
  sourceTimestamp: payload.osm3s?.timestamp_osm_base ?? null,
  count: withSectors,
  records,
  cells: shards,
};
writeFileSync(join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
console.log(
  `Light-sector index: ${withSectors} lights, ${records} records in ${shards.length} cells ` +
    `(${skipped} skipped, ${noPosition} without position, ${standalone} drawn standalone, ` +
    `${withSignals} sound/radar signals) → ${outputDir}`,
);
