/**
 * USCG Light List supplement builder.
 *
 * Reads the 61 static NAVCEN MSI GeoJSON chunks (the same files the MSI app
 * itself downloads — public, no sign-in), keeps the LIT aids only (v1, like
 * the CCG supplement), dedupes by (volume, Light List number) keeping the
 * latest MODIFIED_DATE, and writes one trimmed, minified dataset per volume
 * to public/uscg-lights-<volume>.json for the app to fetch and merge
 * downstream. Sharded, not single-file: the full set is ~8 MB, and a single
 * snapshot push that size sits too close to the transport timeout — each
 * volume file is ~1–2 MB and pushes in seconds.
 *
 * Light List numbers repeat across volumes (LLN 40095 is four different
 * aids), so the volume is part of the key — never dedupe on the number alone.
 * Clearance-style honesty note: ranges are kept only when the source unit is
 * nautical miles (STAT MI / KM records omit the range in v1 rather than
 * showing a silently converted figure); focal planes are feet in the source
 * and keep the ' ft' suffix in the record.
 *
 * Run: node scripts/build-uscg-lights.mjs
 * Cache: ~/workspace/uscg-cache (USCG_CACHE overrides); missing chunks are
 * fetched into the cache first, so a re-run after the daily refresh picks up
 * new files without re-downloading the rest.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
// The MSI static files are served to browsers; a plain script UA gets a 403
// on this host, so the fetch identifies as a browser (the files themselves
// are public downloads, no auth or token involved).
const MSI_BASE = 'https://navcen.uscg.gov/sites/default/files/msi/';

const DISTRICT_SPECS = [
  ['01', 10],
  ['02', 4],
  ['05', 9],
  ['07', 15],
  ['08', 10],
  ['09', 5],
  ['11', 2],
  ['13', 3],
  ['14', 1],
  ['17', 2],
];

export const USCG_FILES = DISTRICT_SPECS.flatMap(([district, count]) =>
  Array.from({ length: count }, (_, i) => `lightListD${district}_${i + 1}.geojson`),
);

const COLOUR_NAMES = { R: 'red', G: 'green', W: 'white', Y: 'yellow', B: 'blue' };
// Longest first: FFl must win over Fl, and Fl over F.
const CHAR_TOKENS = ['STROBE', 'FFl', 'Fl', 'Iso', 'Oc', 'Mo', 'Al', 'Q', 'F'];

/**
 * Split a USCG light-character string ('Fl (2)R 5s', 'Mo (U) W', 'Al RG 20s',
 * 'Fl G (2)W 10s', 'STROBE') into the loader's light fields. The raw string
 * stays as the display text; character drops the space before the group to
 * match the OSM/CCG style ('Fl(2)', 'Mo(U)') so cross-source merging compares
 * like with like. Multi-colour lights keep their first colour for the flare.
 */
export function parseLightChar(raw) {
  if (!raw || typeof raw !== 'string') {
    return { light: null, character: null, colour: null, period: null, group: null };
  }
  const light = raw.trim();
  const periodMatch = light.match(/(\d+(?:\.\d+)?)s$/i);
  const period = periodMatch ? periodMatch[1] : null;
  let rest = periodMatch ? light.slice(0, periodMatch.index).trim() : light;
  let character = null;
  for (const token of CHAR_TOKENS) {
    if (rest.toLowerCase().startsWith(token.toLowerCase())) {
      character = token;
      rest = rest.slice(token.length).trim();
      break;
    }
  }
  if (!character) return { light, character: null, colour: null, period, group: null };
  let group = null;
  const paren = rest.match(/\(([^)]*)\)/);
  if (paren) {
    // The group joins the character ('Fl(2)', like OSM/CCG) and is also
    // kept separately for the card's Signal group row; a Morse letter
    // ('Mo(U)') is part of the character, not a group.
    character = `${character}(${paren[1]})`;
    if (/^[\d+]+$/.test(paren[1])) group = paren[1];
  }
  let colour = null;
  for (const token of rest.split(/\s+/)) {
    const stripped = token.replace(/\([^)]*\)/g, '');
    if (/^[RGBWY]+$/.test(stripped)) {
      colour = COLOUR_NAMES[stripped[0]];
      break;
    }
  }
  return { light, character, colour, period, group };
}

/**
 * One GeoJSON feature -> a trimmed record, or null with a skip reason.
 * Lit-only v1: unlit aids (daybeacons, unlighted buoys) are skipped, as are
 * the 518 placeholder rows that carry no aid type, no number and no light.
 */
export function featureToRecord(feature, sourceFile) {
  const p = feature?.properties ?? {};
  const g = feature?.geometry;
  if (!g || g.type !== 'Point' || !Array.isArray(g.coordinates)) return { record: null, skip: 'no-geometry' };
  if (p.INACTIVE === '1') return { record: null, skip: 'inactive' };
  const lln = p.LIGHT_LIST_NUMBER;
  const volume = p.VOLUME_NUMBER;
  if (lln === null || lln === undefined || volume === null || volume === undefined) {
    return { record: null, skip: 'no-id' };
  }
  const parsed = parseLightChar(p.LIGHT_CHAR);
  if (!parsed.light) return { record: null, skip: 'unlit' };
  const [lon, lat] = g.coordinates;
  // 6 decimals is ~0.1 m — far beyond the source's accuracy — and it drops
  // the float noise ('44.94183000000004') that would otherwise bloat the
  // dataset.
  const round6 = (x) => Math.round(x * 1e6) / 1e6;
  const waterway = String(p.HWATERWAY_NAME ?? p.RIVER_NAME ?? '').trim() || null;
  const desc =
    [waterway, p.STRUCTURE_REMARK, p.REMARK]
      .map((s) => String(s ?? '').trim())
      .filter(Boolean)
      .join(' · ') || null;
  const range =
    p.LIGHT_NOM_RANGE_UNIT === 'NAUT MI' && p.LIGHT_NOM_RANGE !== null && p.LIGHT_NOM_RANGE !== undefined
      ? String(p.LIGHT_NOM_RANGE)
      : null;
  const focal =
    p.LIGHT_FOCAL_PLANE_UNIT === 'FT' && p.LIGHT_FOCAL_PLANE !== null && p.LIGHT_FOCAL_PLANE !== undefined
      ? `${p.LIGHT_FOCAL_PLANE} ft`
      : null;
  return {
    record: {
      v: String(volume),
      no: lln,
      name: String(p.NAME ?? '').trim() || null,
      lat: round6(lat),
      lon: round6(lon),
      light: parsed.light,
      character: parsed.character,
      colour: parsed.colour,
      period: parsed.period,
      group: parsed.group,
      range,
      focal,
      desc,
      src: sourceFile,
    },
    mod: typeof p.MODIFIED_DATE === 'number' ? p.MODIFIED_DATE : 0,
    skip: null,
  };
}

/** Dedupe parsed entries by (volume, number), latest revision wins. */
export function dedupeUscg(entries) {
  const byKey = new Map();
  for (const entry of entries) {
    if (!entry.record) continue;
    const key = `${entry.record.v}:${entry.record.no}`;
    const prev = byKey.get(key);
    if (!prev || entry.mod > prev.mod) byKey.set(key, entry);
  }
  return [...byKey.values()].map((entry) => entry.record);
}

async function main() {
  const cacheDir = process.env.USCG_CACHE ?? join(process.env.HOME ?? '', 'workspace', 'uscg-cache');
  mkdirSync(cacheDir, { recursive: true });
  const publicDir = join(fileURLToPath(new URL('..', import.meta.url)), 'public');
  const entries = [];
  const skipped = {};
  let seen = 0;
  for (const file of USCG_FILES) {
    const path = join(cacheDir, file);
    if (!existsSync(path)) {
      const res = await fetch(`${MSI_BASE}${file}`, { headers: { 'User-Agent': BROWSER_UA } });
      if (!res.ok) throw new Error(`${file} HTTP ${res.status}`);
      writeFileSync(path, Buffer.from(await res.arrayBuffer()));
      console.log(`fetched ${file}`);
    }
    const data = JSON.parse(readFileSync(path, 'utf8'));
    for (const feature of data.features ?? []) {
      seen += 1;
      const entry = featureToRecord(feature, file);
      if (entry.skip) skipped[entry.skip] = (skipped[entry.skip] ?? 0) + 1;
      else entries.push(entry);
    }
  }
  const records = dedupeUscg(entries);
  const byVolume = new Map();
  for (const record of records) {
    if (!byVolume.has(record.v)) byVolume.set(record.v, []);
    byVolume.get(record.v).push(record);
  }
  const generated = new Date().toISOString();
  for (const [volume, volumeRecords] of [...byVolume.entries()].sort()) {
    const file = {
      generated,
      source: 'USCG Light List (USCG NAVCEN MSI GeoJSON)',
      sourceUrl: 'https://navcen.uscg.gov/msi',
      volume,
      files: USCG_FILES,
      recordCount: volumeRecords.length,
      records: volumeRecords,
    };
    const outPath = join(publicDir, `uscg-lights-${volume}.json`);
    writeFileSync(outPath, JSON.stringify(file));
    console.log(`wrote ${outPath} (${volumeRecords.length} records)`);
  }
  console.log(`seen=${seen} kept=${entries.length} deduped=${records.length} skipped=${JSON.stringify(skipped)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
