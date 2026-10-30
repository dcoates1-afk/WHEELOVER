#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const base = resolve(root, process.argv[2] ?? 'public/marine-db');
const tssSourceHosts = new Set([
  'openstreetmap.org',
  'www.openstreetmap.org',
  'data.shom.fr',
  'services.data.shom.fr',
  'open.canada.ca',
  'datamap.gov.wales',
  'docs.imo.org',
  'wwwcdn.imo.org',
]);

function isAllowedTssSourceUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && tssSourceHosts.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}
const manifestPath = resolve(base, 'manifest.json');
if (!existsSync(manifestPath)) throw new Error(`Missing ${manifestPath}; build the archive first`);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest.schema !== 1 || !manifest.version || !manifest.layers) throw new Error('Invalid marine manifest');
for (const layer of ['navaids', 'ferries', 'tss']) {
  const info = manifest.layers[layer];
  if (!info || !Array.isArray(info.shards)) throw new Error(`Missing ${layer} shard list`);
  let count = 0;
  const ids = layer === 'tss' ? new Set() : null;
  for (const shard of info.shards) {
    const file = resolve(base, shard.path);
    if (!existsSync(file)) throw new Error(`Missing shard ${shard.path}`);
    const payload = JSON.parse(readFileSync(file, 'utf8'));
    if (payload.features.length !== shard.count) throw new Error(`Count mismatch in ${shard.path}`);
    for (const feature of payload.features) {
      if (!feature.id || !feature.name || feature.path.length < 1) throw new Error(`Invalid feature in ${shard.path}`);
      if (layer === 'navaids' && (!feature.navaid || !Number.isFinite(feature.navaid.lat) || !Number.isFinite(feature.navaid.lon))) throw new Error(`Invalid NAVAID payload in ${shard.path}`);
      if (layer === 'tss') {
        ids.add(feature.id);
        if (feature.sourceUrl && !isAllowedTssSourceUrl(feature.sourceUrl)) throw new Error(`Invalid TSS source link in ${shard.path}: ${feature.sourceUrl}`);
        if (feature.details && Object.values(feature.details).some((value) => typeof value !== 'string')) throw new Error(`Invalid TSS details in ${shard.path}`);
        const linePaths = feature.paths ?? (feature.path.length ? [feature.path] : []);
        const polygonGroups = feature.polygons ?? [];
        const hasLine = linePaths.some((path) => path.length >= 2);
        const hasPolygon = polygonGroups.some((rings) => rings.some((ring) => ring.length >= 4));
        if (!hasLine && !hasPolygon) throw new Error(`TSS feature has no drawable line or polygon in ${shard.path}: ${feature.id}`);
        for (const path of [...linePaths, ...polygonGroups.flat()]) {
          if (!path.every(([lat, lon]) => Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lon) && Math.abs(lon) <= 180)) {
            throw new Error(`Invalid TSS geometry in ${shard.path}: ${feature.id}`);
          }
        }
      }
      if (!feature.path.every(([lat, lon]) => Number.isFinite(lat) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) {
        throw new Error(`Invalid coordinate in ${shard.path}`);
      }
    }
    count += shard.count;
  }
  if (layer === 'tss' && ids.size !== info.count) throw new Error(`TSS unique-ID mismatch: manifest ${info.count}, actual ${ids.size}`);
  console.log(`PASS ${layer}: ${info.count} unique features in ${info.shards.length} shards (${count} shard copies)`);
}
console.log(`PASS manifest ${manifest.version}`);
