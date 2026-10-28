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
  distanceMeters,
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
  'https://overpass-api.de/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

function query(bounds) {
  // Registry bounds are [south, west, north, east]; Overpass expects
  // south,west,north,east.
  const [s, w, n, e] = bounds;
  const box = `${s},${w},${n},${e}`;
  // Include charted seamarks and nearby wrecks; OSM data is community mapped.
  return `[out:json][timeout:120];(node["seamark:type"](${box});way["seamark:type"](${box})["seamark:type"!="calling-in_point"];node["man_made"="lighthouse"](${box});node["seamark:light:character"](${box});node["historic"="wreck"](${box});way["historic"="wreck"](${box});node["man_made"="wreck"](${box});way["man_made"="wreck"](${box}););out center tags;way["seamark:type"="calling-in_point"](${box});out geom;`;
}

async function fetchRegion(region) {
  const body = new URLSearchParams({ data: query(region.bounds) });
  let lastError = null;
  for (const mirror of MIRRORS) {
    try {
      const response = await fetch(mirror, {
        method: 'POST',
        headers: { 'User-Agent': 'wheel-over-navaid-build/1.0', 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(260_000),
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
      if (payload.elements.some((element) => element.type === 'count')) {
        lastError = new Error(`${mirror} -> count response contained no feature data`);
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

function enrichEmodnetHeritage(navaids, features) {
  const claimed = new Set();
  let matched = 0;
  for (const feature of features) {
    const properties = feature.properties ?? {};
    const coordinates = feature.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) continue;
    const [lon, lat] = coordinates;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    // These are heritage-area centroids, not navigation fixes. Enrich only a
    // single existing charted wreck within 25 m; never add the centroid itself.
    const inventoryName = properties.name && properties.name !== 'n/a' ? String(properties.name) : null;
    const normalizeName = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const candidates = navaids
      .map((navaid) => ({ navaid, metres: distanceMeters(lat, lon, navaid.lat, navaid.lon) }))
      .filter(({ navaid, metres }) =>
        (navaid.category === 'wreck' || navaid.category === 'hazard_danger') &&
        metres <= 25 && !claimed.has(navaid.id) &&
        (!navaid.name || !inventoryName || normalizeName(navaid.name) === normalizeName(inventoryName)))
      .sort((a, b) => a.metres - b.metres);
    if (candidates.length === 0) continue;
    const [nearest, next] = candidates;
    if (next && next.metres - nearest.metres < 5) continue;

    const { navaid, metres } = nearest;
    claimed.add(navaid.id);
    navaid.wreckInventoryName = inventoryName;
    navaid.name ??= inventoryName;
    navaid.wreckInventoryDepth = properties.depth_info && properties.depth_info !== 'n/a' ? String(properties.depth_info) : null;
    navaid.wreckHistoricalContext = properties.sink_context && properties.sink_context !== 'n/a' ? String(properties.sink_context) : null;
    navaid.wreckSiteDescription = properties.obj_desc && properties.obj_desc !== 'n/a' ? String(properties.obj_desc) : null;
    navaid.wreckType ??= properties.ship_char && properties.ship_char !== 'n/a' ? String(properties.ship_char) : null;
    navaid.wreckTypeDescription = properties.obj_type && properties.obj_type !== 'n/a' ? String(properties.obj_type) : null;
    navaid.wreckInventorySource = 'EMODnet Human Activities heritage wrecks (CC BY 4.0); originator AND-International; source provider Historic England. Enriched to the nearby mapped mark.';
    navaid.wreckInventoryUrl = 'https://emodnet.ec.europa.eu/geonetwork/srv/api/records/e965088b-a265-4517-84df-c49b156af8a7';
    navaid.wreckInventoryPositionType = properties.point_info && properties.point_info !== 'n/a' ? String(properties.point_info) : null;
    navaid.wreckInventoryLegalStatus = properties.statutory && properties.statutory !== 'n/a' ? String(properties.statutory) : null;
    navaid.wreckInventoryUpdated = properties.yr_updated && properties.yr_updated !== 'n/a' ? String(properties.yr_updated) : null;
    navaid.wreckInventoryMatchDistanceM = Math.round(metres);
    if (!navaid.wreckDateSunk && properties.sink_yr && properties.sink_yr !== 'n/a') navaid.wreckDateSunk = String(properties.sink_yr);
    matched += 1;
  }
  return matched;
}

function makeNoaaWreck(feature, regionId, snapshotUrl) {
  const properties = feature.properties ?? {};
  const [lon, lat] = feature.geometry?.coordinates ?? [];
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const category = String(properties.CATWRK ?? '').toLowerCase();
  const wreckCategory = category.includes('non-dangerous')
    ? 'non-dangerous'
    : category.includes('dangerous') ? 'dangerous' : '';
  const tags = {
    'seamark:type': 'wreck',
    'seamark:wreck:category': wreckCategory,
  };
  const mark = normalizeElement({
    type: 'node',
    id: properties.OBJECTID ?? feature.id,
    lat,
    lon,
    tags: {
      ...tags,
      ...(properties.OBJNAM ? { name: String(properties.OBJNAM) } : {}),
    },
  }, regionId, 'noaa-enc');
  if (!mark) return null;
  mark.wreckCategory = wreckCategory || category || null;
  mark.wreckChartSource = 'NOAA ENC Direct to GIS (CC0; converted GIS feature, not certified for navigation)';
  mark.wreckChartSourceUrl = 'https://nauticalcharts.noaa.gov/learn/encdirect/';
  mark.wreckChartSurveyDate = properties.SORDAT ? String(properties.SORDAT) : null;
  mark.wreckChartQuality = properties.QUASOU == null ? null : String(properties.QUASOU);
  mark.wreckChartExpectedDepth = properties.VALSOU == null ? null : String(properties.VALSOU);
  mark.wreckChartVerticalDatum = properties.VERDAT == null ? null : String(properties.VERDAT);
  mark.wreckChartExposed = properties.EXPSOU == null ? null : String(properties.EXPSOU);
  mark.sourceCitation = `NOAA ENC Direct to GIS; dataset ${properties.DSNM ?? 'unknown'}; source indication ${properties.SORIND ?? 'not supplied'}`;
  mark.sourceUrl = properties.OBJECTID
    ? `https://encdirect.noaa.gov/arcgis/rest/services/encdirect/enc_coastal/MapServer/33/query?objectIds=${encodeURIComponent(properties.OBJECTID)}&outFields=*&returnGeometry=true&f=pjson`
    : snapshotUrl;
  return mark;
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
    let navaids = normalized;
    let supplementalCount = 0;
    if (region.id === 'solent') {
      const heritageSnapshot = JSON.parse(readFileSync(resolve(root, 'data-raw/emodnet-solent-heritage-wrecks.geojson'), 'utf8'));
      const matched = enrichEmodnetHeritage(navaids, heritageSnapshot.features ?? []);
      if (matched !== 2) throw new Error(`expected 2 high-confidence EMODnet heritage matches for Solent, found ${matched}`);
      console.log(`[db] ${region.id}: ${matched} high-confidence EMODnet heritage records matched to charted wreck marks`);
    }
    if (region.id === 'ny-harbor') {
      const noaaPath = 'data-raw/noaa-ny-harbor-wrecks.geojson';
      const noaaSnapshot = JSON.parse(readFileSync(resolve(root, noaaPath), 'utf8'));
      const additions = (noaaSnapshot.features ?? []).map((feature) => makeNoaaWreck(feature, region.id, noaaSnapshot.sourceUrl)).filter(Boolean);
      if (additions.length !== (noaaSnapshot.features ?? []).length) throw new Error(`failed to normalize a NOAA wreck feature in ${region.id}`);
      navaids = [...navaids, ...additions];
      supplementalCount += additions.length;
      console.log(`[db] ${region.id}: added ${additions.length} distinct NOAA ENC Direct wreck features`);
    }
    const { navaids: uniqueNavaids, removed } = dedupeNavaids(navaids);
    navaids = uniqueNavaids;
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

    totalRaw += (snapshot.elements ?? []).length + supplementalCount;
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
