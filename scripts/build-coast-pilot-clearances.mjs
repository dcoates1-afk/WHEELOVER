/**
 * Build the US Coast Pilot clearance dataset (5th clearance source).
 *
 * Coast Pilot is NOAA's ten-volume sailing directions, published as one
 * PDF per chapter (CPB{volume}_C{chapter}_WEB.pdf) and updated weekly.
 * Bridge clearances appear as narrative prose, so this script downloads
 * every chapter, runs pdftotext (reading order, not -layout — the pages
 * are two columns and -layout interleaves them), and extracts bridge
 * passages with scripts/coast-pilot-parse.mjs.
 *
 * Output:
 *  - public/bridge-clearances/coastpilot.json (shipped dataset; the source
 *    sentence is stripped — it lives only in the review file)
 *  - <workdir>/review.txt (every kept record with its source sentence, plus
 *    every dropped passage with its reason — read this before trusting a
 *    rebuild; narrative extraction WILL mis-parse sometimes)
 *  - public/bridge-clearances/manifest.json gains the coastpilot entry and
 *    a fresh generatedAt (the bundle assembly date; per-source retrieval
 *    dates live on the disclaimer page)
 *
 * Re-run with --fresh to re-download and re-extract everything; otherwise
 * existing chapter PDFs and text files are reused.
 *
 * Usage: node scripts/build-coast-pilot-clearances.mjs [--fresh]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractRecords } from './coast-pilot-parse.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORK = join(process.env.HOME ?? '', 'workspace', 'coast-pilot');
const CHAPTERS_DIR = join(WORK, 'chapters');
const TEXT_DIR = join(WORK, 'text');
const OUT_JSON = join(REPO, 'public', 'bridge-clearances', 'coastpilot.json');
const MANIFEST_JSON = join(REPO, 'public', 'bridge-clearances', 'manifest.json');
const REVIEW_TXT = join(WORK, 'review.txt');
const FRESH = process.argv.includes('--fresh');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithRetries(url, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      lastError = new Error(`HTTP ${res.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(1000 * (attempt + 1));
  }
  throw lastError;
}

async function discoverChapters() {
  const out = {};
  for (let vol = 1; vol <= 10; vol++) {
    const chapters = [];
    let misses = 0;
    for (let ch = 1; ch <= 40 && misses < 3; ch++) {
      const code = String(ch).padStart(2, '0');
      const url = `https://nauticalcharts.noaa.gov/publications/coast-pilot/files/cp${vol}/CPB${vol}_C${code}_WEB.pdf`;
      try {
        const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(30000) });
        if (res.ok) {
          chapters.push(code);
          misses = 0;
        } else misses++;
      } catch {
        misses++;
      }
    }
    out[`cp${vol}`] = chapters;
    console.log(`cp${vol}: ${chapters.length} chapters`);
  }
  return out;
}

function main() {
  return (async () => {
    mkdirSync(CHAPTERS_DIR, { recursive: true });
    mkdirSync(TEXT_DIR, { recursive: true });
    const chapters = await discoverChapters();
    const today = new Date().toISOString().slice(0, 10);
    const kept = [];
    const droppedAll = [];
    const unjoinable = [];
    const seen = new Set();
    let chapterCount = 0;
    for (const [volume, codes] of Object.entries(chapters)) {
      const vol = Number(volume.slice(2));
      for (const code of codes) {
        chapterCount++;
        const label = `CP${vol} Ch.${Number(code)}`;
        const pdf = join(CHAPTERS_DIR, `cp${vol}-c${code}.pdf`);
        const txt = join(TEXT_DIR, `cp${vol}-c${code}.txt`);
        if (FRESH || !existsSync(pdf) || statSync(pdf).size === 0) {
          const url = `https://nauticalcharts.noaa.gov/publications/coast-pilot/files/cp${vol}/CPB${vol}_C${code}_WEB.pdf`;
          try {
            writeFileSync(pdf, await fetchWithRetries(url));
          } catch (error) {
            console.log(`  !! download failed ${label}: ${error.message}`);
            continue;
          }
        }
        if (FRESH || !existsSync(txt) || statSync(txt).mtimeMs < statSync(pdf).mtimeMs) {
          try {
            // Plain pdftotext, NOT -layout: Coast Pilot pages are two
            // columns, and -layout interleaves the columns line by line,
            // shredding every sentence. Reading order keeps passages whole.
            execFileSync('pdftotext', [pdf, txt], { stdio: 'pipe' });
          } catch (error) {
            console.log(`  !! pdftotext failed ${label}: ${error.message}`);
            continue;
          }
        }
        const { records, dropped } = extractRecords(readFileSync(txt, 'utf8'), volume, label);
        for (const record of records) {
          // A record the on-device join can never attribute is dead weight
          // in the shipped file: named records need coordinates or a
          // waterway, group records always carry their waterway.
          if (!record.least && record.la === null && record.lo === null && !record.w) {
            unjoinable.push({ ...record, reason: 'unjoinable: no coords or waterway' });
            continue;
          }
          const key = JSON.stringify([
            record.n ?? record.g,
            record.w,
            record.v.join(','),
            record.o?.join(',') ?? '',
            record.d,
            record.la,
            record.lo,
          ]);
          if (seen.has(key)) continue;
          seen.add(key);
          kept.push(record);
        }
        for (const d of dropped) droppedAll.push(d);
      }
    }
    // The shipped file carries no source sentences (review file only).
    const shipped = kept.map(({ src, ...rest }) => rest);
    writeFileSync(OUT_JSON, JSON.stringify(shipped, null, 1));
    const lines = [
      `US Coast Pilot clearance build, ${today}`,
      `Chapters processed: ${chapterCount}`,
      `Records kept: ${kept.length}`,
      `Dropped by parser: ${droppedAll.length}`,
      `Dropped as unjoinable: ${unjoinable.length}`,
      '',
      '== KEPT ==',
    ];
    for (const r of kept) {
      lines.push(
        `${r.ch} | ${r.n ?? r.g} | w=${r.w ?? '-'} | v=${r.v.join('/')} | o=${r.o?.join('/') ?? '-'} | h=${r.h ?? '-'} | d=${r.d} | least=${r.least} | t=${r.t ?? '-'} | @=${r.la ?? '-'},${r.lo ?? '-'} | ${r.src}`,
      );
    }
    lines.push('', '== DROPPED BY PARSER ==');
    for (const d of droppedAll) lines.push(`${d.ch} | ${d.reason} | ${d.sentence}`);
    lines.push('', '== DROPPED AS UNJOINABLE ==');
    for (const d of unjoinable) lines.push(`${d.ch} | ${d.reason} | ${d.src}`);
    writeFileSync(REVIEW_TXT, lines.join('\n'));
    const manifest = JSON.parse(readFileSync(MANIFEST_JSON, 'utf8'));
    manifest.sources.coastpilot = {
      label: 'US Coast Pilot',
      datum: 'MHW (CP6: LWD)',
      count: kept.length,
      retrieved: today,
    };
    manifest.generatedAt = today;
    writeFileSync(MANIFEST_JSON, JSON.stringify(manifest, null, 2));
    console.log(`DONE chapters=${chapterCount} kept=${kept.length} dropped=${droppedAll.length} unjoinable=${unjoinable.length}`);
    console.log(`Wrote ${OUT_JSON} and ${REVIEW_TXT}`);
  })();
}

main().catch((error) => {
  console.error(`BUILD FAILED: ${error.message}`);
  process.exit(1);
});
