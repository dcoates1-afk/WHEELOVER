#!/usr/bin/env node
/**
 * Data integrity checks for the NAVAID database and chart overlays.
 *
 *   node scripts/verify-data.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const checks = [];

function check(name, condition, detail = '') {
  checks.push({ name, ok: Boolean(condition), detail });
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const manifestPath = resolve(root, 'public/navaid-db/manifest.json');
if (!existsSync(manifestPath)) {
  console.error('manifest missing — run npm run db:build');
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const seed = JSON.parse(readFileSync(resolve(root, 'src/data/solentNavaids.json'), 'utf8'));
const lanes = JSON.parse(readFileSync(resolve(root, 'src/data/lanes.json'), 'utf8'));
const registry = JSON.parse(readFileSync(resolve(root, 'src/data/navaidSources.json'), 'utf8'));

check('manifest is schema 2 with a version stamp', manifest.schema === 2 && /^\d{14}-[0-9a-f]{10}$/.test(manifest.version), manifest.version);
check('manifest records unique aids', manifest.stats.uniqueAids > 3000, `${manifest.stats.uniqueAids} aids`);
check('manifest records duplicates removed', manifest.stats.duplicatesRemoved > 0, `${manifest.stats.duplicatesRemoved} merged`);
check('at least two built regions', manifest.regions.length >= 2, manifest.regions.map((r) => r.id).join(', '));
check('source registry has 17 audited sources', registry.sources.length === 17, `${registry.sources.length} sources`);

let totalShardAids = 0;
const categories = new Set();
const wrecksByRegion = new Map();
for (const region of manifest.regions) {
  let sum = 0;
  for (const shard of region.shards) {
    const path = resolve(root, 'public/navaid-db', shard.path);
    if (!existsSync(path)) {
      check(`shard exists: ${shard.path}`, false);
      continue;
    }
    const payload = JSON.parse(readFileSync(path, 'utf8'));
    if (payload.navaids.length !== shard.count) {
      check(`shard count matches file: ${shard.path}`, false, `${payload.navaids.length} vs ${shard.count}`);
    }
    for (const navaid of payload.navaids) {
      categories.add(navaid.category);
      if (navaid.category === 'wreck' || navaid.category === 'hazard_danger') {
        const records = wrecksByRegion.get(region.id) ?? [];
        records.push(navaid);
        wrecksByRegion.set(region.id, records);
      }
      if (
        !Number.isFinite(navaid.lat) ||
        !Number.isFinite(navaid.lon) ||
        navaid.lat < -90 ||
        navaid.lat > 90 ||
        navaid.lon < -180 ||
        navaid.lon > 180
      ) {
        check(`valid position: ${navaid.id}`, false);
      }
    }
    sum += payload.navaids.length;
  }
  totalShardAids += sum;
  check(`region ${region.id} shard totals match its count`, sum === region.count, `${sum}/${region.count}`);
}

check('total shard aids match manifest', totalShardAids === manifest.stats.uniqueAids, `${totalShardAids}`);
const solentEnriched = (wrecksByRegion.get('solent') ?? []).filter((wreck) => wreck.wreckInventoryName);
check(
  'two uniquely matched EMODnet heritage wreck enrichments are present',
  solentEnriched.length === 2 && solentEnriched.every((wreck) => wreck.wreckInventoryMatchDistanceM <= 25 && wreck.wreckInventoryPositionType === 'Polygon centroid'),
  solentEnriched.map((wreck) => `${wreck.wreckInventoryName} (${wreck.wreckInventoryMatchDistanceM} m)`).join(', '),
);
check(
  'heritage data does not override charted wreck danger or position',
  solentEnriched.every((wreck) => wreck.id.startsWith('osm:') && wreck.wreckCategory && wreck.wreckInventoryUrl),
);
const noaaWrecks = (wrecksByRegion.get('ny-harbor') ?? []).filter((wreck) => wreck.source === 'noaa-enc');
check(
  'NOAA ENC Direct GIS wreck is separately namespaced and attributed',
  noaaWrecks.length === 1 && noaaWrecks[0].id.startsWith('noaa-enc:') && noaaWrecks[0].wreckChartSourceUrl && noaaWrecks[0].sourceCitation,
  noaaWrecks.map((wreck) => `${wreck.id} ${wreck.wreckCategory} ${wreck.wreckChartExpectedDepth ?? 'depth unavailable'}`).join(', '),
);
check(
  'lateral, cardinal, light, hazard and range categories are present',
  ['lateral_port', 'lateral_starboard', 'cardinal_north', 'major_light', 'hazard', 'range'].every((category) =>
    categories.has(category),
  ),
  [...categories].sort().join(', '),
);
check(
  'bifurcation / preferred-channel marks exist where OSM maps them',
  categories.has('preferred_channel_port') || categories.has('preferred_channel_starboard'),
);
check('seed extract matches the published version', seed.version === manifest.version, seed.version);
check(
  'seed bounds are [south, west, north, east]',
  seed.bounds[0] < seed.bounds[2] && seed.bounds[1] < seed.bounds[3],
  JSON.stringify(seed.bounds),
);
check('seed aids carry priority for declutter', seed.navaids.every((navaid) => typeof navaid.priority === 'number'));

check('ferry route geometry is present', lanes.ferries.length >= 100, `${lanes.ferries.length} routes`);
check('TSS geometry is present', lanes.tss.length >= 10, `${lanes.tss.length} features`);
check(
  'TSS features are typed',
  lanes.tss.every((feature) => ['separation_lane', 'separation_zone', 'separation_boundary', 'separation_line'].includes(feature.type)),
  [...new Set(lanes.tss.map((f) => f.type))].join(', '),
);
check(
  'TSS coverage reaches the English Channel',
  lanes.tss.filter((feature) => feature.path.some(([, lon]) => lon < -2)).length >= 20,
  `${lanes.tss.filter((feature) => feature.path.some(([, lon]) => lon < -2)).length} features west of 2°W`,
);
check(
  'ferry coverage reaches the Channel crossings',
  lanes.ferries.filter((route) => route.path.some(([, lon]) => lon < -3)).length >= 40,
  `${lanes.ferries.filter((route) => route.path.some(([, lon]) => lon < -3)).length} routes west of 3°W`,
);
check(
  'every lane feature is named for its tooltip',
  [...lanes.ferries, ...lanes.tss].every((feature) => typeof feature.name === 'string' && feature.name.length > 0),
);
check(
  'lane coordinates are valid',
  [...lanes.ferries, ...lanes.tss].every((feature) =>
    feature.path.every(([lat, lon]) => Math.abs(lat) <= 90 && Math.abs(lon) <= 180),
  ),
);

const currentStations = JSON.parse(readFileSync(resolve(root, 'src/data/currentStations.json'), 'utf8'));
check(
  'bundled NOAA current-station index is present',
  Array.isArray(currentStations) && currentStations.length > 2000,
  `${currentStations.length} stations`,
);
check(
  'current stations carry an id, a name and a position',
  currentStations.every(
    ([id, name, lat, lon]) =>
      typeof id === 'string' &&
      id.length > 0 &&
      typeof name === 'string' &&
      name.length > 0 &&
      Number.isFinite(lat) &&
      Number.isFinite(lon) &&
      lat >= 17 &&
      lat <= 72 &&
      lon >= -180 &&
      lon <= 180,
  ),
);
check(
  'current-station ids are unique',
  new Set(currentStations.map(([id]) => id)).size === currentStations.length,
);

const tideStations = JSON.parse(readFileSync(resolve(root, 'src/data/tideStations.json'), 'utf8'));
check(
  'bundled NOAA tide-station index is present',
  Array.isArray(tideStations) && tideStations.length > 3000,
  `${tideStations.length} stations`,
);
check(
  'tide stations carry an id, a name and a position',
  tideStations.every(
    ([id, name, lat, lon]) =>
      typeof id === 'string' &&
      id.length > 0 &&
      typeof name === 'string' &&
      name.length > 0 &&
      Number.isFinite(lat) &&
      Number.isFinite(lon) &&
      Math.abs(lat) <= 90 &&
      Math.abs(lon) <= 180,
  ),
);
check(
  'tide-station ids are unique',
  new Set(tideStations.map(([id]) => id)).size === tideStations.length,
);

const failed = checks.filter((entry) => !entry.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} data checks passed`);
if (failed.length) process.exitCode = 1;
