#!/usr/bin/env node
/**
 * Mark-signal audit.
 *
 * The chart draws a bell, horn or racon only when a mark carries the detail, and
 * the archive snapshot carries none at all. This checks that the signal index
 * itself is sound — every cell present, every entry holding a real signal, the
 * manifest count matching the shards — and reports how much of it lands on an
 * archive mark, so the whole-world part that never attaches is visible.
 *
 * Usage:
 *   node scripts/verify-mark-signals.mjs
 *   node scripts/verify-mark-signals.mjs --out artifacts/mark-signal-audit.json
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const signalsDir = join(root, 'public', 'marine-db', 'signals');
const archiveDir = join(root, 'public', 'marine-db', 'navaids');
const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const outPath = outIndex >= 0 ? resolve(root, args[outIndex + 1]) : null;

const manifestPath = join(signalsDir, 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error('No signal manifest; run `npm run signals:build` first.');
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const problems = [];
if (manifest.schema !== 1) problems.push({ issue: 'schema', value: manifest.schema });
if (!Array.isArray(manifest.cells) || manifest.cells.length === 0) problems.push({ issue: 'no-cells' });

const entries = new Map();
let fog = 0;
let racon = 0;
let shardTotal = 0;
for (const cell of manifest.cells ?? []) {
  const file = join(root, 'public', 'marine-db', cell.path);
  if (!existsSync(file)) {
    problems.push({ issue: 'missing-shard', cell: cell.path });
    continue;
  }
  const payload = JSON.parse(readFileSync(file, 'utf8'));
  const marks = payload.marks ?? {};
  const count = Object.keys(marks).length;
  shardTotal += count;
  if (count !== cell.count) problems.push({ issue: 'cell-count', cell: cell.path, declared: cell.count, found: count });
  for (const [id, entry] of Object.entries(marks)) {
    if (entries.has(id)) problems.push({ issue: 'duplicate-id', id });
    entries.set(id, entry);
    const hasFog = entry.fogSignal === true || Boolean(entry.fogSignalCategory);
    const hasRacon = Boolean(
      entry.radarTransponderCategory ?? entry.radarTransponderGroup ??
        entry.radarTransponderPeriod ?? entry.radarTransponderSequence,
    );
    if (hasFog) fog++;
    if (hasRacon) racon++;
    if (!hasFog && !hasRacon) problems.push({ issue: 'no-signal', id });
    if (!Number.isFinite(entry.lat) || !Number.isFinite(entry.lon)) problems.push({ issue: 'no-position', id });
  }
}
if (Number(manifest.count) !== entries.size) {
  problems.push({ issue: 'manifest-count', declared: manifest.count, found: entries.size });
}
if (shardTotal !== entries.size) problems.push({ issue: 'shard-total', shardTotal, unique: entries.size });

// How much of the index lands on an archive mark, and how many marks gain a
// signal they were previously drawn without.
const archive = new Map();
for (const name of readdirSync(archiveDir).filter((file) => file.endsWith('.json'))) {
  const shard = JSON.parse(readFileSync(join(archiveDir, name), 'utf8'));
  for (const feature of shard.features ?? []) {
    const mark = feature?.navaid ?? feature;
    if (mark?.id) archive.set(mark.id, mark);
  }
}

let matched = 0;
let fogGain = 0;
let raconGain = 0;
const unmatched = [];
for (const [id, entry] of entries) {
  const mark = archive.get(id);
  if (!mark) {
    unmatched.push(id);
    continue;
  }
  matched++;
  if (entry.fogSignal && !mark.fogSignal) fogGain++;
  const hasRacon = entry.radarTransponderCategory ?? entry.radarTransponderGroup ??
    entry.radarTransponderPeriod ?? entry.radarTransponderSequence;
  if (hasRacon && !mark.radarTransponderCategory && !mark.radarTransponderGroup) raconGain++;
}

const report = {
  generatedAt: new Date().toISOString(),
  sourceTimestamp: manifest.sourceTimestamp ?? null,
  entries: entries.size,
  fogSignals: fog,
  racons: racon,
  cells: manifest.cells?.length ?? 0,
  matched,
  unmatched: unmatched.length,
  unmatchedIds: unmatched.slice(0, 40),
  fogGain,
  raconGain,
  problems,
};

console.log('Mark-signal audit');
console.log('  index entries         ', report.entries, `(${report.fogSignals} fog signals, ${report.racons} racons)`);
console.log('  cells                 ', report.cells, '· manifest', manifest.count, '· pull', report.sourceTimestamp ?? 'unknown');
console.log('  attached to a mark    ', report.matched, '· unmatched', report.unmatched);
console.log('  marks gaining a signal', `sound ${report.fogGain} · racon ${report.raconGain}`);
console.log('  problems              ', problems.length === 0 ? 'none' : JSON.stringify(problems.slice(0, 12)));

if (outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(report, null, 1)}\n`);
  console.log(`Report written to ${outPath}`);
}

if (problems.length > 0) process.exit(1);
