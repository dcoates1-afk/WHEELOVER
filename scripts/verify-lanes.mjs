#!/usr/bin/env node
/**
 * Focused browser check for the ferry and TSS overlays.
 *
 *   node scripts/verify-lanes.mjs [baseUrl]
 *
 * The overlays are chart data, so "switched on" is not the same as "visible":
 * this opens the chart with both lane layers on, then proves the routes reach
 * the screen at the places they are charted — the Solent for ferries, the
 * Channel and the Dover Strait for traffic separation schemes. Pixel counts are
 * taken from a real screenshot, so a layer that is added to the map but drawn
 * invisibly (or under another pane) fails here.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:3000';
const artifacts = new URL('../artifacts/', import.meta.url).pathname;
mkdirSync(artifacts, { recursive: true });

process.exitCode = 0;
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

// Only the lane layers, so nothing else can account for a coloured pixel.
const LANE_PREFS = {
  base: 'osm',
  overlays: {
    openseamap: false,
    navaids: false,
    ferries: true,
    tss: true,
    ais: false,
    contours: false,
    soundings: false,
    depthLabels: false,
    pois: false,
  },
};

// The same chart with the lanes never switched on: whatever the base map's own
// pixels add to the colour counts, they are measured rather than guessed.
const BASELINE_PREFS = {
  ...LANE_PREFS,
  overlays: { ...LANE_PREFS.overlays, ferries: false, tss: false },
};

const VIEWS = {
  solent: { lat: 50.75, lon: -1.25, z: 12, file: 'lanes-solent.png' },
  casquets: { lat: 49.95, lon: -2.65, z: 11, file: 'lanes-casquets-ts.png' },
  dover: { lat: 51.05, lon: 1.35, z: 10, file: 'lanes-dover-ts.png' },
  night: {
    lat: 50.75,
    lon: -1.25,
    z: 12,
    file: 'lanes-night.png',
    prefs: { ...LANE_PREFS, theme: 'night' },
  },
};

async function openChart(browser, view, prefs = LANE_PREFS) {
  const context = await browser.newContext({ viewport: { width: 1000, height: 760 } });
  await context.addInitScript((value) => {
    localStorage.setItem('wheel-over:chart-prefs', JSON.stringify(value));
  }, prefs);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${baseUrl}/?lat=${view.lat}&lon=${view.lon}&z=${view.z}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForSelector(prefs.overlays.ferries ? '.leaflet-lanes-pane svg' : '.leaflet-container', {
    timeout: 25_000,
  });
  // The 190 routes are all added at mount; give the symbol layer time to paint.
  await page.waitForTimeout(2500);
  return { page, context, errors };
}

/** Count chart pixels in the three lane colours. */
async function sampleLaneColours(page) {
  const shot = await page.screenshot();
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let ferries = 0;
    let tssLanes = 0;
    let tssZones = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      // #8ff0ff ferry core: a bright cyan no chart base or seamark produces.
      if (g > 225 && b > 240 && b - r > 90) ferries += 1;
      // #ff7ad1 lane edge.
      if (r > 230 && b > 175 && g < 165 && r - g > 80) tssLanes += 1;
      // #ffd24a separation zone edge.
      if (r > 230 && g > 185 && b < 115) tssZones += 1;
    }
    return { ferries, tssLanes, tssZones };
  }, shot.toString('base64'));
}

async function layerInfo(page) {
  return page.evaluate(() => {
    const pane = document.querySelector('.leaflet-lanes-pane');
    const paths = pane ? Array.from(pane.querySelectorAll('path')) : [];
    const strokes = paths.map((path) => (path.getAttribute('stroke') || '').toLowerCase());
    return {
      paths: paths.length,
      ferries: strokes.filter((stroke) => stroke === '#8ff0ff').length,
      lanes: strokes.filter((stroke) => stroke === '#ff7ad1').length,
      zones: strokes.filter((stroke) => stroke === '#ffd24a').length,
      halo: pane?.querySelector('svg') ? getComputedStyle(pane.querySelector('svg')).filter : '',
      paneFilter: pane ? getComputedStyle(pane).filter : '',
      attribution: document.querySelector('.leaflet-control-attribution')?.textContent ?? '',
    };
  });
}

async function run() {
  const browser = await chromium.launch();
  try {
    for (const [name, view] of Object.entries(VIEWS)) {
      const { page, context, errors } = await openChart(browser, view, view.prefs ?? LANE_PREFS);
      const info = await layerInfo(page);
      const colours = await sampleLaneColours(page);
      await page.screenshot({ path: `${artifacts}${view.file}` });

      check(`${name}: lane geometry is on the chart`, info.paths > 10, `${info.paths} paths`);
      check(`${name}: lane pane carries a dark halo`, /drop-shadow/.test(info.halo), info.halo);
      check(
        `${name}: lane attribution is credited`,
        /Ferry routes & TSS: OpenStreetMap/.test(info.attribution),
        info.attribution.trim().slice(-60),
      );

      if (name === 'solent') {
        check('solent: ferry routes are drawn', info.ferries > 20, `${info.ferries} ferry lines`);
        check(
          'solent: ferry ink reaches the screen',
          colours.ferries > 200,
          `${colours.ferries} cyan pixels`,
        );
      } else if (name === 'night') {
        // Night dims the lane pane rather than hiding it, so the ink is checked
        // by geometry and by the dimming filter, not by the day-time colour.
        check('night: ferry routes are drawn', info.ferries > 20, `${info.ferries} ferry lines`);
        check(
          'night: lane pane is dimmed, not hidden',
          /brightness\(0\.85\)/.test(info.paneFilter),
          info.paneFilter,
        );
      } else {
        check(`${name}: TSS lanes are drawn`, info.lanes + info.zones > 3, `${info.lanes} edges, ${info.zones} zones`);
        check(
          `${name}: TSS ink reaches the screen`,
          colours.tssLanes + colours.tssZones > 200,
          `${colours.tssLanes} magenta, ${colours.tssZones} amber pixels`,
        );
      }
      check(`${name}: no page errors`, errors.length === 0, errors.join(' | '));
      await context.close();
    }

    // Switching the overlays off must take the ink and the credit away again.
    const { page, context } = await openChart(browser, VIEWS.solent);
    await page.locator('.menu-button').click();
    await page.waitForSelector('.menu-panel');
    for (const label of ['Ferry lanes', 'TSS lanes']) {
      await page.locator('.menu-row', { hasText: label }).first().click();
      await page.waitForTimeout(150);
    }
    await page.locator('.menu-panel .icon-button').first().click();
    await page.waitForTimeout(900);
    const offColours = await sampleLaneColours(page);
    const off = await layerInfo(page);
    await context.close();

    const baseline = await openChart(browser, VIEWS.solent, BASELINE_PREFS);
    const baselineColours = await sampleLaneColours(baseline.page);
    await baseline.context.close();

    check(
      'switching lanes off removes their ink',
      offColours.ferries <= baselineColours.ferries + 20 &&
        offColours.tssLanes <= baselineColours.tssLanes + 20,
      `${offColours.ferries} cyan / ${offColours.tssLanes} magenta vs ${baselineColours.ferries}/${baselineColours.tssLanes} with the overlays never on`,
    );
    check(
      'switching lanes off removes their credit',
      !/Ferry routes & TSS/.test(off.attribution),
      off.attribution.trim().slice(-60),
    );
  } finally {
    await browser.close();
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} lane checks passed`);
  if (failed.length) process.exitCode = 1;
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
