#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const base = resolve(root, process.argv[2] ?? 'public/marine-db');
const manifestPath = resolve(base, 'manifest.json');
if (!existsSync(manifestPath)) throw new Error(`Missing ${manifestPath}; build the archive first`);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest.schema !== 1 || !manifest.version || !manifest.layers) throw new Error('Invalid marine manifest');
for (const layer of ['navaids', 'ferries', 'tss']) {
  const info = manifest.layers[layer];
  if (!info || !Array.isArray(info.shards)) throw new Error(`Missing ${layer} shard list`);
  let count = 0;
  for (const shard of info.shards) {
    const file = resolve(base, shard.path);
    if (!existsSync(file)) throw new Error(`Missing shard ${shard.path}`);
    const payload = JSON.parse(readFileSync(file, 'utf8'));
    if (payload.features.length !== shard.count) throw new Error(`Count mismatch in ${shard.path}`);
    for (const feature of payload.features) {
      if (!feature.id || !feature.name || feature.path.length < 1) throw new Error(`Invalid feature in ${shard.path}`);
      if (layer === 'navaids' && (!feature.navaid || !Number.isFinite(feature.navaid.lat) || !Number.isFinite(feature.navaid.lon))) throw new Error(`Invalid NAVAID payload in ${shard.path}`);
      if (layer === 'tss' && feature.sourceUrl && !/^https:\/\/www\.openstreetmap\.org\/(node|way|relation)\/\d+$/.test(feature.sourceUrl)) throw new Error(`Invalid TSS source link in ${shard.path}`);
      if (layer === 'tss' && feature.details && Object.values(feature.details).some((value) => typeof value !== 'string')) throw new Error(`Invalid TSS details in ${shard.path}`);
      if (!feature.path.every(([lat, lon]) => Number.isFinite(lat) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) {
        throw new Error(`Invalid coordinate in ${shard.path}`);
      }
    }
    count += shard.count;
  }
  console.log(`PASS ${layer}: ${info.count} unique features in ${info.shards.length} shards (${count} shard copies)`);
}
console.log(`PASS manifest ${manifest.version}`);
