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
import { resolve } from 'node:path';
import { normalizeElement } from '../shared/navaid-core.mjs';

const args = process.argv.slice(2);
const inputPath = args.find((arg) => !arg.startsWith('--'));
const outArg = args.indexOf('--out');
const outDir = resolve(outArg >= 0 ? args[outArg + 1] : 'public/marine-db');
const CELL_SIZE = 5;
const MAX_FEATURES_PER_CELL = 400;
const MIN_DENSE_CELL_SIZE = 0.05;
if (!inputPath) {
  console.error('Usage: node scripts/build-marine-db.mjs <extract.geojson|extract.geojsonseq> [--out directory]');
  process.exit(2);
}

function parseJsonWithCaseSensitiveKeys(text) {
  const reviver = (key, value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const result = Object.create(null);
    for (const [property, item] of Object.entries(value)) result[property] = item;
    return result;
  };
  return JSON.parse(text, reviver);
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

function cellsFor([south, west, north, east], cellSize) {
  const minY = Math.floor((south + 90) / cellSize), maxY = Math.floor((north + 90) / cellSize);
  const minX = Math.floor((west + 180) / cellSize), maxX = Math.floor((east + 180) / cellSize);
  const cells = [];
  for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) cells.push([y, x]);
  return cells;
}

const cellBounds = ([y, x], cellSize) => [y * cellSize - 90, x * cellSize - 180, (y + 1) * cellSize - 90, (x + 1) * cellSize - 180];
const cellId = ([y, x]) => `${y}_${x}`;

const intersectsBounds = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

function writeShardTree(layer, layerDir, shardBounds, entries, shards, depth = 0, y = 0, x = 0) {
  const size = (shardBounds[2] - shardBounds[0]);
  if (entries.length > MAX_FEATURES_PER_CELL && size > MIN_DENSE_CELL_SIZE) {
    const halfSize = size / 2;
    const [south, west] = shardBounds;
    const quadrants = [
      { y: 0, x: 0, bounds: [south, west, south + halfSize, west + halfSize] },
      { y: 0, x: 1, bounds: [south, west + halfSize, south + halfSize, west + size] },
      { y: 1, x: 0, bounds: [south + halfSize, west, south + size, west + halfSize] },
      { y: 1, x: 1, bounds: [south + halfSize, west + halfSize, south + size, west + size] },
    ];
    for (const quadrant of quadrants) {
      const bucket = entries.filter((entry) => intersectsBounds(entry.bounds, quadrant.bounds));
      if (bucket.length === 0) continue;
      writeShardTree(layer, layerDir, quadrant.bounds, bucket, shards, depth + 1, y * 2 + quadrant.y, x * 2 + quadrant.x);
    }
    return;
  }
  const suffix = depth === 0 ? `${y}_${x}` : `dense_${depth}_${y}_${x}`;
  const path = `${layer}/${suffix}.json`;
  writeFileSync(resolve(layerDir, `${suffix}.json`), JSON.stringify({ bounds: shardBounds, features: entries }));
  shards.push({ path, bounds: shardBounds, count: entries.length });
}
const cells = { navaids: new Map(), ferries: new Map(), tss: new Map() };
const featureIds = { navaids: new Set(), ferries: new Set(), tss: new Set() };
let inputCount = 0;
let dropped = 0;

function addToCells(layer, item) {
  featureIds[layer].add(item.id);
  for (const cell of cellsFor(item.bounds, CELL_SIZE)) {
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
  const isReportingGeometry =
    seamark === 'calling_in_point' || seamark === 'calling-in_point' || seamark === 'communication_area';
  const geometryPaths = isReportingGeometry
    ? feature.geometry?.type === 'Polygon'
      ? feature.geometry.coordinates
      : feature.geometry?.type === 'MultiPolygon'
        ? feature.geometry.coordinates.flat()
        : feature.geometry?.type === 'GeometryCollection'
          ? feature.geometry.geometries.flatMap((geometry) =>
              geometry.type === 'Polygon'
                ? geometry.coordinates
                : geometry.type === 'MultiPolygon'
                  ? geometry.coordinates.flat()
                  : [],
            )
          : undefined
    : undefined;
  const element = {
    type,
    id: match ? Number(match[2]) : undefined,
    tags: tagsForCore,
    lat: feature.geometry?.type === 'Point' ? feature.geometry.coordinates[1] : undefined,
    lon: feature.geometry?.type === 'Point' ? feature.geometry.coordinates[0] : undefined,
    center: feature.geometry?.type === 'Point' ? undefined : { lat: center[0], lon: center[1] },
    geometryPaths: geometryPaths?.map((part) => part.map(([lon, lat]) => ({ lat, lon }))),
    geometry: isReportingGeometry && feature.geometry?.type === 'LineString'
      ? feature.geometry.coordinates.map(([lon, lat]) => ({ lat, lon }))
      : undefined,
  };
  const navaid = normalizeElement(element, null, 'osm');
  if (!navaid) return false;
  const paths = navaid.paths ?? (navaid.path ? [navaid.path] : [[[navaid.lat, navaid.lon]]]);
  const path = paths.flat();
  const bounds = boundsOf(paths);
  if (!bounds) { dropped += 1; return true; }
  addToCells('navaids', {
    id: navaid.id,
    type: navaid.category,
    name: navaid.name ?? navaid.category.replace(/_/g, ' '),
    bounds,
    path,
    paths,
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
  const readableType = type.replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
  const sourceIdentity = String(properties['@id'] ?? feature.id ?? '');
  const sourceIdentityMatch = sourceIdentity.match(/^([nwr])(\d+)$/);
  const name = String(tags.name ?? tags.ref ?? tags['seamark:name'] ?? readableType);
  const id = String(properties['@id'] ?? properties.osm_id ?? feature.id ?? `${type}:${createHash('sha1').update(JSON.stringify(paths)).digest('hex').slice(0, 16)}`);
  const details = {};
  for (const key of [
    'operator',
    'ref',
    'seamark:separation_scheme:category',
    'seamark:separation_scheme:traffic_flow',
    'seamark:separation_scheme:lane_count',
    'seamark:separation_scheme:lane_width',
    'seamark:separation_scheme:orientation',
    'seamark:separation_scheme:category_of_separation',
    'seamark:separation_boundary:category',
    'seamark:separation_lane:traffic_flow',
    'seamark:separation_lane:category',
    'seamark:separation_zone:category',
    'seamark:information',
    'source',
  ]) {
    const value = tags[key];
    if (typeof value === 'string' && value.trim()) details[key] = value.trim();
  }
  addToCells(layer, {
    id: `${layer}:${id}`,
    type,
    name,
    bounds,
    path: paths.flat(),
    ...(Object.keys(details).length ? { details } : {}),
    ...(sourceIdentityMatch ? {
      sourceUrl: `https://www.openstreetmap.org/${sourceIdentityMatch[1] === 'r' ? 'relation' : sourceIdentityMatch[1] === 'w' ? 'way' : 'node'}/${sourceIdentityMatch[2]}`,
    } : {}),
  });
}

async function* readUtf8Lines(path) {
  let pieces = [];
  for await (const chunk of createReadStream(path)) {
    let start = 0;
    while (true) {
      const end = chunk.indexOf(0x0a, start);
      if (end < 0) break;
      pieces.push(chunk.subarray(start, end));
      yield Buffer.concat(pieces).toString('utf8');
      pieces = [];
      start = end + 1;
    }
    if (start < chunk.length) pieces.push(chunk.subarray(start));
  }
  if (pieces.length) yield Buffer.concat(pieces).toString('utf8');
}

async function* readFeatures(path) {
  const fd = openSync(path, 'r');
  const prefix = Buffer.alloc(256);
  const length = readSync(fd, prefix, 0, prefix.length, 0);
  closeSync(fd);
  const sample = prefix.subarray(0, length).toString('utf8').replace(/^\u001e?\s*/, '');
  if (sample.startsWith('{"type":"FeatureCollection"')) {
    const collection = parseJsonWithCaseSensitiveKeys(readFileSync(path, 'utf8'));
    for (const feature of collection.features ?? []) yield feature;
    return;
  }
  let lineNumber = 0;
  for await (const line of readUtf8Lines(path)) {
    lineNumber += 1;
    const text = line.trim().replace(/^\u001e/, '');
    if (!text) continue;
    let feature;
    try {
      feature = parseJsonWithCaseSensitiveKeys(text);
    } catch (error) {
      throw new Error(`Invalid GeoJSON Text Sequence record at line ${lineNumber}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    if (feature.type === 'Feature') yield feature;
  }
}

for await (const feature of readFeatures(resolve(inputPath))) addFeature(feature);
const cellSize = CELL_SIZE;
const denseCellCounts = { navaids: 0, ferries: 0, tss: 0 };
for (const layer of ['navaids', 'ferries', 'tss']) {
  denseCellCounts[layer] = [...cells[layer].values()].filter((entries) => entries.length > MAX_FEATURES_PER_CELL).length;
}

console.log(`[marine-db] writing viewport shards with ${cellSize}° base cells`);
const generatedAt = new Date().toISOString();
const sourceStat = statSync(resolve(inputPath));
const fingerprint = createHash('sha1').update(`${sourceStat.size}:${sourceStat.mtimeMs}:${inputCount}`).digest('hex').slice(0, 10);
const version = `${generatedAt.slice(0, 19).replace(/[-:T]/g, '')}-${fingerprint}`;
const manifest = { schema: 1, version, generatedAt, cellSize, layers: {} };
const stageDir = `${outDir}.${version}.tmp`;
rmSync(stageDir, { recursive: true, force: true });
for (const layer of ['navaids', 'ferries', 'tss']) {
  const shards = [];
  const layerDir = resolve(stageDir, layer);
  mkdirSync(layerDir, { recursive: true });
  for (const [cell, entries] of [...cells[layer]].sort(([a], [b]) => a.localeCompare(b))) {
    const bounds = cellBounds(cell.split('_').map(Number), cellSize);
    const [y, x] = cell.split('_').map(Number);
    writeShardTree(layer, layerDir, bounds, entries, shards, 0, y, x);
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
