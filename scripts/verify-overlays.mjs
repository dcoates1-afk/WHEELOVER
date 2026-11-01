#!/usr/bin/env node
/**
 * Worldwide overlay audit for WHEELOVER.
 *
 *   node scripts/verify-overlays.mjs [baseUrl]
 *
 * Opens the chart at a set of sample views around the world — traffic
 * separation schemes, dense harbours, bridge and protected-area waters — and
 * checks that every layer the archive holds for that view actually reaches the
 * chart: TSS lanes, ferry routes, navigation marks, tidal bridges and marine
 * areas. A layer that the loader can see but the chart does not draw is a
 * failure, which is exactly the "missing lanes / missing marks" symptom.
 */
import { chromium } from 'playwright';

const baseUrl = (process.argv[2] ?? 'http://127.0.0.1:3000').replace(/\/?$/, '/');
/** `--only=<label substring>` rechecks a single view instead of the whole world. */
const only = (process.argv.find((arg) => arg.startsWith('--only=')) ?? '').slice('--only='.length).toLowerCase();
const results = [];
const failures = [];

function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok) });
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

/** Views where the archive is known to hold each layer. */
const views = [
  { label: 'Dover Strait', lat: 51.05, lon: 1.45, zoom: 11, tss: true },
  { label: 'Ushant', lat: 48.45, lon: -5.05, zoom: 10, tss: true },
  { label: 'Cape Roca', lat: 38.7, lon: -9.45, zoom: 10, tss: true },
  { label: 'Gibraltar', lat: 36.0, lon: -5.5, zoom: 11, tss: true },
  { label: 'Suez', lat: 30.0, lon: 32.55, zoom: 10, tss: true },
  { label: 'Malacca', lat: 1.3, lon: 103.4, zoom: 10, tss: true },
  { label: 'Singapore', lat: 1.2, lon: 103.85, zoom: 11, tss: true },
  { label: 'Bosporus', lat: 41.1, lon: 29.1, zoom: 12, tss: true },
  { label: 'Tokyo Bay', lat: 35.3, lon: 139.85, zoom: 11, tss: true },
  { label: 'San Francisco', lat: 37.8, lon: -122.45, zoom: 11, tss: true },
  { label: 'Solent', lat: 50.76, lon: -1.28, zoom: 13, tss: false },
  { label: 'Portsmouth', lat: 50.79, lon: -1.1, zoom: 14, tss: false },
  { label: 'New York', lat: 40.6, lon: -74.02, zoom: 12, tss: false },
  { label: 'Hong Kong', lat: 22.29, lon: 114.17, zoom: 12, tss: true },
  { label: 'Southampton Water', lat: 50.9, lon: -1.38, zoom: 14, tss: false, bridges: true, slow: true },
  { label: 'Solent marine areas', lat: 50.72, lon: -1.05, zoom: 10, tss: false, areas: true, slow: true },
  // Sparse and remote waters: these are where a mark layer that depends on the
  // live query rather than the archive shows up as empty.
  { label: 'Cape Town', lat: -33.9, lon: 18.44, zoom: 12, tss: false },
  { label: 'Rio de Janeiro', lat: -22.9, lon: -43.16, zoom: 12, tss: false },
  { label: 'Buenos Aires', lat: -34.6, lon: -58.36, zoom: 12, tss: false },
  { label: 'Panama Canal', lat: 8.98, lon: -79.58, zoom: 12, tss: false },
  { label: 'Auckland', lat: -36.84, lon: 174.77, zoom: 12, tss: false },
  { label: 'Sydney', lat: -33.85, lon: 151.22, zoom: 12, tss: false },
  { label: 'Mumbai', lat: 18.93, lon: 72.84, zoom: 12, tss: false },
  { label: 'Lagos', lat: 6.44, lon: 3.39, zoom: 12, tss: false },
  { label: 'Reykjavik', lat: 64.15, lon: -21.94, zoom: 12, tss: false },
  { label: 'Honolulu', lat: 21.3, lon: -157.87, zoom: 12, tss: false },
  { label: 'Suva', lat: -18.14, lon: 178.42, zoom: 12, tss: false },
  { label: 'Valletta', lat: 35.9, lon: 14.51, zoom: 12, tss: false },
];

const TSS_STROKES = ['#ff7ad1', '#ffd24a', '#f4faff', '#e2f2fb'];

/**
 * The bounds the chart is showing, computed from the deep link and the viewport.
 * Reading them from React internals only works against the dev server, because a
 * production bundle minifies the component names.
 */
function viewBounds(page, { lat, lon, zoom }) {
  return page.evaluate(
    ({ lat, lon, zoom }) => {
      const tile = 256;
      const scale = tile * 2 ** zoom;
      const merc = (value) => {
        const sin = Math.sin((value * Math.PI) / 180);
        return 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
      };
      const width = window.innerWidth;
      const height = window.innerHeight;
      const worldX = ((lon + 180) / 360) * scale;
      const worldY = merc(lat) * scale;
      const toLat = (y) => {
        const n = Math.PI - (2 * Math.PI * y) / scale;
        return (180 / Math.PI) * Math.atan(Math.sinh(n));
      };
      return [
        toLat(worldY + height / 2),
        ((worldX - width / 2) / scale) * 360 - 180,
        toLat(worldY - height / 2),
        ((worldX + width / 2) / scale) * 360 - 180,
      ];
    },
    { lat, lon, zoom },
  );
}

/** What the archive holds for the view, read straight from the published files. */
async function archiveCounts(page, bounds) {
  return page.evaluate(async (bounds) => {
    const [south, west, north, east] = bounds;
    const intersects = (a) => a[0] <= north && a[2] >= south && a[1] <= east && a[3] >= west;
    const manifest = await (await fetch('/marine-db/manifest.json')).json();
    const counts = { tss: 0, ferries: 0, navaids: 0, bridges: 0 };
    for (const layer of ['navaids', 'ferries', 'tss']) {
      const shards = (manifest.layers[layer]?.shards ?? []).filter((shard) => intersects(shard.bounds));
      const seen = new Set();
      for (const shard of shards) {
        let payload = null;
        try {
          payload = await (await fetch(`/marine-db/${shard.path}`)).json();
        } catch {
          continue;
        }
        for (const feature of payload.features ?? []) {
          if (!intersects(feature.bounds) || seen.has(feature.id)) continue;
          seen.add(feature.id);
          counts[layer] += 1;
        }
      }
    }
    return counts;
  }, bounds);
}

/** Drawn layers, and the counts the app itself received for the same view. */
async function readChart(page) {
  return page.evaluate(async () => {
    const root = document.getElementById('root');
    const key = Object.keys(root).find((name) => name.startsWith('__reactContainer$'));
    let props = null;
    const walk = (fiber) => {
      if (!fiber) return;
      const memo = fiber.memoizedProps;
      if (memo && memo.marineFeatures !== undefined) props = memo;
      walk(fiber.child);
      walk(fiber.sibling);
    };
    walk(key ? root[key] : null);

    const paths = [...document.querySelectorAll('.leaflet-pane path')];
    const strokes = paths.map((path) => (path.getAttribute('stroke') ?? '').toLowerCase());
    // Marine areas are drawn in the default overlay pane, one colour per group;
    // the calling-in lines share their dash pattern, so they are matched out.
    const AREA_STROKES = ['#8a54c7', '#1f7a6a', '#c2603f', '#a87c36', '#c22b2b', '#8a2b2b'];
    const drawn = {
      tss: strokes.filter((stroke) => ['#ff7ad1', '#ffd24a', '#f4faff', '#e2f2fb'].includes(stroke)).length,
      ferries: strokes.filter((stroke) => stroke === '#8ff0ff').length,
      marks: document.querySelectorAll('.marnav-mark-wrap').length,
      bridges: strokes.filter((stroke) => stroke === '#152c3a').length,
      areas: strokes.filter((stroke) => AREA_STROKES.includes(stroke)).length,
      sectorFills: document.querySelectorAll('.marnav-light-sector-fill').length,
    };

    return { drawn, marineFeatures: props ? props.marineFeatures : null };
  });
}

async function settle(page, slow = false) {
  await page.waitForSelector('.leaflet-container', { timeout: 45_000 });
  // Some views legitimately hold nothing at their zoom (open water, or a zoom
  // below the marks' declutter threshold), so an empty mark layer is not itself
  // an error: wait for one to appear when it is coming, then let the checks
  // compare what was drawn with what the archive holds.
  await page
    .waitForFunction(() => document.querySelectorAll('.marnav-mark-wrap').length > 0, null, { timeout: 20_000 })
    .catch(() => {});
  // Bridges and marine areas come from a live Overpass query, which routinely
  // takes half a minute; the archive layers settle in a couple of seconds.
  await page.waitForTimeout(slow ? 60_000 : 3500);
}

async function run() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  // A cold dev server has to transform the chart modules and read the archive
  // index before the first view paints, which can take a while on a busy disk.
  page.setDefaultTimeout(45_000);

  for (const view of views) {
    if (only && !view.label.toLowerCase().includes(only)) continue;
    const url = `${baseUrl}app?lat=${view.lat}&lon=${view.lon}&z=${view.zoom}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    try {
      await settle(page, view.slow);
    } catch {
      check(`${view.label}: chart draws marks`, false, 'no marks rendered');
      continue;
    }
    const state = await readChart(page);
    const { drawn } = state;
    // A view that draws nothing at all is a failure even where the archive is
    // thin, so the mark check runs before the expected counts are read.
    check(`${view.label}: chart draws marks`, drawn.marks > 0, `${drawn.marks} marks`);
    let expected;
    try {
      expected = await archiveCounts(page, await viewBounds(page, view));
    } catch (error) {
      check(`${view.label}: archive reads`, false, String(error && error.message ? error.message : error));
      continue;
    }
    check(
      `${view.label}: marks match the archive`,
      (expected.navaids === 0 && drawn.marks === 0) ||
        (expected.navaids > 0 && drawn.marks > 0),
      `${drawn.marks} drawn of ${expected.navaids} charted`,
    );
    if (expected.tss > 0) {
      check(`${view.label}: TSS lanes draw`, drawn.tss > 0, `${drawn.tss} paths for ${expected.tss} features`);
    } else if (view.tss) {
      check(`${view.label}: TSS present in archive`, false, 'archive holds no TSS for this view');
    }
    if (expected.ferries > 0) {
      check(`${view.label}: ferry routes draw`, drawn.ferries > 0, `${drawn.ferries} paths for ${expected.ferries} routes`);
    }
    if (view.bridges) {
      check(`${view.label}: bridge marks draw`, drawn.bridges > 0, `${drawn.bridges} bridges`);
    }
    if (view.areas) {
      check(`${view.label}: marine-area outlines draw`, drawn.areas > 0, `${drawn.areas} outlines`);
    }
  }

  // The lane geometry has to be inspectable: a lane that cannot open its own
  // reference popup is "not working" even when it is painted.
  await page.goto(`${baseUrl}app?lat=51.05&lon=1.45&z=11`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  const popup = await page.evaluate(() => {
    const path = [...document.querySelectorAll('.leaflet-lanes-pane path')].find((element) =>
      ['#ff7ad1', '#ffd24a'].includes(element.getAttribute('stroke')),
    );
    if (!path) return 'no lane path';
    const rect = path.getBoundingClientRect();
    path.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        clientX: rect.x + rect.width / 2,
        clientY: rect.y + rect.height / 2,
        view: window,
      }),
    );
    return document.querySelector('.leaflet-popup-content')?.textContent ?? 'no popup';
  });
  check('a TSS lane opens its reference popup', popup.length > 20, popup.slice(0, 80));

  // A mark has to open the reference sheet from the chart.
  await page.evaluate(() => {
    const marker = document.querySelector('.marnav-mark-wrap');
    if (marker) marker.dispatchEvent(new MouseEvent('click', { bubbles: true, view: window }));
  });
  const sheetText = await page
    .locator('.navaid-sheet')
    .textContent({ timeout: 5000 })
    .catch(() => '');
  check(
    'a chart mark opens its reference sheet',
    /Centre chart on mark/i.test(sheetText),
    (sheetText ?? '').replace(/\s+/g, ' ').slice(0, 70),
  );

  await browser.close();
  console.log(`\n${results.length - failures.length}/${results.length} checks passed`);
  if (failures.length) {
    console.log('Failures:');
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error(`overlay audit failed: ${error.message}`);
  process.exitCode = 1;
});
