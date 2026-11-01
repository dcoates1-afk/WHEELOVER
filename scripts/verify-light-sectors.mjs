#!/usr/bin/env node
/**
 * Light-sector audit.
 *
 * A sector light is only useful on the chart if every mapped sector has a
 * bearing pair the renderer can draw. This walks the built mark data and reports
 * the lights where a sector record exists but no arc would be drawn, where a
 * multi-sector light would lose only some of its arcs, and where the bearing
 * limits are not usable. It also checks the raw OSM snapshots to catch sector
 * tags that the normaliser never turned into records.
 *
 * Usage:
 *   node scripts/verify-light-sectors.mjs
 *   node scripts/verify-light-sectors.mjs --out artifacts/light-sector-audit.json
 */
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lightSectorDrawLimits, lightSectorsFromTags } from '../shared/navaid-core.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const archiveDir = join(root, 'public', 'marine-db', 'navaids');
const regionalDir = join(root, 'public', 'navaid-db');
const rawSnapshots = [join(root, 'data-raw', 'solent.json'), join(root, 'data-raw', 'ny.json')];

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const outPath = outIndex >= 0 ? resolve(root, args[outIndex + 1]) : null;

/** The renderer's own rule, imported so the audit cannot drift from the chart. */
const drawLimits = lightSectorDrawLimits;

function inspect(mark) {
  const sectors = Array.isArray(mark.lightSectors) ? mark.lightSectors : [];
  if (sectors.length === 0) return null;
  const drawn = [];
  const missing = [];
  for (const sector of sectors) {
    const limits = drawLimits(sector);
    if (limits) drawn.push({ sector, limits });
    else missing.push(sector);
  }
  const issues = [];
  const directionalLight = sectors.some((sector) => String(sector.category ?? '').toLowerCase() === 'directional');
  // One unnumbered record with no limits is just the light itself; every mark
  // with a character produces one. Only multi-record lights and directional
  // lights with unusable bearings are a missed sector.
  const plainLight = sectors.length === 1 && missing.length === 1 && !directionalLight;
  if (plainLight) return null;
  if (drawn.length === 0) issues.push('no-drawable-sector');
  else if (missing.length > 0) issues.push('partial-fan');
  for (const sector of missing) {
    const hasStart = sector.start !== undefined && sector.start !== null && sector.start !== '';
    const hasEnd = sector.end !== undefined && sector.end !== null && sector.end !== '';
    if (hasStart !== hasEnd) issues.push('half-sector-limits');
    else if (String(sector.category ?? '').toLowerCase() === 'directional') issues.push('directional-without-orientation');
    else issues.push('record-without-limits');
  }
  for (const { sector, limits } of drawn) {
    if (limits.some((limit) => limit < 0 || limit > 360)) issues.push('bearing-out-of-range');
    if (!sector.character && !sector.colour && !sector.range) issues.push('record-without-detail');
  }
  if (issues.length === 0) return null;
  return {
    id: mark.id,
    name: mark.name ?? null,
    lat: mark.lat,
    lon: mark.lon,
    category: mark.category,
    sectors: sectors.length,
    drawn: drawn.length,
    issues: [...new Set(issues)],
    records: sectors.map((sector) => ({
      sector: sector.sector,
      character: sector.character ?? null,
      colour: sector.colour ?? null,
      start: sector.start ?? null,
      end: sector.end ?? null,
      orientation: sector.orientation ?? null,
      category: sector.category ?? null,
    })),
  };
}

const findings = [];
const builtById = new Map();
const totals = { marks: 0, lightsWithSectors: 0, sectors: 0, drawn: 0 };
const byIssue = new Map();
const bySource = new Map();

function record(source, mark) {
  totals.marks++;
  if (mark.id) builtById.set(mark.id, mark);
  const sectors = Array.isArray(mark.lightSectors) ? mark.lightSectors : [];
  if (sectors.length > 0) totals.lightsWithSectors++;
  totals.sectors += sectors.length;
  const finding = inspect(mark);
  if (!finding) {
    totals.drawn += sectors.length;
    return;
  }
  totals.drawn += finding.drawn;
  finding.source = source;
  findings.push(finding);
  for (const issue of finding.issues) {
    byIssue.set(issue, (byIssue.get(issue) ?? 0) + 1);
    const key = `${source}:${issue}`;
    bySource.set(key, (bySource.get(key) ?? 0) + 1);
  }
}

// 1. The worldwide archive the chart actually loads.
let archiveShards = 0;
for (const file of readdirSync(archiveDir).filter((entry) => entry.endsWith('.json')).sort()) {
  const payload = JSON.parse(readFileSync(join(archiveDir, file), 'utf8'));
  const features = Array.isArray(payload) ? payload : (payload.features ?? []);
  archiveShards++;
  for (const feature of features) {
    const mark = feature.navaid ?? feature;
    if (mark && typeof mark.lat === 'number' && typeof mark.lon === 'number') record('marine-db', mark);
  }
}

// 2. Regional shards and the bundled seed extract.
function visitRegional(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      visitRegional(path);
      continue;
    }
    if (!entry.name.endsWith('.json') || entry.name === 'manifest.json') continue;
    const payload = JSON.parse(readFileSync(path, 'utf8'));
    const marks = Array.isArray(payload) ? payload : (payload.navaids ?? payload.features ?? []);
    for (const mark of marks) record('navaid-db', mark.navaid ?? mark);
  }
}
visitRegional(regionalDir);
const seed = JSON.parse(readFileSync(join(root, 'src', 'data', 'solentNavaids.json'), 'utf8'));
for (const mark of seed.navaids ?? []) record('seed', mark);

// 3. Raw OSM snapshots: every numbered sector tag should survive normalisation.
const rawLosses = [];
let rawSectorTags = 0;
for (const file of rawSnapshots) {
  const payload = JSON.parse(readFileSync(file, 'utf8'));
  for (const element of payload.elements ?? payload) {
    const tags = element.tags ?? {};
    const keys = Object.keys(tags).filter((key) => /^seamark:light:(\d+:)?sector_(start|end)$/.test(key));
    if (keys.length === 0) continue;
    rawSectorTags += keys.length;
    const id = `osm:${element.type ?? 'node'}/${element.id}`;
    const built = builtById.get(id);
    if (!built) continue;
    const sectors = built.lightSectors ?? [];
    const limited = sectors.filter((sector) => drawLimits(sector)).length;
    const numbered = new Set(
      keys.map((key) => (/^seamark:light:(\d+):/.exec(key)?.[1] ?? '1')),
    );
    if (limited < numbered.size) {
      rawLosses.push({
        id,
        name: built.name ?? null,
        file: file.replace(`${root}/`, '').replace(/\\/g, '/'),
        numberedSectorTags: numbered.size,
        builtSectors: sectors.length,
        builtDrawn: limited,
      });
    }
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  archiveShards,
  totals,
  findingsByIssue: Object.fromEntries([...byIssue].sort((a, b) => b[1] - a[1])),
  findingsBySource: Object.fromEntries([...bySource].sort((a, b) => b[1] - a[1])),
  findings,
  rawSectorTags,
  rawLosses,
};

// 4. The worldwide sector index: every entry the chart can attach, and how
// many of them have an archive mark to attach to.
const indexPath = join(root, 'public', 'marine-db', 'light-sectors', 'manifest.json');
let indexCoverage = null;
if (existsSync(indexPath)) {
  const indexManifest = JSON.parse(readFileSync(indexPath, 'utf8'));
  const indexed = new Map();
  for (const cell of indexManifest.cells ?? []) {
    const file = join(root, 'public', 'marine-db', cell.path);
    if (!existsSync(file)) continue;
    const payload = JSON.parse(readFileSync(file, 'utf8'));
    for (const [id, entry] of Object.entries(payload.lights ?? {})) indexed.set(id, entry);
  }
  const attachable = [...indexed.keys()].filter((id) => builtById.has(id)).length;
  indexCoverage = {
    generatedAt: indexManifest.generatedAt ?? null,
    sourceTimestamp: indexManifest.sourceTimestamp ?? null,
    lights: indexed.size,
    records: indexManifest.records ?? null,
    attachable,
    unmatched: indexed.size - attachable,
  };

  // Split the id misses by whether the chart can still place the light: the
  // archive does not plot every OSM object that carries a light tag (warning
  // signals, daymarks, topmarks), and a lighthouse mapped as a multipolygon is
  // attached to the structure mark by position instead of by id.
  const PROXIMITY_TYPES = new Set(['light_major', 'light_minor', 'light', 'lighthouse', 'beacon']);
  const PROXIMITY_M = 250;
  const meters = (aLat, aLon, bLat, bLon) => {
    const rad = Math.PI / 180;
    const dLat = (bLat - aLat) * rad;
    const dLon = (bLon - aLon) * rad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(a)));
  };
  const unplottedTypes = new Map();
  const noMarkAnywhere = [];
  let proximityAttachable = 0;
  for (const [id, entry] of indexed) {
    if (builtById.has(id)) continue;
    if (!PROXIMITY_TYPES.has(String(entry.type ?? '')) || !Number.isFinite(entry.lat) || !Number.isFinite(entry.lon)) {
      const type = String(entry.type ?? '(none)');
      unplottedTypes.set(type, (unplottedTypes.get(type) ?? 0) + 1);
      continue;
    }
    const target = [...builtById.values()].find((mark) =>
      (mark.lit || mark.category === 'landmark' || mark.category === 'other') &&
      meters(entry.lat, entry.lon, mark.lat, mark.lon) <= PROXIMITY_M,
    );
    if (target) proximityAttachable += 1;
    else noMarkAnywhere.push({ id, name: null, type: entry.type, lat: entry.lat, lon: entry.lon, sectors: entry.sectors?.length ?? 0 });
  }
  indexCoverage.unmatchedByType = Object.fromEntries([...unplottedTypes].sort((a, b) => b[1] - a[1]));
  indexCoverage.proximityAttachable = proximityAttachable;
  indexCoverage.noMarkAnywhere = noMarkAnywhere;

  // Every light with no mark anywhere must be flagged for the chart to draw it
  // from the index, and a flagged light must not also have an archive mark or
  // the chart would draw it twice.
  const standalone = [...indexed].filter(([, entry]) => entry.standalone === true);
  const standaloneProblems = [];
  for (const [, light] of noMarkAnywhere.entries()) {
    if (!standalone.some(([id]) => id === light.id)) standaloneProblems.push({ id: light.id, issue: 'not-flagged' });
  }
  for (const [id, entry] of standalone) {
    if (builtById.has(id)) standaloneProblems.push({ id, issue: 'archive-mark-exists' });
    if (!Number.isFinite(entry.lat) || !Number.isFinite(entry.lon)) standaloneProblems.push({ id, issue: 'no-position' });
    if (!Array.isArray(entry.sectors) || entry.sectors.length === 0) standaloneProblems.push({ id, issue: 'no-sectors' });
  }
  indexCoverage.standalone = standalone.length;
  indexCoverage.standaloneLights = standalone.map(([id, entry]) => ({
    id,
    name: entry.name ?? null,
    type: entry.type ?? null,
    lat: entry.lat ?? null,
    lon: entry.lon ?? null,
    sectors: entry.sectors?.length ?? 0,
    fogSignal: entry.fogSignal === true,
    racon: Boolean(entry.radarTransponderCategory),
  }));
  indexCoverage.standaloneProblems = standaloneProblems;

  // Every entry must draw at least one arc, use bearings on the compass, and
  // not repeat a light number; these are the failures the renderer cannot show.
  const indexIssues = { undrawable: [], bearingOutOfRange: [], repeatedSector: [] };
  for (const [id, entry] of indexed) {
    const sectors = Array.isArray(entry.sectors) ? entry.sectors : [];
    const drawn = sectors.filter((sector) => drawLimits(sector));
    if (drawn.length === 0) indexIssues.undrawable.push({ id, sectors: sectors.length });
    for (const sector of drawn) {
      const [start, end] = drawLimits(sector);
      if (start < 0 || start > 360 || end < 0 || end > 360) indexIssues.bearingOutOfRange.push({ id, start, end });
    }
    const numbers = sectors.map((sector) => sector.sector);
    if (new Set(numbers).size !== numbers.length) indexIssues.repeatedSector.push({ id });
  }
  indexCoverage.issues = {
    undrawable: indexIssues.undrawable.length,
    bearingOutOfRange: indexIssues.bearingOutOfRange.length,
    repeatedSector: indexIssues.repeatedSector.length,
  };
  indexCoverage.samples = {
    undrawable: indexIssues.undrawable.slice(0, 5),
    bearingOutOfRange: indexIssues.bearingOutOfRange.slice(0, 5),
    repeatedSector: indexIssues.repeatedSector.slice(0, 5),
  };

  // The compiled index must account for every sector light in the OSM pull,
  // including the ones whose only usable limits are on light 2 or above.
  const osmPath = join(root, 'data-raw', 'osm-light-sectors.json');
  if (existsSync(osmPath)) {
    const pull = JSON.parse(readFileSync(osmPath, 'utf8'));
    const pullLights = (pull.elements ?? []).map((element) => ({
      id: `osm:${element.type ?? 'node'}/${element.id}`,
      sectors: lightSectorsFromTags(element.tags ?? {}),
    }));
    const drawable = pullLights.filter((light) => light.sectors.some((sector) => drawLimits(sector)));
    const missing = drawable.filter((light) => !indexed.has(light.id));
    const undrawable = pullLights
      .filter((light) => !light.sectors.some((sector) => drawLimits(sector)))
      .map((light) => ({ id: light.id, records: light.sectors.length }));
    indexCoverage.osm = {
      timestamp: pull.osm3s?.timestamp_osm_base ?? null,
      lights: pullLights.length,
      drawable: drawable.length,
      undrawable: undrawable.length,
      missingFromIndex: missing.length,
      missingSamples: missing.slice(0, 5),
      undrawableSamples: undrawable.slice(0, 5),
    };
  }
}

report.indexCoverage = indexCoverage;

console.log('Light-sector audit');
console.log('  archive shards        ', archiveShards);
console.log('  marks scanned         ', totals.marks);
console.log('  lights with sectors   ', totals.lightsWithSectors);
console.log('  sector records        ', totals.sectors);
console.log('  sectors drawable      ', totals.drawn);
console.log('  lights with issues    ', findings.length);
if (indexCoverage) {
  console.log('  worldwide index       ', indexCoverage.lights, 'lights ·', indexCoverage.records, 'records');
  console.log('  index attached to marks', indexCoverage.attachable, '· unmatched', indexCoverage.unmatched);
  console.log('  unmatched by type      ', indexCoverage.unmatchedByType);
  console.log(
    '  placed by position     ',
    indexCoverage.proximityAttachable,
    '· no mark anywhere',
    indexCoverage.noMarkAnywhere.length,
  );
  for (const light of indexCoverage.noMarkAnywhere) {
    console.log(
      `    ${light.id} ${light.type} ${light.lat?.toFixed(4)},${light.lon?.toFixed(4)} ${light.sectors} sectors`,
    );
  }
  console.log(
    '  standalone marks       ',
    indexCoverage.standalone,
    indexCoverage.standaloneProblems.length > 0 ? `· problems ${JSON.stringify(indexCoverage.standaloneProblems)}` : '· all flagged',
  );
  console.log('  index issues          ', indexCoverage.issues);
  if (indexCoverage.osm) {
    const osm = indexCoverage.osm;
    console.log(
      '  OSM sector pull       ', `${osm.lights} lights, ${osm.drawable} drawable, ${osm.undrawable} undrawable`,
    );
    console.log('  missing from index    ', osm.missingFromIndex, '· pull date', osm.timestamp);
  }
}
console.log('  issues                ', report.findingsByIssue);
if (findings.length > 0) {
  console.log('\nSample affected lights:');
  for (const finding of findings.slice(0, 12)) {
    console.log(
      `  ${finding.id} ${finding.name ?? '(unnamed)'} ${finding.lat.toFixed(4)},${finding.lon.toFixed(4)} ` +
        `${finding.drawn}/${finding.sectors} drawn · ${finding.issues.join(', ')}`,
    );
  }
}
console.log('\nRaw snapshot sector tags', rawSectorTags, '· lights losing all arcs', rawLosses.length);

if (outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(report, null, 1)}\n`);
  console.log(`Report written to ${outPath}`);
}
