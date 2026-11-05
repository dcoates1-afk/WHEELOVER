#!/usr/bin/env node
/**
 * Build the NOAA ENC aids-to-navigation dataset from NOAA ENC Direct to GIS.
 *
 *   node scripts/build-noaa-enc-marks.mjs [--bands enc_harbour,enc_approach] [--layers Light,Buoy_Lateral]
 *
 * The fetch is always live (no snapshots): ENC Direct is the source, and the
 * same aid appears in several bands at different scales, so every band is
 * fetched and cross-band duplicates are collapsed at build time. Progress is
 * saved per layer under ~/workspace/noaa-enc-partial, so a rerun after a
 * flaky failure only fetches the rest (the service returns intermittent 500s
 * and occasionally empty pages; both are retried).
 *
 * Output: public/noaa-enc-marks/manifest.json (schema 2, one region, 0.25 deg
 * cells) + one <cell>.json shard per non-empty cell, each holding Navaid
 * records. The client fetches only the shards intersecting the viewport
 * (src/lib/noaaEnc.ts), the same pattern as the built Solent/NY Harbor
 * database (src/lib/navaidDb.ts). A layer that still fails after retries is
 * recorded in the manifest stats instead of aborting the whole build.
 *
 * What is fetched (see scripts/noaa-enc-mapping.mjs for the mapping):
 * - Standalone marks: Light (sectors grouped by position), Light_Float,
 *   Buoy/Beacon Lateral, Cardinal, Isolated Danger, Safe Water, Special
 *   Purpose, Landmark (lighthouses by FUNCTN 33 or name), Offshore_Platform,
 *   Pile. Pylon_Bridge_Support is skipped (bridge piers, not power pylons).
 * - Attach-only signals, joined to the nearest mark within 25 m and never
 *   plotted alone: Fog_Signal, Radar_Transponder_Beacon, Daymark.
 * - Skipped as standalone layers: Radio_Station (aeronautical), Retro_Reflector,
 *   Topmark (duplicates the parent's topmark).
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cellBounds, cellKey, dedupeNavaids, DEFAULT_CELL_SIZE } from '../shared/navaid-core.mjs';
import {
  ATON_LAYERS, ATTACH_ONLY_LAYERS, BAND_ORDER, groupLightFeatures,
  joinLightFloats, joinSignals, mapFeature,
} from './noaa-enc-mapping.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(root, '..');
const OUT_DIR = join(repoRoot, 'public', 'noaa-enc-marks');
// Progress lives beside the repo, not in the OS temp dir: the runtime
// clears /tmp, which wiped a running build's resume files mid-flight.
const PARTIAL_DIR = join(repoRoot, '..', 'noaa-enc-partial');
const SUMMARY_PATH = join(repoRoot, '..', 'noaa-enc-build-summary.json');

const args = new Map();
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (!arg.startsWith('--')) continue;
  const [key, eqValue] = arg.slice(2).split('=');
  if (eqValue !== undefined) {
    args.set(key, eqValue);
  } else if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
    args.set(key, argv[i + 1]);
    i += 1;
  } else {
    args.set(key, 'true');
  }
}
const bandFilter = args.get('bands') ? new Set(args.get('bands').split(',')) : null;
const layerFilter = args.get('layers') ? new Set(args.get('layers').split(',')) : null;
const BANDS = BAND_ORDER.filter((band) => !bandFilter || bandFilter.has(band));
const LAYERS = ATON_LAYERS.filter((layer) => !layerFilter || layerFilter.has(layer));

/** NOAA ENC Direct is flaky (intermittent 500s), so retry generously. */
async function fetchJson(url, tries = 10) {
  let delay = 1000;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(60000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (data.error) throw new Error(`ArcGIS: ${data.error.message ?? JSON.stringify(data.error)}`);
      return data;
    } catch (error) {
      if (attempt === tries) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, 30000);
    }
  }
  throw new Error('unreachable');
}

/**
 * Position of an ArcGIS feature: point geometry is {x, y}; multipoint is
 * {points: [[x, y]]}; lines/polygons fall back to their centroid. Full
 * precision is kept (no rounding): sector grouping keys on exact positions.
 */
function pointOf(geometry) {
  if (!geometry) return null;
  if (typeof geometry.x === 'number' && typeof geometry.y === 'number') {
    return { lo: geometry.x, la: geometry.y };
  }
  if (Array.isArray(geometry.points) && geometry.points.length > 0) {
    const [x, y] = geometry.points[0];
    return { lo: x, la: y };
  }
  const rings = geometry.paths ?? geometry.rings ?? [];
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      sx += x;
      sy += y;
      n++;
    }
  }
  if (n === 0) return null;
  return { lo: sx / n, la: sy / n };
}

/**
 * Page an ArcGIS layer by its row-id field (resumable: already-fetched ids are
 * kept in a partial file, so a rerun after a flaky failure only fetches the
 * rest). Returns { records, complete }. An empty page is retried twice before
 * it ends the layer: the service occasionally returns zero features for a
 * page that has more (observed during discovery).
 */
async function queryArcGisPaged(name, base, idField, mapRecord) {
  mkdirSync(PARTIAL_DIR, { recursive: true });
  const partialPath = join(PARTIAL_DIR, `${name}.jsonl`);
  const records = [];
  let lastId = 0;
  if (existsSync(partialPath)) {
    const seenIds = new Set();
    for (const line of readFileSync(partialPath, 'utf8').split('\n')) {
      if (line.trim() === '') continue;
      const entry = JSON.parse(line);
      if (seenIds.has(entry.id)) continue;
      seenIds.add(entry.id);
      records.push(entry.record);
      lastId = Math.max(lastId, entry.id);
    }
    console.info(`${name}: resuming from ${idField} ${lastId} (${records.length} already fetched)`);
  }
  const pageSize = 1000;
  try {
    for (;;) {
      const params = new URLSearchParams({
        where: `(${idField} > ${lastId})`,
        outFields: '*',
        returnGeometry: 'true',
        orderByFields: `${idField} ASC`,
        resultRecordCount: String(pageSize),
        f: 'json',
      });
      let data = null;
      let emptyTries = 0;
      for (;;) {
        data = await fetchJson(`${base}/query?${params}`);
        const features = data.features ?? [];
        if (features.length > 0) break;
        emptyTries += 1;
        if (emptyTries > 2) break;
        console.warn(`${name}: empty page, retrying (${emptyTries}/2)`);
      }
      const features = data.features ?? [];
      const prevLastId = lastId;
      for (const feature of features) {
        const point = pointOf(feature.geometry);
        if (!point) continue;
        const record = mapRecord(point, feature.attributes ?? {});
        if (!record) continue;
        records.push(record);
        const id = Number(feature.attributes?.[idField]) || 0;
        if (id > 0) {
          lastId = Math.max(lastId, id);
          writeFileSync(partialPath, `${JSON.stringify({ id, record })}\n`, { flag: 'a' });
        }
      }
      // Only a repeatedly-empty page ends the layer. The service cuts pages
      // short at its transfer limit (~211 features) without flagging it, so
      // breaking on a short page silently drops the tail.
      if (features.length === 0) break;
      if (lastId === prevLastId) break;
    }
    return { records, complete: true };
  } catch (error) {
    console.warn(`${name}: FAILED after retries (${error.message}); keeping ${records.length} fetched records`);
    return { records, complete: false };
  }
}

async function fetchLayerList(band) {
  const base = `https://encdirect.noaa.gov/arcgis/rest/services/encdirect/${band}/MapServer`;
  const info = await fetchJson(`${base}?f=json`);
  const layers = [];
  for (const layer of info.layers ?? []) {
    if (typeof layer.id !== 'number' || typeof layer.name !== 'string') continue;
    // Only point layers are marks. Landmark and Offshore_Platform also exist
    // as area layers, and a polygon centroid is not an aid position — the
    // harbour Platform area layer once contributed 66 such records before
    // this filter. The geometry type is the check; the name suffix is the
    // fallback for layers that do not carry one.
    const isPoint = layer.geometryType === 'esriGeometryPoint' || layer.name.endsWith('_point');
    if (!isPoint) continue;
    // Live names carry a band prefix and a geometry suffix, e.g.
    // "Harbor.Beacon_Lateral_point" — the ATON name is the middle part.
    const bare = layer.name.split('.').pop().replace(/_(point|line|area)$/, '');
    layers.push({ id: layer.id, name: bare, fullName: layer.name });
  }
  return { base, layers };
}

/**
 * Drop unset fields from a record before it is written to a shard: null,
 * undefined, false and empty arrays carry no information (the app reads
 * every one of these with ?? / optional chaining), and at ~130k records the
 * repeated `"key":null` pairs are most of the dataset's weight. Numbers
 * (including 0) and empty strings are kept.
 */
function compactRecord(record) {
  const out = {};
  for (const [key, value] of Object.entries(record)) {
    if (value === null || value === undefined || value === false) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out;
}

function stamp(iso) {
  return iso.slice(0, 19).replace(/[:T]/g, '').replace(/-/g, '');
}

async function main() {
  const startedAt = new Date().toISOString();
  const stats = {
    startedAt, rawFeatures: 0, mappedRecords: 0, droppedNonMark: 0,
    lightsGrouped: 0, floatsJoined: 0, uniqueAids: 0, duplicatesRemoved: 0,
    incompleteLayers: [], perLayer: {},
  };
  const allMarks = [];
  const lightRecords = [];
  const floatRecords = [];
  const fogSignals = [];
  const racons = [];
  const daymarks = [];

  for (const band of BANDS) {
    let layerList;
    try {
      layerList = await fetchLayerList(band);
    } catch (error) {
      console.warn(`${band}: layer list FAILED (${error.message}); skipping band`);
      stats.incompleteLayers.push(`${band} (layer list)`);
      continue;
    }
    const wanted = layerList.layers.filter((layer) => LAYERS.includes(layer.name));
    console.info(`${band}: ${wanted.length} ATON layers (${wanted.map((l) => `${l.name}/${l.id}`).join(', ')})`);
    for (const layer of wanted) {
      const base = `${layerList.base}/${layer.id}`;
      let layerFields = null;
      try {
        const info = await fetchJson(`${base}?f=json`, 3);
        layerFields = new Set((info.fields ?? []).map((field) => field.name));
      } catch {
        // Fall through with OBJECTID; the query then fails and the layer is recorded incomplete.
      }
      const idField = layerFields === null
        ? 'OBJECTID'
        : layerFields.has('OBJECTID')
          ? 'OBJECTID'
          : [...layerFields].find((field) => field.endsWith('.FID')) ?? null;
      if (idField === null) {
        console.warn(`${band}/${layer.name}: no row-id field; skipping`);
        stats.incompleteLayers.push(`${band}/${layer.name}`);
        continue;
      }
      const name = `noaa-enc-${band}-${layer.name}`;
      const { records, complete } = await queryArcGisPaged(
        name, base, idField,
        (point, attrs) => {
          stats.rawFeatures += 1;
          if (ATTACH_ONLY_LAYERS.has(layer.name)) {
            return { lat: point.la, lon: point.lo, attrs };
          }
          const record = mapFeature({
            layer: layer.name, band, objectId: Number(attrs[idField]) || 0,
            lat: point.la, lon: point.lo, attrs,
          });
          if (!record) {
            stats.droppedNonMark += 1;
            return null;
          }
          return record;
        },
      );
      stats.perLayer[`${band}/${layer.name}`] = { fetched: records.length, complete };
      console.info(`${band}/${layer.name}: ${records.length} records${complete ? '' : ' (INCOMPLETE)'}`);
      if (!complete) stats.incompleteLayers.push(`${band}/${layer.name}`);
      if (layer.name === 'Light') lightRecords.push(...records);
      else if (layer.name === 'Light_Float') floatRecords.push(...records);
      else if (layer.name === 'Fog_Signal') fogSignals.push(...records);
      else if (layer.name === 'Radar_Transponder_Beacon') racons.push(...records);
      else if (layer.name === 'Daymark') daymarks.push(...records);
      else allMarks.push(...records);
    }
  }

  // One LIGHTS feature per sector: group by exact position into one light.
  const groupedLights = groupLightFeatures(lightRecords);
  stats.lightsGrouped = lightRecords.length - groupedLights.length;
  const joinedFloats = joinLightFloats(floatRecords, groupedLights);
  stats.floatsJoined = joinedFloats.filter((f) => f.lit).length;
  allMarks.push(...groupedLights, ...joinedFloats);
  stats.mappedRecords = allMarks.length;

  // Cross-band duplicates collapse here (same aid in several bands at the
  // same position). The app's own merge/dedupe runs again at runtime against
  // OSM/CCG/USCG; this pass only removes ENC's internal duplicates.
  const { navaids, removed } = dedupeNavaids(allMarks);
  stats.duplicatesRemoved = removed;
  stats.uniqueAids = navaids.length;

  // Fog, racon and daymark signals attach to the nearest mark within 25 m.
  const { attached, orphaned } = joinSignals(navaids, fogSignals, racons, daymarks);
  stats.signalsAttached = attached;
  stats.signalsOrphaned = orphaned;
  console.info(`signals: attached ${JSON.stringify(attached)}; orphaned ${JSON.stringify(orphaned)}`);

  // Shard by 0.25 deg cells, one region for US waters (bounds span the
  // dateline so Aleutian cells at +179 are inside the region; shards filter
  // by their own bounds, so a view elsewhere fetches nothing).
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  const byCell = new Map();
  for (const mark of navaids) {
    const key = cellKey(mark.lat, mark.lon, DEFAULT_CELL_SIZE);
    const cell = byCell.get(key) ?? [];
    cell.push(compactRecord(mark));
    byCell.set(key, cell);
  }
  const shards = [];
  let total = 0;
  for (const [key, marks] of [...byCell.entries()].sort()) {
    const path = `${key.replace(':', '_')}.json`;
    const bounds = cellBounds(key, DEFAULT_CELL_SIZE);
    writeFileSync(join(OUT_DIR, path), JSON.stringify({ navaids: marks }));
    shards.push({ path, bounds, count: marks.length });
    total += marks.length;
  }
  const generatedAt = new Date().toISOString();
  const version = `${stamp(generatedAt)}-${createHash('sha1').update(JSON.stringify([total, stats.duplicatesRemoved, stats.incompleteLayers])).digest('hex').slice(0, 8)}`;
  const manifest = {
    schema: 2,
    version,
    generatedAt,
    cellSize: DEFAULT_CELL_SIZE,
    regions: [{
      id: 'noaa-enc-us',
      name: 'NOAA ENC (US waters)',
      bounds: [13, -180, 72, 180],
      count: total,
      shards,
      sources: ['noaa-enc'],
    }],
    sources: [{ id: 'noaa-enc', name: 'NOAA ENC Direct to GIS' }],
    stats: {
      rawRecords: stats.rawFeatures,
      uniqueAids: total,
      duplicatesRemoved: stats.duplicatesRemoved,
      incompleteLayers: stats.incompleteLayers,
    },
  };
  writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  writeFileSync(SUMMARY_PATH, JSON.stringify({ ...stats, version, shards: shards.length, total }, null, 2));
  console.info(`wrote ${total} aids across ${shards.length} shards; version ${version}`);
  if (stats.incompleteLayers.length > 0) {
    console.warn(`INCOMPLETE layers (${stats.incompleteLayers.length}): ${stats.incompleteLayers.join(', ')}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
