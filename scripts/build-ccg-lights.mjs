/**
 * Build public/ccg-lights.json from the CCG List of Lights HTML pages.
 *
 * Crawl model: volume index -> section pages -> rows (see ccg-parse.mjs).
 * Polite by default: sequential fetches, a delay between page fetches,
 * everything cached under --cache-dir so a re-run only fetches what is
 * missing (or --refresh to refetch). The committed artifact is only the
 * JSON; cached HTML stays out of the push.
 *
 * Usage:
 *   node scripts/build-ccg-lights.mjs [--volume pac|atl|arc|newfoundland|all]
 *     [--out public/ccg-lights.json] [--cache-dir data-raw/ccg]
 *     [--refresh] [--delay-ms 300]
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSectionHtml } from './ccg-parse.mjs';

const BASE = 'https://notmar.gc.ca';
const INDEX_URL = `${BASE}/list-lights`;
const USER_AGENT = 'WHEELOVER-research (contact: atwheel-over@outlook.com)';
const VOLUMES = ['pac', 'atl', 'arc', 'newfoundland'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const args = { volume: 'all', out: 'public/ccg-lights.json', cacheDir: 'data-raw/ccg', refresh: false, delayMs: 300 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--volume') args.volume = argv[++i];
    else if (arg === '--out') args.out = argv[++i];
    else if (arg === '--cache-dir') args.cacheDir = argv[++i];
    else if (arg === '--refresh') args.refresh = true;
    else if (arg === '--delay-ms') args.delayMs = Number(argv[++i]);
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (args.volume !== 'all' && !VOLUMES.includes(args.volume)) {
    throw new Error(`unknown volume: ${args.volume} (expected one of ${VOLUMES.join(', ')} or all)`);
  }
  return args;
}

async function fetchCached(url, cachePath, refresh) {
  if (!refresh && existsSync(cachePath)) return readFileSync(cachePath, 'utf8');
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' } });
  if (!res.ok) throw new Error(`fetch ${url} -> HTTP ${res.status}`);
  const text = await res.text();
  writeFileSync(cachePath, text);
  return text;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const cacheDir = resolve(root, args.cacheDir);
  mkdirSync(cacheDir, { recursive: true });
  const wanted = args.volume === 'all' ? VOLUMES : [args.volume];

  const indexHtml = await fetchCached(INDEX_URL, join(cacheDir, 'index.html'), args.refresh);
  const sectionUrls = [];
  {
    const seenPaths = new Set();
    for (const m of indexHtml.matchAll(/href="(\/publications\/list-lights\/([a-z]+)\/[a-z0-9]+-en\.php)"/gi)) {
      const section = { path: m[1], volume: m[2] };
      if (!wanted.includes(section.volume) || seenPaths.has(section.path)) continue;
      seenPaths.add(section.path);
      sectionUrls.push(section);
    }
    sectionUrls.sort((a, b) => (a.volume < b.volume ? -1 : a.volume > b.volume ? 1 : a.path < b.path ? -1 : 1));
  }

  console.log(`[ccg] ${sectionUrls.length} section pages across ${wanted.join(', ')}`);
  const records = [];
  const seen = new Set();
  let skippedUnlit = 0;
  let skippedIndex = 0;
  let malformed = 0;
  let duplicates = 0;
  const failures = [];
  for (const section of sectionUrls) {
    const slug = section.path.replace(/\//g, '_').replace(/\.php$/, '');
    const cachePath = join(cacheDir, `${slug}.html`);
    try {
      const pageHtml = await fetchCached(`${BASE}${section.path}`, cachePath, args.refresh);
      const parsed = parseSectionHtml(pageHtml, section.volume, `${BASE}${section.path}`);
      skippedUnlit += parsed.skippedUnlit;
      skippedIndex += parsed.skippedIndex;
      malformed += parsed.malformed;
      for (const row of parsed.rows) {
        const key = `${row.volume}:${row.no}`;
        if (seen.has(key)) {
          duplicates += 1;
          continue;
        }
        seen.add(key);
        records.push(row);
      }
    } catch (error) {
      failures.push(`${section.path}: ${error.message}`);
      console.error(`[ccg] FAILED ${section.path}: ${error.message}`);
    }
    await sleep(args.delayMs);
  }

  records.sort((a, b) => (a.volume < b.volume ? -1 : a.volume > b.volume ? 1 : a.no < b.no ? -1 : a.no > b.no ? 1 : 0));
  const out = {
    source: 'CCG List of Lights, Buoys and Fog Signals',
    sourceUrl: INDEX_URL,
    generatedAt: new Date().toISOString().split('T')[0],
    volumes: wanted,
    recordCount: records.length,
    skippedUnlit,
    skippedIndex,
    malformed,
    duplicates,
    records,
  };
  const outPath = resolve(root, args.out);
  writeFileSync(outPath, `${JSON.stringify(out, null, 1)}\n`);
  console.log(`[ccg] wrote ${outPath}: ${records.length} lit aids, ${skippedUnlit} unlit skipped, ${skippedIndex} index rows skipped, ${malformed} malformed, ${duplicates} duplicates, ${failures.length} failed pages`);
  if (failures.length > 0) {
    console.error(`[ccg] failed pages:\n${failures.join('\n')}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`[ccg] ${error.message}`);
  process.exitCode = 1;
});
