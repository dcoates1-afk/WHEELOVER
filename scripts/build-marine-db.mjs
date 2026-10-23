#!/usr/bin/env node
/**
 * Convert an OSM-derived GeoJSON FeatureCollection or GeoJSON Text Sequence into
 * viewport-addressed NAVAID, ferry and TSS data. GeoJSONSeq is streamed for planet input.
 *
 *   node scripts/build-marine-db.mjs extract.geojsonseq
 *   node scripts/build-marine-db.mjs extract.geojsonseq --out public/marine-db
 */
import { createHash } from 'node:crypto';
import { closeSync, createReadStream, mkdirSync, openSync, readSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { rename } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { normalizeElement } from '../shared/navaid-core.mjs';

const args = process.argv.slice(2);
const inputPath = args.find((arg) => !arg.startsWith('--'));
const outArg = args.indexOf('--out');
const outDir = resolve(outArg >= 0 ? args[outArg + 1] : 'public/marine-db');
const CELL_SIZE = 5;
const MAX_FEATURES_PER_CELL = 400;
if (!inputPath) {
  console.error('Usage: node scripts/build-marine-db.mjs <extract.geojson|extract.geojsonseq> [--out directory]');
  process.exit(2);
}

function collectPaths(geometry) {
  if (!geometry) return [];
  switch (geometry.type) {
    case 'Point': return [[geometry.coordinates]];
    case 'MultiPoint': return geometry.coordinates.map((point) => [point]);
    case 'LineString': return [geometry.coordinates];
    case 'MultiLineString': return geometry.coordinates;
    case 'Polygon': return geometry.coordinates;
    case 'MultiPolygon': return geometry.coordinates.flat();
    case 'GeometryCollection': return geometry.geometries.flatMap(collectPaths);
    default: return [];
  }
}

function toPath(raw) {
  return raw
    .filter((coordinate) => Array.isArray(coordinate) && Number.isFinite(coordinate[0]) && Number.isFinite(coordinate[1]))
    .map(([lon, lat]) => [Number(lat.toFixed(5)), Number(lon.toFixed(5))]);
}

function boundsOf(paths) {
  let south = Infinity, west = Infinity, north = -Infinity, east = -Infinity;
  for (const path of paths) for (const [lat, lon] of path) {
    south = Math.min(south, lat); west = Math.min(west, lon);
    north = Math.max(north, lat); east = Math.max(east, lon);
  }
  return Number.isFinite(south) ? [south, west, north, east] : null;
}

function cellsFor([south, west, north, east]) {
  const minY = Math.floor((south + 90) / CELL_SIZE), maxY = Math.floor((north + 90) / CELL_SIZE);
  const minX = Math.floor((west + 180) / CELL_SIZE), maxX = Math.floor((east + 180) / CELL_SIZE);
  const cells = [];
  for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) cells.push([y, x]);
  return cells;
}

const cellBounds = ([y, x]) => [y * CELL_SIZE - 90, x * CELL_SIZE - 180, (y + 1) * CELL_SIZE - 90, (x + 1) * CELL_SIZE - 180];
const cellId = ([y, x]) => `${y}_${x}`;
const cells = { navaids: new Map(), ferries: new Map(), tss: new Map() };
const featureIds = { navaids: new Set(), ferries: new Set(), tss: new Set() };
let inputCount = 0;
let dropped = 0;

function addToCells(layer, item) {
  featureIds[layer].add(item.id);
  for (const cell of cellsFor(item.bounds)) {
    const key = cellId(cell);
    const bucket = cells[layer].get(key) ?? [];
    if (!bucket.some((entry) => entry.id === item.id)) bucket.push(item);
    cells[layer].set(key, bucket);
  }
}

function addNavaid(feature, properties, tags, seamark) {
  if (seamark === 'ferry_route' || (typeof seamark === 'string' && seamark.startsWith('separation_'))) return false;
  const coordinates = collectPaths(feature.geometry).map(toPath).filter((path) => path.length > 0);
  const rawBounds = boundsOf(coordinates);
  if (!rawBounds) return false;
  const osmId = String(properties['@id'] ?? feature.id ?? properties.osm_id ?? '');
  const match = osmId.match(/^([nwr])(-?\d+)$/);
  const type = match ? ({ n: 'node', w: 'way', r: 'relation' })[match[1]] : feature.geometry?.type === 'Point' ? 'node' : 'way';
  const tagsForCore = { ...tags };
  if (tagsForCore.seamark_type && !tagsForCore['seamark:type']) tagsForCore['seamark:type'] = tagsForCore.seamark_type;
  const center = [(rawBounds[0] + rawBounds[2]) / 2, (rawBounds[1] + rawBounds[3]) / 2];
  const isCallingPoint = seamark === 'calling_in_point' || seamark === 'calling-in_point';
  const element = {
    type,
    id: match ? Number(match[2]) : undefined,
    tags: tagsForCore,
    lat: feature.geometry?.type === 'Point' ? feature.geometry.coordinates[1] : undefined,
    lon: feature.geometry?.type === 'Point' ? feature.geometry.coordinates[0] : undefined,
    center: feature.geometry?.type === 'Point' ? undefined : { lat: center[0], lon: center[1] },
    geometry: isCallingPoint && feature.geometry?.type === 'LineString'
      ? feature.geometry.coordinates.map(([lon, lat]) => ({ lat, lon }))
      : undefined,
  };
  const navaid = normalizeElement(element, null, 'osm');
  if (!navaid) return false;
  const path = navaid.path ?? [[navaid.lat, navaid.lon]];
  const bounds = boundsOf([path]);
  if (!bounds) { dropped += 1; return true; }
  addToCells('navaids', {
    id: navaid.id,
    type: navaid.category,
    name: navaid.name ?? navaid.category.replace(/_/g, ' '),
    bounds,
    path,
    navaid,
  });
  return true;
}

function addFeature(feature) {
  inputCount += 1;
  const properties = feature?.properties ?? {};
  const tags = properties.tags && typeof properties.tags === 'object' ? properties.tags : properties;
  const seamark = tags['seamark:type'] ?? tags.seamark_type ?? properties.seamark_type;
  const isFerry = tags.route === 'ferry' || seamark === 'ferry_route';
  const isTss = typeof seamark === 'string' && seamark.startsWith('separation_');
  if (!isFerry && !isTss) {
    addNavaid(feature, properties, tags, seamark);
    return;
  }
  const paths = collectPaths(feature.geometry).map(toPath).filter((path) => path.length > 0);
  const bounds = boundsOf(paths);
  if (!bounds) { dropped += 1; return; }
  const layer = isFerry ? 'ferries' : 'tss';
  const type = isFerry ? 'ferry_route' : seamark;
  const name = String(tags.name ?? tags.ref ?? tags['seamark:name'] ?? `${type} · ${properties.osm_id ?? feature.id ?? 'unnamed'}`);
  const id = String(properties['@id'] ?? properties.osm_id ?? feature.id ?? `${type}:${createHash('sha1').update(JSON.stringify(paths)).digest('hex').slice(0, 16)}`);
  addToCells(layer, { id: `${layer}:${id}`, type, name, bounds, path: paths.flat() });
}

async function* readFeatures(path) {
  const fd = openSync(path, 'r');
  const prefix = Buffer.alloc(256);
  const length = readSync(fd, prefix, 0, prefix.length, 0);
  closeSync(fd);
  const sample = prefix.subarray(0, length).toString('utf8').replace(/^\u001e?\s*/, '');
  if (sample.startsWith('{"type":"FeatureCollection"')) {
    const collection = JSON.parse(readFileSync(path, 'utf8'));
    for (const feature of collection.features ?? []) yield feature;
    return;
  }
  const lines = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of lines) {
    const text = line.trim().replace(/^\u001e/, '');
    if (!text) continue;
    const feature = JSON.parse(text);
    if (feature.type === 'Feature') yield feature;
  }
}

for await (const feature of readFeatures(resolve(inputPath))) addFeature(feature);
for (const layer of ['navaids', 'ferries', 'tss']) for (const [cell, entries] of cells[layer]) {
  if (entries.length > MAX_FEATURES_PER_CELL) throw new Error(`${layer} cell ${cell} has ${entries.length} features; split the grid before publishing`);
}

const generatedAt = new Date().toISOString();
const sourceStat = statSync(resolve(inputPath));
const fingerprint = createHash('sha1').update(`${sourceStat.size}:${sourceStat.mtimeMs}:${inputCount}`).digest('hex').slice(0, 10);
const version = `${generatedAt.slice(0, 19).replace(/[-:T]/g, '')}-${fingerprint}`;
const manifest = { schema: 1, version, generatedAt, cellSize: CELL_SIZE, layers: {} };
const stageDir = `${outDir}.${version}.tmp`;
rmSync(stageDir, { recursive: true, force: true });
for (const layer of ['navaids', 'ferries', 'tss']) {
  const shards = [];
  const layerDir = resolve(stageDir, layer);
  mkdirSync(layerDir, { recursive: true });
  for (const [cell, entries] of [...cells[layer]].sort(([a], [b]) => a.localeCompare(b))) {
    const bounds = cellBounds(cell.split('_').map(Number));
    const path = `${layer}/${cell}.json`;
    writeFileSync(resolve(layerDir, `${cell}.json`), JSON.stringify({ bounds, features: entries }));
    shards.push({ path, bounds, count: entries.length });
  }
  manifest.layers[layer] = { count: featureIds[layer].size, shards };
}
mkdirSync(stageDir, { recursive: true });
writeFileSync(resolve(stageDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
const previousDir = `${outDir}.previous`;
rmSync(previousDir, { recursive: true, force: true });
try { await rename(outDir, previousDir); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
try {
  await rename(stageDir, outDir);
  rmSync(previousDir, { recursive: true, force: true });
} catch (error) {
  try { await rename(previousDir, outDir); } catch {}
  throw error;
}
console.log(`[marine-db] ${inputCount} OSM features → ${manifest.layers.navaids.count} NAVAIDs, ${manifest.layers.ferries.count} ferries, ${manifest.layers.tss.count} TSS; ${manifest.layers.navaids.shards.length + manifest.layers.ferries.shards.length + manifest.layers.tss.shards.length} shards; ${dropped} dropped; ${outDir}`);
