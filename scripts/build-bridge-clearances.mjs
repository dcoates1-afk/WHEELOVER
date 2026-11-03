/**
 * Build the bridge-clearance dataset the app's bridge cards read from.
 *
 * Sources (all free, all public):
 *  - NOAA ENC Direct to GIS (US coastal waters): BRIDGE line + area layers
 *    in the harbour, approach, coastal and general bands. VERCLR/VERCCL/VERCOP
 *    are metres above Mean High Water (Coast Pilot rule) unless a per-feature
 *    VERDAT says otherwise; the dataset keeps VERDAT so the card can show it.
 *  - USACE Inland ENC (US rivers): BRIDGE_AREA layer. Clearances in metres;
 *    the GIS feed carries no datum, so these are stored datum-not-stated.
 *  - EuRIS Bridge API (13 European waterway authorities): bridge names,
 *    waterway, hectometre, closed/open heights in centimetres. No coordinates
 *    and no datum in the response, so these join by name + waterway and are
 *    stored datum-not-stated.
 *  - viadonau Danube bridge list (PDF table): heights above HNWL (highest
 *    navigable water level) with the reference gauge per bridge. Joins by name
 *    to bridges crossing the Danube.
 *
 * Output: public/bridge-clearances/{noaa,usace,euris,danube}.json plus
 * manifest.json with the retrieval date. The files are static: the client
 * fetches them once (cached) and joins records to displayed bridges locally,
 * so panning never waits on four more live services.
 *
 * NOAA ENC Direct is flaky (intermittent 500s, whole layers briefly
 * unavailable), so every paged fetch is retried with backoff, progress is
 * saved per layer under /tmp/bridge-clearances-partial, and a layer that
 * still fails is recorded in the manifest instead of aborting the whole
 * build — rerun the script later to fill the gap.
 *
 * Run: node scripts/build-bridge-clearances.mjs
 * Requires: network access to the four sources; pdftotext for the Danube PDF.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = 'public/bridge-clearances';
// Progress lives beside the repo, not in the OS temp dir: the runtime
// clears /tmp, which wiped a running build's resume files mid-flight.
const PARTIAL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bridge-clearances-partial');
const DANUBE_PDF_URL =
  'https://www.viadonau.org/fileadmin/content/viadonau/05Wirtschaft/Dokumente/2022/20220311_Danube_bridges_int._final.pdf';

/** NOAA ENC Direct is flaky (intermittent 500s), so retry generously. */
async function fetchJson(url, tries = 10) {
  let delay = 1000;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        // A hung connection must not stall the build forever.
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

function round2(value) {
  return Math.round(value * 100) / 100;
}

/** Centroid of an Esri polyline/polygon geometry — good enough for a join. */
function centroid(geometry) {
  const rings = geometry?.paths ?? geometry?.rings ?? [];
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
  return { lo: round2(sx / n), la: round2(sy / n) };
}

function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? round2(n) : null;
}

/**
 * Page an ArcGIS layer by OBJECTID (resumable: already-fetched ids are kept
 * in a partial file, so a rerun after a flaky failure only fetches the rest).
 * Returns { records, complete } — complete is false when the layer still
 * failed after all retries, in which case records hold what was fetched.
 */
async function queryArcGisPaged(name, base, where, outFields, mapRecord, idField = 'OBJECTID') {
  mkdirSync(PARTIAL_DIR, { recursive: true });
  const partialPath = join(PARTIAL_DIR, `${name}.jsonl`);
  let records = [];
  let lastId = 0;
  if (existsSync(partialPath)) {
    // Earlier runs paged with an unparenthesised OR where clause, which
    // re-fetched records and left duplicates in partials. Keep the first
    // copy of each id so a resume never carries those forward.
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
        // Parenthesised on purpose: AND binds tighter than OR, so an
        // unparenthesised OR where clause silently ignores the id filter
        // for every branch but the last — pages then repeat records and
        // the layer count inflates with duplicates.
        where: `(${where}) AND ${idField} > ${lastId}`,
        outFields,
        returnGeometry: 'true',
        orderByFields: `${idField} ASC`,
        resultRecordCount: String(pageSize),
        f: 'json',
      });
      const data = await fetchJson(`${base}/query?${params}`);
      const features = data.features ?? [];
      const prevLastId = lastId;
      for (const feature of features) {
        const point = centroid(feature.geometry);
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
      // Only an empty page ends the layer. The service cuts pages short at
      // its transfer limit (~211 features) without flagging it, so breaking
      // on a short page silently drops the tail — the previous run stopped
      // harbour/87 at 211 of 631+ that way. OBJECTID always advances, so
      // the loop ends at the first empty page; the no-progress guard below
      // is only a safety net against a service that repeats one page.
      if (features.length === 0) break;
      if (lastId === prevLastId) break;
    }
    return { records, complete: true };
  } catch (error) {
    console.warn(`${name}: FAILED after retries (${error.message}); keeping ${records.length} fetched records`);
    return { records, complete: false };
  }
}

async function buildNoaa() {
  const bands = [
    ['enc_harbour', 87],
    ['enc_harbour', 141],
    ['enc_approach', 91],
    ['enc_approach', 146],
    ['enc_coastal', 73],
    ['enc_coastal', 108],
    ['enc_general', 61],
    ['enc_general', 77],
  ];
  const out = [];
  const failures = [];
  for (const [band, layer] of bands) {
    const base = `https://encdirect.noaa.gov/arcgis/rest/services/encdirect/${band}/MapServer/${layer}`;
    // Layers differ in which clearance fields they carry, and asking for a
    // missing field — in the where clause or outFields — makes the service
    // reject the whole query with "Invalid or missing input parameters".
    // That is what killed harbour/141 and approach/91. Ask the layer first.
    let layerFields = null;
    try {
      const info = await fetchJson(`${base}?f=json`, 3);
      layerFields = new Set((info.fields ?? []).map((field) => field.name));
    } catch {
      // Fall through with the full field list; the query then fails as
      // before and the layer is recorded incomplete.
    }
    const has = (field) => layerFields === null || layerFields.has(field);
    // The row-id field is OBJECTID on most layers, but approach/91 (and
    // possibly others) carries no OBJECTID — its id is the table's .FID
    // field. Paging on a missing id field is the other "Invalid or missing
    // input parameters" failure. With no id field at all, the layer cannot
    // be paged and is left incomplete rather than queried blindly.
    const idField = layerFields === null
      ? 'OBJECTID'
      : layerFields.has('OBJECTID')
        ? 'OBJECTID'
        : [...layerFields].find((field) => field.endsWith('.FID')) ?? null;
    if (idField === null) {
      console.warn(`NOAA ${band}/${layer}: no row-id field; skipping`);
      failures.push(`NOAA ${band}/${layer}`);
      continue;
    }
    const clearanceFields = ['VERCLR', 'VERCCL', 'VERCOP'].filter(has);
    if (clearanceFields.length === 0) {
      console.warn(`NOAA ${band}/${layer}: no clearance field on the layer; skipping`);
      failures.push(`NOAA ${band}/${layer}`);
      continue;
    }
    const where = clearanceFields.map((field) => `${field} IS NOT NULL`).join(' OR ');
    const outFields = [idField, 'OBJNAM', 'VERCLR', 'VERCCL', 'VERCOP', 'HORCLR', 'VERDAT', 'CATBRG', 'SORDAT']
      .filter((field) => field === idField || has(field))
      .join(',');
    const { records, complete } = await queryArcGisPaged(
      `noaa-${band}-${layer}`,
      base,
      where,
      outFields,
      (point, a) => {
        const v = num(a.VERCLR);
        const c = num(a.VERCCL);
        const o = num(a.VERCOP);
        if (v === null && c === null && o === null) return null;
        return {
          la: point.la,
          lo: point.lo,
          n: typeof a.OBJNAM === 'string' && a.OBJNAM.trim() !== '' ? a.OBJNAM.trim() : null,
          v,
          c,
          o,
          h: num(a.HORCLR),
          d: a.VERDAT === null || a.VERDAT === undefined || a.VERDAT === '' ? null : String(a.VERDAT),
          k: typeof a.CATBRG === 'string' ? a.CATBRG : null,
          s: a.SORDAT === null || a.SORDAT === undefined ? null : String(a.SORDAT),
        };
      },
      idField,
    );
    out.push(...records);
    console.info(`NOAA ${band}/${layer}: ${records.length} records${complete ? '' : ' (INCOMPLETE)'}`);
    if (!complete) failures.push(`NOAA ${band}/${layer}`);
  }
  return { records: out, failures };
}

async function buildUsace() {
  const base = 'https://ienccloud.us/arcgis/rest/services/IENC_Feature_Classes/BRIDGE_AREA/MapServer/92';
  const { records, complete } = await queryArcGisPaged(
    'usace-bridge-area',
    base,
    "Vertical_Clearance <> 'Unknown'",
    'OBJECTID,Object_Name,Vertical_Clearance,Vertical_Clearance_Closed,Vertical_Clearance_Open,Horizontal_Clearance,Category_of_Bridge,Source_Date,Source_Dataset,Information',
    (point, a) => {
      const v = num(a.Vertical_Clearance);
      const c = num(a.Vertical_Clearance_Closed);
      const o = num(a.Vertical_Clearance_Open);
      if (v === null && c === null && o === null) return null;
      return {
        la: point.la,
        lo: point.lo,
        n: typeof a.Object_Name === 'string' && a.Object_Name.trim() !== '' ? a.Object_Name.trim() : null,
        v,
        c,
        o,
        h: num(a.Horizontal_Clearance),
        k: typeof a.Category_of_Bridge === 'string' ? a.Category_of_Bridge : null,
        s: a.Source_Date === null || a.Source_Date === undefined ? null : String(a.Source_Date),
      };
    },
  );
  console.info(`USACE BRIDGE_AREA: ${records.length} records${complete ? '' : ' (INCOMPLETE)'}`);
  return { records, failures: complete ? [] : ['USACE BRIDGE_AREA'] };
}

async function buildEuris() {
  const data = await fetchJson('https://www.eurisportal.eu/visuris/api/Bridges/GetBridges');
  const out = [];
  for (const entry of data) {
    const f = entry.feature ?? {};
    const closedCm = Number(f.mheightcmc) || 0;
    const openCm = Number(f.mheightcm) || 0;
    if (closedCm <= 0 && openCm <= 0) continue;
    out.push({
      n: (f.objectname ?? '').trim() || null,
      w: (f.wW_NAME ?? '').trim() || null,
      hm: (f.hectom ?? '').trim() || null,
      c: closedCm > 0 ? round2(closedCm / 100) : null,
      o: openCm > 0 ? round2(openCm / 100) : null,
      wd: Number(f.mwidthcm) > 0 ? round2(Number(f.mwidthcm) / 100) : null,
      a: (f.wwauthorit ?? '').trim() || null,
      l: (f.locode ?? '').trim() || null,
    });
  }
  console.info(`EuRIS: ${out.length} bridges with a closed or open height`);
  return out;
}

function parseDanubeNumber(text) {
  if (!text || text.trim() === '––' || text.trim() === '--') return null;
  const n = Number(text.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? round2(n) : null;
}

/** Parse the viadonau table out of pdftotext -layout output. */
function buildDanube() {
  mkdirSync(PARTIAL_DIR, { recursive: true });
  const pdfPath = join(PARTIAL_DIR, 'danube-bridges.pdf');
  const txtPath = join(PARTIAL_DIR, 'danube-bridges.txt');
  execFileSync('curl', ['-s', '-o', pdfPath, DANUBE_PDF_URL], { timeout: 120000 });
  execFileSync('pdftotext', ['-layout', pdfPath, txtPath], { timeout: 60000 });
  const text = readFileSync(txtPath, 'utf8');
  const rows = [];
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*(\d+)\s+(\d)\s(\d{3}),(\d{2})\s+(.*)$/);
    if (match) {
      const rest = match[5].split(/\s{2,}/).map((part) => part.trim()).filter((part) => part !== '');
      // Columns after the river-km: RB, LB+name (LB merges into the name
      // column because it is one space from it), use, height, width,
      // direction, [second passageway height, width, direction], HNWL gauge,
      // [notes]. LB is a two-letter country code at the start of the name col.
      const rb = rest[0] ?? '';
      let name = rest[1] ?? '';
      name = name.replace(/^[A-Z]{2}\s+/, '');
      const use = rest[2] ?? '';
      const h1 = parseDanubeNumber(rest[3]);
      const w1 = parseDanubeNumber(rest[4]);
      const d1 = rest[5] ?? '';
      let h2 = null;
      let w2 = null;
      let d2 = '';
      let gauge = '';
      let notes = '';
      const tail = rest.slice(6);
      if (tail.length >= 3 && (parseDanubeNumber(tail[0]) !== null || tail[0] === '––')) {
        h2 = parseDanubeNumber(tail[0]);
        w2 = parseDanubeNumber(tail[1]);
        d2 = tail[2] ?? '';
        gauge = tail[3] ?? '';
        notes = tail.slice(4).join(' ');
      } else {
        gauge = tail[0] ?? '';
        notes = tail.slice(1).join(' ');
      }
      // A gauge reads as a level plus a place (or an impounded level). A
      // shifted column can land a notes fragment here instead (one row
      // carries 'Height at crest: 9.24'); a fragment is not a gauge, so
      // blank it rather than print it on a card as one.
      if (gauge !== '' && !/^(Impounded water level |\d+(\.\d+)?\s*(cm|m a\. A\.))/.test(gauge)) gauge = '';
      rows.push({
        km: round2(Number(`${match[2]}${match[3]}.${match[4]}`)),
        rb,
        n: name,
        use,
        h1,
        w1,
        d1,
        h2,
        w2,
        d2,
        g: gauge,
        nt: notes,
      });
    }
    // Non-row lines are ignored: the PDF's end matter (side-arm tables in a
    // different layout, canal notes, abbreviations, sources) must not be
    // absorbed into the last bridge's notes, and the Borcea side-arm table
    // is not parsed — its river-km system differs from the main list.
  }
  const kept = rows.filter((row) => row.h1 !== null);
  console.info(`Danube list: ${kept.length} bridges with a passageway height`);
  return kept;
}

const generatedAt = new Date().toISOString().slice(0, 10);
mkdirSync(OUT_DIR, { recursive: true });
const failures = [];

// The same crossing can appear in several bands, so identical records
// recur across layers. Collapse them: the join dedupes values anyway,
// but the file and its counts should state distinct records, not rows.
function dedupe(records) {
  return [...new Map(records.map((record) => [JSON.stringify(record), record])).values()];
}

const noaa = await buildNoaa();
failures.push(...noaa.failures);
const noaaRecords = dedupe(noaa.records);
writeFileSync(join(OUT_DIR, 'noaa.json'), JSON.stringify(noaaRecords));
const usace = await buildUsace();
failures.push(...usace.failures);
const usaceRecords = dedupe(usace.records);
writeFileSync(join(OUT_DIR, 'usace.json'), JSON.stringify(usaceRecords));
let euris = [];
try {
  euris = await buildEuris();
} catch (error) {
  console.warn(`EuRIS: FAILED (${error.message})`);
  failures.push('EuRIS GetBridges');
}
writeFileSync(join(OUT_DIR, 'euris.json'), JSON.stringify(dedupe(euris)));
let danube = [];
try {
  danube = buildDanube();
} catch (error) {
  console.warn(`Danube list: FAILED (${error.message})`);
  failures.push('viadonau Danube list');
}
writeFileSync(join(OUT_DIR, 'danube.json'), JSON.stringify(dedupe(danube)));

const manifest = {
  generatedAt,
  sources: {
    noaa: { label: 'NOAA ENC', datum: 'MHW', count: noaaRecords.length },
    usace: { label: 'USACE Inland ENC', datum: null, count: usaceRecords.length },
    euris: { label: 'EuRIS', datum: null, count: dedupe(euris).length },
    danube: { label: 'viadonau Danube list', datum: 'HNWL', count: dedupe(danube).length },
  },
  incomplete: failures,
};
writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.info(JSON.stringify(manifest, null, 2));
if (failures.length > 0) {
  console.info('NOTE: rerun this script later to fill the incomplete layers; progress is saved and resumes.');
}
