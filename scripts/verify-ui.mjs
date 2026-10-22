#!/usr/bin/env node
/**
 * Browser verification for WHEELOVER.
 *
 *   node scripts/verify-ui.mjs [baseUrl]
 *
 * Checks the chart fills the viewport, nothing overflows horizontally, every
 * on-screen button is a touch target, the single menu exposes every section,
 * NAVAID hover/quick-info and reference sheet work, and the AIS, COLREGs and
 * weather stations load real content. Screenshots land in artifacts/.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:3000';
const artifacts = new URL('../artifacts/', import.meta.url).pathname;
mkdirSync(artifacts, { recursive: true });

const results = [];
const consoleErrors = [];
const failedRequests = [];
// Tile requests cancelled by a pan or a legitimate recentre are not failures.
const cancelledRequests = [];
let activeBrowser = null;

function check(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition), detail });
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function waitForChart(page) {
  await page.waitForSelector('.leaflet-container');
  await page.waitForFunction(() => document.querySelectorAll('.marnav-mark-wrap').length > 20, null, {
    timeout: 30_000,
  });
  await page.waitForTimeout(900);
}

async function openMenu(page) {
  const button = page.locator('.menu-button');
  if ((await page.locator('.menu-panel').count()) === 0) await button.click();
  await page.waitForSelector('.menu-panel');
}

async function closeMenu(page) {
  const close = page.locator('.menu-panel .icon-button').first();
  if (await close.count()) await close.click();
  await page.waitForTimeout(200);
}

async function run() {
  const browser = await chromium.launch();
  activeBrowser = browser;
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    // Cowes waterfront: the chart opens here, and the view contains both land
    // and water so theme contrast can be measured meaningfully.
    geolocation: { latitude: 50.7668, longitude: -1.2833, accuracy: 8 },
    permissions: ['geolocation'],
  });
  const page = await context.newPage();
  page.setDefaultTimeout(9000);
  page.setDefaultNavigationTimeout(20_000);
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => {
    const url = request.url();
    const failure = request.failure()?.errorText ?? 'unknown';
    if (url.includes('aisstream') || url.includes('ws://')) return;
    if (failure.includes('ERR_ABORTED')) {
      cancelledRequests.push(url);
      return;
    }
    failedRequests.push(`${failure} ${url}`);
  });

  // Record the chart bounds the client asks the AIS relay to follow.
  const sentBounds = [];
  const recordBounds = (target, sink) => {
    target.on('websocket', (ws) => {
      ws.on('framesent', (frame) => {
        if (typeof frame.payload !== 'string') return;
        try {
          const message = JSON.parse(frame.payload);
          if (message?.type === 'bounds' && Array.isArray(message.bounds)) sink.push(message.bounds);
        } catch {
          // Not a JSON frame; ignore.
        }
      });
    });
  };
  recordBounds(page, sentBounds);

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await waitForChart(page);

  // 1. Phone layout
  const layout = await page.evaluate(() => {
    const map = document.querySelector('.marnav-map')?.getBoundingClientRect();
    const root = document.documentElement;
    return {
      map: map ? { width: Math.round(map.width), height: Math.round(map.height) } : null,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scrollWidth: root.scrollWidth,
      leafletZoom: document.querySelectorAll('.leaflet-control-zoom').length,
      gpsPanels: document.querySelectorAll('.gps-widget').length,
    };
  });
  check(
    'chart fills the phone viewport exactly',
    layout.map && Math.abs(layout.map.width - layout.viewport.width) <= 1 && Math.abs(layout.map.height - layout.viewport.height) <= 1,
    JSON.stringify(layout.map),
  );
  check('no horizontal overflow on phone', layout.scrollWidth <= layout.viewport.width + 1, `${layout.scrollWidth}px`);
  check(
    'Leaflet’s own zoom control is not duplicated',
    layout.leafletZoom === 0,
    `${layout.leafletZoom} leaflet zoom controls`,
  );
  check('position panel stays opt-in', layout.gpsPanels === 0, `${layout.gpsPanels} panels`);

  const undersized = await page.evaluate(() => {
    const bad = [];
    for (const button of document.querySelectorAll('button')) {
      const rect = button.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if ($0_isLeaflet(button)) continue;
      if (rect.height < 44) bad.push(`${button.textContent?.trim().slice(0, 24) || 'icon'} ${rect.height.toFixed(0)}px`);
    }
    function $0_isLeaflet(element) {
      return Boolean(element.closest('.leaflet-control'));
    }
    return bad;
  });
  check('every visible control is at least 44px tall', undersized.length === 0, undersized.join(', '));

  // The seed extract paints first and the shard/live query replaces it a moment
  // later, so sample once the chart has settled rather than mid-swap.
  await page.waitForFunction(() => document.querySelectorAll('.marnav-mark-wrap').length > 20, null, {
    timeout: 15_000,
  });
  const markerCount = await page.locator('.marnav-mark-wrap').count();
  check('NAVAID markers render from the database', markerCount > 20, `${markerCount} markers`);

  await page.screenshot({ path: `${artifacts}phone-chart.png` });

  // 2. Single menu
  console.log('step: menu');
  await openMenu(page);
  const menuText = await page.locator('.menu-panel').textContent();
  for (const section of ['Base chart', 'Overlays', 'Public places', 'Vessel position', 'Stations', 'Mark database']) {
    check(`menu exposes “${section}”`, menuText.includes(section));
  }
  check(
    'menu offers standard, satellite, nautical, relief and NOAA bases',
    ['Standard chart', 'Satellite', 'Nautical', 'Relief', 'NOAA ENC', 'NOAA Raster'].every((label) =>
      menuText.includes(label),
    ),
  );
  check('USACE inland base has been removed', !menuText.includes('USACE'));
  check(
    'menu no longer carries chart actions',
    !menuText.includes('Chart actions') && !menuText.includes('Zoom in'),
    'zoom and centre now live on the chart',
  );
  check(
    'menu offers chart, depth and seamark overlays',
    [
      'Depth contours',
      'Depth numbers',
      'Charted soundings',
      'OpenSeaMap seamarks',
      'NAVAIDs from database',
      'Ferry lanes',
      'TSS lanes',
    ].every((label) => menuText.includes(label)),
  );
  check('depth shading overlay has been removed', !menuText.includes('Depth shading'));
  check(
    'menu states the depth measurement units and types',
    ['Depth measurements', 'Metres below sea level', "chart's printed unit"].every((text) =>
      menuText.includes(text),
    ),
    'metres for modelled numbers, chart unit for NOAA soundings',
  );
  await page.locator('.legend summary').click();
  await page.waitForTimeout(300);
  const legendText = await page.locator('.legend').textContent();
  check(
    'symbol key names major and minor lights separately',
    /Major light/.test(legendText) && /Minor light/.test(legendText),
  );
  const legendSvgs = await page
    .locator('.legend-item .legend-symbol')
    .evaluateAll((elements) => elements.slice(0, 2).map((element) => element.innerHTML));
  check(
    'major and minor light symbols render differently',
    legendSvgs.length === 2 && legendSvgs[0] !== legendSvgs[1],
  );
  check(
    'symbol key covers anchorage and bifurcation marks',
    /Anchorage/.test(legendText) && /Bifurcation \(port\)/.test(legendText) && /Bifurcation \(starboard\)/.test(legendText),
  );
  const keySvgs = await page
    .locator('.legend-item')
    .evaluateAll((items) =>
      items.map((item) => ({
        label: item.textContent?.trim() ?? '',
        svg: item.querySelector('.legend-symbol')?.innerHTML ?? '',
      })),
    );
  const keyFor = (needle) => keySvgs.find((entry) => entry.label.includes(needle))?.svg ?? '';
  check(
    'bifurcation key differs from the safe-water ball',
    keyFor('Bifurcation (port)') !== '' && keyFor('Bifurcation (port)') !== keyFor('Safe water'),
  );
  check('anchorage key draws an anchor ground', keyFor('Anchorage').includes('stroke-dasharray'));
  await page.screenshot({ path: `${artifacts}phone-menu.png` });

  // Display themes: night dims, red protects night vision, day is the default.
  console.log('step: themes');
  await page.locator('.segmented-three button', { hasText: 'Night' }).click();
  await page.waitForTimeout(250);
  check('night theme applies to the app shell', (await page.locator('.app.theme-night').count()) === 1);
  await closeMenu(page);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${artifacts}phone-night.png` });

  await openMenu(page);
  await page.locator('.segmented-three button', { hasText: 'Red' }).click();
  await page.waitForTimeout(250);
  check('red theme applies to the app shell', (await page.locator('.app.theme-red').count()) === 1);
  const redAccent = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.app')).getPropertyValue('--accent').trim(),
  );
  check('red theme switches the accent palette', redAccent.toLowerCase() === '#ff4a35', redAccent);
  const brandInk = await page.evaluate(
    () => getComputedStyle(document.querySelector('.chart-brand')).backgroundImage,
  );
  check(
    'wordmark switches to the red palette',
    brandInk.includes('rgb(255, 77, 56)') && brandInk.includes('rgb(255, 176, 164)'),
    brandInk,
  );
  await closeMenu(page);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${artifacts}phone-red.png` });

  const tint = await page.evaluate(() => {
    const el = document.querySelector('.red-tint');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { blend: cs.mixBlendMode, events: cs.pointerEvents };
  });
  check('red theme multiplies a tint layer over the chart', tint?.blend === 'multiply', JSON.stringify(tint));
  check('red tint never swallows map gestures', tint?.events === 'none', tint?.events ?? 'missing');

  // Sample the painted chart, not the UI: the point of red mode is one red ramp
  // for every pixel, dark enough to preserve night vision but still with
  // land/water and symbol contrast.
  const { width, height } = page.viewportSize();
  const shot = await page.screenshot({ clip: { x: 0, y: 180, width, height: height - 300 } });
  const redRamp = await page.evaluate(async (b64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${b64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    const reds = [];
    let redDominant = 0;
    let samples = 0;
    for (let i = 0; i < data.length; i += 4 * 13) {
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
      samples += 1;
      if (r > g && r > b) redDominant += 1;
      reds.push(r);
    }
    reds.sort((a, b) => a - b);
    const at = (q) => reds[Math.min(reds.length - 1, Math.floor(reds.length * q))];
    return {
      dominant: redDominant / samples,
      mean: reds.reduce((sum, v) => sum + v, 0) / reds.length,
      spread: at(0.95) - at(0.05),
    };
  }, shot.toString('base64'));
  check(
    'red theme paints every chart pixel on the red ramp',
    redRamp.dominant >= 0.98,
    `${(redRamp.dominant * 100).toFixed(1)}% red-dominant`,
  );
  check(
    'red theme stays dim enough for night vision',
    redRamp.mean > 40 && redRamp.mean < 175,
    `mean red ${Math.round(redRamp.mean)}`,
  );
  check(
    'red theme keeps land, water and symbols distinguishable',
    redRamp.spread >= 20,
    `red spread ${Math.round(redRamp.spread)}`,
  );

  await openMenu(page);
  await page.locator('.segmented-three button', { hasText: 'Day' }).click();
  await page.waitForTimeout(200);
  check('day theme restores the default palette', (await page.locator('.app.theme-day').count()) === 1);

  // 3. Wordmark: bare text over every base chart, never a plate, never blocking taps.
  console.log('step: brand');
  await closeMenu(page);
  const brand = page.locator('.chart-brand');
  const brandInfo = await brand.evaluate((element) => {
    const styles = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      text: element.textContent?.trim(),
      offset: Math.round(rect.x + rect.width / 2 - window.innerWidth / 2),
      background: styles.backgroundColor,
      image: styles.backgroundImage,
      border: styles.borderStyle,
      shadow: styles.boxShadow,
      events: styles.pointerEvents,
    };
  });
  check(
    'app name floats at the top centre',
    brandInfo.text === 'WHEELOVER' && Math.abs(brandInfo.offset) <= 3,
    `${brandInfo.text} offset ${brandInfo.offset}px`,
  );
  check(
    'wordmark has no plate, border or shadow',
    brandInfo.background === 'rgba(0, 0, 0, 0)' &&
      brandInfo.border === 'none' &&
      brandInfo.shadow === 'none',
    `${brandInfo.background} / ${brandInfo.border} / ${brandInfo.shadow}`,
  );
  check('wordmark never swallows map taps', brandInfo.events === 'none', brandInfo.events);
  check(
    'wordmark fades from chart blue to white',
    brandInfo.image.includes('rgb(44, 199, 255)') && brandInfo.image.includes('rgb(255, 255, 255)'),
    brandInfo.image,
  );

  // Legibility without a plate comes from the dark halo: measure how far apart
  // the lightest and darkest pixels in the mark's own box are.
  const brandToneRange = async () => {
    const box = await brand.boundingBox();
    if (!box) return 0;
    const png = await page.screenshot({
      clip: { x: Math.max(0, box.x - 4), y: Math.max(0, box.y - 4), width: box.width + 8, height: box.height + 8 },
    });
    return page.evaluate(async (b64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${b64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      const lums = [];
      for (let i = 0; i < data.length; i += 4) {
        lums.push(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
      }
      lums.sort((a, b) => a - b);
      const at = (q) => lums[Math.min(lums.length - 1, Math.floor(lums.length * q))];
      return at(0.95) - at(0.05);
    }, png.toString('base64'));
  };

  for (const base of ['Satellite', 'NOAA ENC', 'Standard chart']) {
    await openMenu(page);
    await page.locator('.menu-row', { hasText: base }).first().click();
    await closeMenu(page);
    await page.waitForTimeout(2400);
    const range = await brandToneRange();
    check(`wordmark stays legible over ${base}`, range >= 120, `tone range ${Math.round(range)}`);
  }
  await page.screenshot({ path: `${artifacts}brand-map.png` });
  // The next step toggles overlays, so leave the menu open for it.
  await openMenu(page);

  // Enable the lane overlays and close.
  for (const label of ['Ferry lanes', 'TSS lanes']) {
    const row = page.locator('.menu-row', { hasText: label }).first();
    await row.click();
    await page.waitForTimeout(150);
  }
  await closeMenu(page);
  const laneLayers = await page.evaluate(() => {
    const pane = document.querySelector('.leaflet-lanes-pane');
    const paths = pane ? Array.from(pane.querySelectorAll('path')) : [];
    const strokes = paths.map((path) => (path.getAttribute('stroke') || '').toLowerCase());
    const svg = pane?.querySelector('svg');
    return {
      total: paths.length,
      ferries: strokes.filter((stroke) => stroke === '#8ff0ff').length,
      halo: svg ? getComputedStyle(svg).filter : '',
      attribution: document.querySelector('.leaflet-control-attribution')?.textContent ?? '',
    };
  });
  check('lane overlays draw in their own chart pane', laneLayers.total > 5, `${laneLayers.total} paths`);
  check(
    'ferry routes draw as dashed cyan lines',
    laneLayers.ferries > 5,
    `${laneLayers.ferries} ferry lines`,
  );
  check(
    'lane strokes carry a dark halo so they read on every base',
    /drop-shadow/.test(laneLayers.halo),
    laneLayers.halo,
  );
  check(
    'lane overlays credit OpenStreetMap while switched on',
    /Ferry routes & TSS: OpenStreetMap/.test(laneLayers.attribution),
    laneLayers.attribution.trim().slice(-70),
  );
  await page.screenshot({ path: `${artifacts}phone-lanes.png` });

  // Outside US waters the contour toggle falls back to the global GEBCO
  // isobaths; it must draw tiles and switch off again.
  await openMenu(page);
  await page.locator('.menu-row', { hasText: 'Depth contours' }).first().click();
  await page.waitForTimeout(150);
  await closeMenu(page);
  await page.waitForTimeout(4500);
  const contourTiles = await page.evaluate(
    () => document.querySelectorAll('.leaflet-contours-pane .leaflet-tile').length,
  );
  check('global depth contours draw tiles', contourTiles > 0, `${contourTiles} tiles`);
  await page.screenshot({ path: `${artifacts}phone-contours.png` });
  await openMenu(page);
  const contourMenuText = (await page.locator('.menu-panel').textContent()) ?? '';
  check(
    'contour note explains the global fallback',
    /GEBCO/.test(contourMenuText) && /overview/.test(contourMenuText),
  );
  await page.locator('.menu-row', { hasText: 'Depth contours' }).first().click();
  await page.waitForTimeout(150);
  await closeMenu(page);

  // Depth numbers and public places load for the current view. The labels come
  // from GEBCO in one batch; the place pins come through the Overpass proxy.
  await openMenu(page);
  await page.locator('.menu-row', { hasText: 'Depth numbers' }).first().click();
  await page.locator('.menu-row', { hasText: 'Show public places' }).first().click();
  await page.waitForTimeout(300);
  await closeMenu(page);
  let depthLabels = 0;
  let placePins = 0;
  try {
    await page.waitForFunction(() => document.querySelectorAll('.marnav-depth-num').length >= 3, null, {
      timeout: 30_000,
    });
    depthLabels = await page.locator('.marnav-depth-num').count();
  } catch {
    depthLabels = await page.locator('.marnav-depth-num').count();
  }
  try {
    await page.waitForFunction(() => document.querySelectorAll('.marnav-poi').length >= 2, null, {
      timeout: 30_000,
    });
    placePins = await page.locator('.marnav-poi').count();
  } catch {
    placePins = await page.locator('.marnav-poi').count();
  }
  const depthText = await page
    .locator('.marnav-depth-num')
    .evaluateAll((nodes) => nodes.slice(0, 8).map((node) => node.textContent?.trim() ?? ''));
  check('modelled depth numbers draw on the chart', depthLabels >= 3, `${depthLabels} labels`);
  check(
    'depth numbers carry numeric values',
    depthText.length > 0 && depthText.every((text) => /^\d+(\.\d)?$/.test(text)),
    depthText.join(','),
  );
  const depthStyle = await page
    .locator('.marnav-depth-num')
    .first()
    .evaluate((node) => {
      const styles = getComputedStyle(node);
      return {
        background: styles.backgroundColor,
        border: styles.borderTopWidth,
        shadow: styles.textShadow,
      };
    });
  check(
    'depth numbers have no plate or border',
    depthStyle.background === 'rgba(0, 0, 0, 0)' && depthStyle.border === '0px',
    `${depthStyle.background} / ${depthStyle.border}`,
  );
  check(
    'depth numbers keep a dark halo for legibility',
    depthStyle.shadow !== 'none' && depthStyle.shadow.includes('rgba(0, 12, 19'),
    depthStyle.shadow,
  );
  check('public place pins draw in a harbour', placePins >= 2, `${placePins} pins`);
  await page.screenshot({ path: `${artifacts}phone-places-depth.png` });

  await openMenu(page);
  await page.locator('.menu-row', { hasText: 'Depth numbers' }).first().click();
  await page.locator('.menu-row', { hasText: 'Show public places' }).first().click();
  await closeMenu(page);

  // 3. Hover quick info, then the reference sheet.
  // Markers overlap by design, so drive the pointer at the marker's screen
  // position: the topmost mark receives the real hover and click.
  console.log('step: hover + sheet');
  const markBox = await page.locator('.marnav-mark-wrap').first().boundingBox();
  check('first mark has a screen position', Boolean(markBox));
  if (!markBox) throw new Error('no NAVAID marker was positioned on screen');
  const point = { x: markBox.x + markBox.width / 2, y: markBox.y + markBox.height / 2 };
  await page.mouse.move(point.x, point.y);
  await page.waitForSelector('.leaflet-tooltip', { timeout: 6000 });
  const tooltip = (await page.locator('.leaflet-tooltip').first().textContent()).replace(/\s+/g, ' ');
  check('hovering a mark opens quick info', tooltip.length > 8, tooltip.slice(0, 90));
  check('quick info tells you to tap for the reference', /full reference/i.test(tooltip));

  await page.mouse.click(point.x, point.y);
  await page.waitForSelector('.navaid-sheet');
  const sheetText = await page.locator('.navaid-sheet').textContent();
  check('tapping a mark opens the full reference sheet', sheetText.includes('Centre chart on mark'));
  check('reference sheet shows position and source', /Source/.test(sheetText) && /IALA region/.test(sheetText));
  await page.screenshot({ path: `${artifacts}navaid-sheet.png` });
  await page.locator('.navaid-sheet .icon-button').first().click();
  await page.waitForTimeout(250);

  // 4. GPS panel opt-in
  console.log('step: gps');
  await openMenu(page);
  const showPanel = page.locator('.menu-row', { hasText: 'Show position panel' }).first();
  await showPanel.click();
  await closeMenu(page);
  await page.waitForSelector('.gps-widget');
  check(
    'position panel clears the chart controls',
    await page.locator('.zoom-controls').isHidden(),
    'zoom stack steps aside so the panel close button is reachable',
  );
  const gpsText = await page.locator('.gps-widget').textContent();
  check('position panel reports a live fix', /Live GPS fix|Waiting for fix/.test(gpsText), gpsText.split('\n')[0]);
  await page.waitForTimeout(1200);
  const gpsUpdated = await page.locator('.gps-widget').textContent();
  check('position panel shows coordinates and SOG', /Latitude/.test(gpsUpdated) && /Speed over ground/.test(gpsUpdated));
  await page.screenshot({ path: `${artifacts}gps-panel.png` });

  // 5. Zoom lives on the chart, not in the menu, and sits above centre-on-me.
  console.log('step: zoom');
  const closeGpsPanel = page.locator('.gps-widget .icon-button').first();
  if (await closeGpsPanel.count()) await closeGpsPanel.click();
  await page.waitForTimeout(300);
  const zoomIn = page.locator('[data-testid="zoom-in"]');
  const zoomOut = page.locator('[data-testid="zoom-out"]');
  const locateButtonForLayout = page.locator('[data-testid="locate-button"]');
  const zoomInBox = await zoomIn.boundingBox();
  const zoomOutBox = await zoomOut.boundingBox();
  const locateBoxForLayout = await locateButtonForLayout.boundingBox();
  check(
    'zoom buttons are touch targets beside the chart',
    Boolean(zoomInBox && zoomOutBox) && zoomInBox.width >= 44 && zoomOutBox.height >= 44,
    zoomInBox ? `${Math.round(zoomInBox.width)}×${Math.round(zoomInBox.height)}` : 'missing',
  );
  check(
    'zoom stack sits above the centre-on-me button',
    Boolean(zoomInBox && locateBoxForLayout) && zoomOutBox.y + zoomOutBox.height <= locateBoxForLayout.y,
    zoomInBox && locateBoxForLayout
      ? `zoom ends ${Math.round(zoomOutBox.y + zoomOutBox.height)}px, locate starts ${Math.round(locateBoxForLayout.y)}px`
      : 'missing',
  );

  const chartZoom = async () => Number(await page.locator('.marnav-map').getAttribute('data-zoom'));
  const zoomBefore = await chartZoom();
  await zoomIn.click();
  await page.waitForTimeout(1400);
  const zoomAfterIn = await chartZoom();
  await zoomOut.click();
  await page.waitForTimeout(1400);
  const zoomAfterOut = await chartZoom();
  check('plus zooms the chart in one step', zoomAfterIn === zoomBefore + 1, `${zoomBefore} → ${zoomAfterIn}`);
  check('minus zooms it back out', zoomAfterOut === zoomBefore, `${zoomAfterIn} → ${zoomAfterOut}`);

  // 6. Centre on me: the chart opens at the vessel and the button recovers it.
  console.log('step: locate');

  const centreOffset = () =>
    page.evaluate(() => {
      const vessel = document.querySelector('.marnav-vessel-wrap')?.getBoundingClientRect();
      if (!vessel) return null;
      return {
        dx: Math.round(vessel.x + vessel.width / 2 - window.innerWidth / 2),
        dy: Math.round(vessel.y + vessel.height / 2 - window.innerHeight / 2),
      };
    });
  const nearCentre = (offset) =>
    Boolean(offset) && Math.abs(offset.dx) <= 40 && Math.abs(offset.dy) <= 40;

  await page.waitForSelector('.marnav-vessel-wrap', { timeout: 10_000 });
  await page.waitForTimeout(800);
  const openedAt = await centreOffset();
  check('chart opens at the current position', nearCentre(openedAt), JSON.stringify(openedAt));

  const locateButton = page.locator('[data-testid="locate-button"]');
  const locateBox = await locateButton.boundingBox();
  check(
    'centre-on-me button is a touch target',
    Boolean(locateBox && locateBox.width >= 44 && locateBox.height >= 44),
    locateBox ? `${Math.round(locateBox.width)}×${Math.round(locateBox.height)}` : 'missing',
  );

  await page.mouse.move(200, 620);
  await page.mouse.down();
  await page.mouse.move(330, 470, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(1200);
  const sheet = page.locator('.navaid-sheet .icon-button').first();
  if (await sheet.count()) await sheet.click();
  const panned = await centreOffset();
  await locateButton.click();
  await page.waitForTimeout(2400);
  const recentred = await centreOffset();
  check(
    'centre-on-me returns the chart to the vessel',
    nearCentre(recentred) && (!panned || Math.abs(panned.dx) > 80),
    `${JSON.stringify(panned)} → ${JSON.stringify(recentred)}`,
  );
  await page.screenshot({ path: `${artifacts}locate-button.png` });

  // 7. AIS station
  console.log('step: ais');
  await openMenu(page);
  await page.locator('.menu-row.nav-row', { hasText: 'AIS live traffic' }).first().click();
  await page.waitForSelector('.station-drawer');
  await page.waitForTimeout(9000);
  const vesselCount = await page.locator('.vessel-row').count();
  const aisState = await page.locator('.station-status .pill').first().textContent();
  check('AIS station lists live vessels', vesselCount > 0, `${vesselCount} vessels, state ${aisState}`);
  check('AIS state is live or simulated', /Live|Simulated/.test(aisState), aisState);
  const scopeText = await page.locator('[data-testid="ais-scope"]').textContent();
  check(
    'AIS feed is scoped to the visible chart',
    /Feed covers\s+\d+\.\d°\s+×\s+\d+\.\d°/.test(scopeText),
    scopeText.slice(0, 90),
  );
  // The subscription the browser asks for must be the Solent, not the planet.
  const solentBound = sentBounds.find(([south, , north]) => south > 49.5 && south < 51 && north > 50.5);
  check(
    'browser asks the relay for its own chart bounds',
    Boolean(solentBound),
    solentBound ? `lat ${solentBound[0]}–${solentBound[2]}` : JSON.stringify(sentBounds.slice(0, 2)),
  );
  await page.screenshot({ path: `${artifacts}ais-panel.png` });

  // Flags come from the MMSI MID: a row with a flag opens a sheet naming the
  // country, and the same identity is repeated on the hover card.
  const flaggedRows = await page.locator('.vessel-row-flag').count();
  check(
    'AIS station list shows flags from the MMSI MID',
    flaggedRows > 0,
    `${flaggedRows} flagged rows`,
  );
  if (flaggedRows > 0) {
    await page.locator('.vessel-row', { has: page.locator('.vessel-row-flag') }).first().click();
    await page.waitForSelector('.vessel-sheet');
    await page.waitForTimeout(400);
    const flaggedSheet = await page.locator('.vessel-sheet').innerText();
    check(
      'vessel sheet names the flag and country',
      /FLAG/.test(flaggedSheet) && /[A-Za-z]/.test(flaggedSheet.split('FLAG')[1] ?? ''),
      flaggedSheet.replace(/\s+/g, ' ').slice(0, 110),
    );
    await page.screenshot({ path: `${artifacts}ais-vessel-flag.png` });
    await page.locator('.vessel-sheet .icon-button').click();
    await page.waitForTimeout(300);
  }

  // AIS targets are a traffic display, not dots: class colour, status outline,
  // a hover card and a full reference sheet.
  if (await page.locator('.station-drawer').count()) {
    await page.locator('.drawer-head .icon-button').click();
  }
  await page.waitForTimeout(600);
  await page
    .waitForFunction(() => document.querySelectorAll('.marnav-ais-wrap').length > 0, null, { timeout: 15_000 })
    .catch(() => {});
  const aisPick = await page.evaluate(() => {
    const centre = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const candidates = [...document.querySelectorAll('.marnav-ais-wrap')]
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          title: el.getAttribute('title') ?? '',
          x: r.x + r.width / 2,
          y: r.y + r.height / 2,
          width: r.width,
          height: r.height,
        };
      })
      .filter((item) => item.width > 0 && item.height > 0)
      .sort((a, b) => Math.hypot(a.x - centre.x, a.y - centre.y) - Math.hypot(b.x - centre.x, b.y - centre.y));
    // Prefer a named target away from the edges, where the tooltip has room.
    const roomy = candidates.filter(
      (item) =>
        item.x > 70 && item.x < window.innerWidth - 70 && item.y > 120 && item.y < window.innerHeight - 70,
    );
    const named = roomy.find((item) => !item.title.startsWith('MMSI'));
    const pick = named ?? roomy[0] ?? candidates[0] ?? null;
    return pick
      ? { title: pick.title, x: pick.x, y: pick.y, markers: candidates.length, viewport: [window.innerWidth, window.innerHeight] }
      : null;
  });
  check(
    'AIS targets are plotted and reachable on the chart',
    Boolean(aisPick),
    aisPick ? `${aisPick.title} · ${aisPick.markers} on ${aisPick.viewport.join('×')}` : 'no AIS markers',
  );
  const aisTarget = aisPick;
  const aisColours = await page.$$eval('.marnav-ais svg [fill]', (els) =>
    [...new Set(els.map((el) => el.getAttribute('fill')).filter((value) => value && value.startsWith('#')))],
  );
  check(
    'AIS targets are colour-coded by class',
    aisColours.length >= 2,
    aisColours.slice(0, 5).join(' '),
  );
  if (aisTarget) {
    await page.mouse.move(aisTarget.x, aisTarget.y);
    await page.waitForTimeout(700);
    const tip = await page
      .locator('.vessel-tip-card')
      .first()
      .textContent()
      .catch(() => '');
    check(
      'AIS hover card shows identity, status and motion',
      /SOG/.test(tip) && /MMSI/.test(tip) && /kn/.test(tip),
      tip.replace(/\s+/g, ' ').slice(0, 100),
    );
    await page.screenshot({ path: `${artifacts}ais-hover.png` });
    await page.mouse.click(aisTarget.x, aisTarget.y);
    await page.waitForSelector('.vessel-sheet');
    await page.waitForTimeout(400);
    const vesselSheet = await page.locator('.vessel-sheet').innerText();
    check(
      'AIS detail sheet reports class, range and report age',
      /FROM THIS CHART/.test(vesselSheet) &&
        /REPORT CLASS/.test(vesselSheet) &&
        /POSITION REPORT/.test(vesselSheet),
      vesselSheet.replace(/\s+/g, ' ').slice(0, 110),
    );
    await page.screenshot({ path: `${artifacts}ais-vessel-sheet.png` });
    await page.locator('.vessel-sheet .icon-button').click();
    await page.waitForTimeout(300);
  }
  const cachedStatics = await page.evaluate(() => {
    try {
      const raw = localStorage.getItem('wheel-over:ais-static');
      return raw ? Object.keys(JSON.parse(raw)).length : 0;
    } catch {
      return 0;
    }
  });
  check('AIS static detail is cached for instant names', cachedStatics > 0, `${cachedStatics} vessels cached`);

  // Re-open the station for the COLREGs step that follows.
  await openMenu(page);
  await page.locator('.menu-row.nav-row', { hasText: 'AIS live traffic' }).first().click();
  await page.waitForSelector('.station-drawer');
  await page.waitForTimeout(400);

  // 6. COLREGs
  console.log('step: colregs');
  await page.locator('.tab', { hasText: 'COLREGs' }).click();
  await page.waitForSelector('.search-field input');
  await page.fill('.search-field input', 'overtaking');
  await page.waitForTimeout(300);
  const ruleText = await page.locator('.rule-list').first().textContent();
  check('COLREGs search finds the overtaking rule', /Rule 13/.test(ruleText));
  await page.screenshot({ path: `${artifacts}colregs.png` });

  // 7. Weather, tides and currents outside NOAA coverage (the Solent): the
  // global models fill in, with their datum stated.
  await page.locator('.tab', { hasText: 'Weather' }).click();
  await page.waitForSelector('.metric-card', { timeout: 20_000 });
  await page.locator('.menu-note[data-tide-source]').waitFor({ timeout: 30_000 }).catch(() => {});
  await page
    .waitForFunction(
      () => {
        const body = document.querySelector('.station-body');
        return Boolean(body?.querySelector('[data-tide-events]') && body.querySelector('[data-current-source]'));
      },
      null,
      { timeout: 30_000 },
    )
    .catch(() => {});
  const weatherText = await page.locator('.station-body').textContent();
  check('weather panel shows wind and sea state', /Wind/.test(weatherText) && /Sea state/.test(weatherText));
  check('tide section explains coverage', /NOAA|tide/i.test(weatherText));
  const solentTideSource = await page.locator('[data-tide-events]').getAttribute('data-tide-events');
  const solentTideRows = await page.locator('[data-tide-events] li').count();
  check(
    'tides work outside NOAA coverage from the global model',
    solentTideSource === 'model' && solentTideRows >= 2,
    `${solentTideSource}, ${solentTideRows} events`,
  );
  const solentTideNow = await page.locator('.tide-now').getAttribute('data-tide-now').catch(() => null);
  check(
    'global tide model reports the height now',
    Number.isFinite(Number(solentTideNow)),
    `${solentTideNow} m above MSL`,
  );
  const solentCurrent = page.locator('.current-readout[data-current-source="model"]');
  const solentCurrentShown = (await solentCurrent.count()) > 0;
  const solentSpeed = Number((await solentCurrent.getAttribute('data-current-speed').catch(() => '')) ?? NaN);
  const solentSet = Number((await solentCurrent.getAttribute('data-current-set').catch(() => '')) ?? NaN);
  check(
    'currents work outside NOAA coverage from the global model',
    solentCurrentShown && Number.isFinite(solentSpeed) && solentSpeed >= 0 && solentSpeed < 10,
    `${solentSpeed} kn`,
  );
  check(
    'global current model gives the set of the stream',
    Number.isFinite(solentSet) && solentSet >= 0 && solentSet < 360,
    `${solentSet}°`,
  );
  await page.screenshot({ path: `${artifacts}weather.png` });
  await page.locator('.station-drawer .icon-button').click();

  // 8. NOAA base map and coverage guard
  await openMenu(page);
  await page.locator('.menu-row', { hasText: 'NOAA ENC' }).first().click();
  await page.waitForTimeout(700);
  const warning = await page.locator('.inline-warning').first().textContent().catch(() => '');
  check('NOAA coverage guard explains US-only charts', /outside US chart coverage/i.test(warning), warning.slice(0, 60));
  await page.locator('.menu-row', { hasText: 'Standard chart' }).first().click();
  await closeMenu(page);

  // 9. Always-off GPS really stops the watch.
  console.log('step: gps-off');
  await openMenu(page);
  await page.locator('.segmented button', { hasText: 'Always off' }).click();
  await page.waitForTimeout(300);
  const offStatus = await page.locator('[data-testid="gps-status"]').textContent();
  check('GPS can be switched always off', /off/i.test(offStatus), offStatus);
  await closeMenu(page);
  await page.waitForTimeout(400);
  await page.locator('[data-testid="locate-button"]').click();
  const offToast = (await page.locator('.chart-toast').textContent()) ?? '';
  check('centre-on-me explains when position is off', /switched off/i.test(offToast), offToast.slice(0, 70));
  await openMenu(page);
  await page.locator('.segmented button', { hasText: 'Always on' }).click();
  await closeMenu(page);

  await context.close();

  // 10. Tablet layout
  const tablet = await browser.newContext({ viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2 });
  const tabletPage = await tablet.newPage();
  tabletPage.on('pageerror', (error) => consoleErrors.push(`tablet pageerror: ${error.message}`));
  await tabletPage.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await waitForChart(tabletPage);
  await openMenu(tabletPage);
  const panelBox = await tabletPage.locator('.menu-panel').boundingBox();
  check('tablet menu is a right-hand panel', Boolean(panelBox && panelBox.x > 380), panelBox ? `x=${Math.round(panelBox.x)}` : 'missing');
  const tabletLayout = await tabletPage.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    width: window.innerWidth,
    map: document.querySelector('.marnav-map')?.getBoundingClientRect().height ?? 0,
    height: window.innerHeight,
  }));
  check('no horizontal overflow on tablet', tabletLayout.scrollWidth <= tabletLayout.width + 1);
  check('chart fills the tablet height', Math.abs(tabletLayout.map - tabletLayout.height) <= 1);
  await tabletPage.screenshot({ path: `${artifacts}tablet-menu.png` });
  await tablet.close();

  // 11. Small landscape phone
  const landscape = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  const landscapePage = await landscape.newPage();
  await landscapePage.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await waitForChart(landscapePage);
  const landscapeLayout = await landscapePage.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    width: window.innerWidth,
    mapHeight: document.querySelector('.marnav-map')?.getBoundingClientRect().height ?? 0,
    height: window.innerHeight,
  }));
  check('no horizontal overflow in landscape', landscapeLayout.scrollWidth <= landscapeLayout.width + 1);
  check('chart fills landscape height', Math.abs(landscapeLayout.mapHeight - landscapeLayout.height) <= 1);
  await landscapePage.screenshot({ path: `${artifacts}landscape-chart.png` });
  await landscape.close();

  // 12. NOAA over US waters: real chart tiles, no coverage warning.
  const us = await browser.newContext({ viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2 });
  const usPage = await us.newPage();
  usPage.setDefaultTimeout(12_000);
  const noaaStatuses = [];
  usPage.on('response', (response) => {
    if (response.url().includes('encdirect')) noaaStatuses.push(response.status());
  });
  usPage.on('pageerror', (error) => consoleErrors.push(`us pageerror: ${error.message}`));
  const usBounds = [];
  recordBounds(usPage, usBounds);
  await usPage.goto(`${baseUrl}?lat=40.7&lon=-74.03&z=13`, { waitUntil: 'domcontentloaded' });
  await waitForChart(usPage);
  const nyBound = usBounds.find(([south, , north]) => south > 39 && north < 42);
  check(
    'AIS subscription re-aims when the chart opens elsewhere',
    Boolean(nyBound),
    nyBound ? `lat ${nyBound[0]}–${nyBound[2]}` : JSON.stringify(usBounds.slice(0, 2)),
  );
  const nyMarkers = await usPage.locator('.marnav-mark-wrap').count();
  check('New York region loads NAVAIDs from its shard set', nyMarkers > 10, `${nyMarkers} markers`);
  await openMenu(usPage);
  await usPage.locator('.menu-row', { hasText: 'NOAA ENC' }).first().click();
  // Chart tiles are cached as blobs, so wait for decoded blob images rather than
  // a fixed delay: the export service renders each tile on demand.
  await usPage
    .waitForFunction(
      () =>
        [...document.querySelectorAll('.leaflet-tile')].filter(
          (tile) => tile.src.startsWith('blob:') && tile.complete && tile.naturalWidth > 32,
        ).length >= 6,
      null,
      { timeout: 20_000 },
    )
    .catch(() => {});
  await usPage.waitForTimeout(1500);
  const nyWarning = await usPage.locator('.inline-warning').count();
  check('no coverage warning over US waters', nyWarning === 0, `${nyWarning} warnings`);
  check(
    'NOAA chart raster tiles load in US waters',
    noaaStatuses.some((status) => status === 200),
    `statuses: ${noaaStatuses.slice(0, 6).join(', ') || 'none'}`,
  );
  const chartImagery = await usPage.evaluate(async () => {
    const tiles = [...document.querySelectorAll('.leaflet-tile')].filter(
      (tile) => tile.src.startsWith('blob:') && tile.complete && tile.naturalWidth > 32,
    );
    const cache = await caches.open('marnav-noaa-v1');
    const keys = await cache.keys();
    let bytes = 0;
    for (const key of keys) {
      const response = await cache.match(key);
      if (response) bytes += (await response.clone().blob()).size;
    }
    return {
      decoded: tiles.length,
      widths: tiles.map((tile) => tile.naturalWidth),
      cached: keys.length,
      bytes,
    };
  });
  const smallestTile = Math.min(...chartImagery.widths);
  // A blank/error export is a tiny image; real chart tiles are full 256 px and
  // total tens of kB once saved.
  check(
    'NOAA tiles are real chart imagery kept on the device',
    chartImagery.decoded >= 6 &&
      chartImagery.widths.every((width) => width >= 256) &&
      chartImagery.bytes > 40_000,
    `${chartImagery.decoded} tiles from ${smallestTile}px, ${chartImagery.cached} cached, ${Math.round(
      chartImagery.bytes / 1024,
    )} kB`,
  );
  await usPage.screenshot({ path: `${artifacts}noaa-new-york.png` });

  // 12b. The chart is kept on the device, so a reload repaints from Cache
  // Storage instead of asking NOAA to render every tile again.
  console.log('step: noaa-cache');
  const exportRequestsAfterReload = [];
  usPage.on('response', (response) => {
    if (response.url().includes('encdirect')) exportRequestsAfterReload.push(response.status());
  });
  await usPage.reload({ waitUntil: 'domcontentloaded' });
  await waitForChart(usPage);
  const countCachedTiles = () =>
    usPage.evaluate(
      () =>
        [...document.querySelectorAll('.leaflet-tile')].filter(
          (tile) => tile.src.startsWith('blob:') && tile.complete && tile.naturalWidth > 32,
        ).length,
    );
  await usPage
    .waitForFunction(
      () =>
        [...document.querySelectorAll('.leaflet-tile')].filter(
          (tile) => tile.src.startsWith('blob:') && tile.complete && tile.naturalWidth > 32,
        ).length >= 6,
      null,
      { timeout: 20_000 },
    )
    .catch(() => {});
  await usPage.waitForTimeout(1500);
  const cachedTiles = await countCachedTiles();
  check(
    'reload repaints NOAA tiles from the on-device cache',
    cachedTiles >= 6,
    `${cachedTiles} cached tiles drawn`,
  );
  check(
    'cached reload stops re-rendering the visible chart at NOAA',
    exportRequestsAfterReload.length < cachedTiles,
    `${exportRequestsAfterReload.length} export requests for ${cachedTiles} tiles`,
  );
  await usPage.screenshot({ path: `${artifacts}noaa-cached-reload.png` });

  // 12c. The update check is also what saves the chart pack for this area.
  await openMenu(usPage);
  const cacheTileCount = async () => {
    const text = (await usPage.locator('[data-testid="chart-cache"]').textContent()) ?? '';
    return Number(text.match(/(\d+)\s+tiles/)?.[1] ?? 0);
  };
  const tilesBeforeUpdate = await cacheTileCount();
  await usPage.locator('.secondary-button.wide', { hasText: 'Check for updates' }).click();
  await usPage
    .waitForFunction(
      () => {
        const text = document.querySelector('[data-testid="check-message"]')?.textContent ?? '';
        return (
          /Chart pack:|cached when NOAA ENC is the active base|cover US waters only/.test(text) &&
          !/Checking NAVAID|Saving chart tiles/.test(text)
        );
      },
      null,
      { timeout: 300_000 },
    )
    .catch(() => {});
  const updateText = ((await usPage.locator('[data-testid="check-message"]').textContent()) ?? '').trim();
  check(
    'update check saves the NOAA chart pack for the visible area',
    /Chart pack: \d+ new tiles/.test(updateText),
    updateText.slice(0, 130),
  );
  const tilesAfterUpdate = await cacheTileCount();
  check(
    'update check grows the on-device chart cache',
    tilesAfterUpdate > tilesBeforeUpdate,
    `${tilesBeforeUpdate} → ${tilesAfterUpdate} tiles`,
  );
  await usPage.screenshot({ path: `${artifacts}noaa-update-check.png` });

  // 12d. Weather & tides carries NOAA tidal-current predictions for the chart
  // position: drift, the set of the stream and the next predicted turns.
  console.log('step: currents');
  await usPage.locator('.menu-row.nav-row', { hasText: 'Weather & tides' }).first().click();
  const currentReadout = usPage.locator('.current-readout');
  await currentReadout.waitFor({ timeout: 30_000 }).catch(() => {});
  const currentShown = (await currentReadout.count()) > 0;
  // An absent readout is missing data, not a calm 0 kn / 0° stream, so it must
  // report NaN rather than let Number('') turn it into a passing zero.
  const readNumber = (raw) => (raw === null || raw === '' ? Number.NaN : Number(raw));
  const currentAttr = async (name) => (currentShown ? currentReadout.getAttribute(name) : null);
  const currentPhase = (await currentAttr('data-current-phase')) ?? '';
  const currentSpeed = readNumber(await currentAttr('data-current-speed'));
  const currentSet = readNumber(await currentAttr('data-current-set'));
  check(
    'tidal current reports flood, ebb or slack at the position',
    ['flood', 'ebb', 'slack'].includes(currentPhase ?? ''),
    String(currentPhase),
  );
  check(
    'tidal current gives a drift in knots',
    Number.isFinite(currentSpeed) && currentSpeed >= 0 && currentSpeed < 8,
    `${currentSpeed} kn`,
  );
  check(
    'tidal current gives the set of the stream',
    currentPhase === 'slack' || (Number.isFinite(currentSet) && currentSet >= 0 && currentSet < 360),
    `${currentSet}°`,
  );
  const currentRows = await usPage.locator('.current-list li').count();
  const currentListText = (await usPage.locator('.current-list').textContent().catch(() => '')) ?? '';
  check(
    'tidal current lists the predicted turns',
    currentRows >= 2 && /flood|ebb|slack/i.test(currentListText),
    `${currentRows} events`,
  );
  const currentStationText =
    (await usPage.locator('.current-heading ~ p.menu-note').first().textContent().catch(() => '')) ?? '';
  check(
    'tidal current names the NOAA station it came from',
    /km away · NOAA current predictions/.test(currentStationText),
    currentStationText.slice(0, 80),
  );
  const nyCurrentSource = await currentAttr('data-current-source');
  check('US currents use NOAA harmonic predictions', nyCurrentSource === 'noaa', String(nyCurrentSource));
  const nyTideSource = await usPage.locator('[data-tide-events]').getAttribute('data-tide-events');
  const nyTideNote = (await usPage.locator('.menu-note[data-tide-source]').first().textContent()) ?? '';
  check(
    'US tides use the nearest NOAA station with its chart datum',
    nyTideSource === 'noaa' && /MLLW/.test(nyTideNote) && /km away/.test(nyTideNote),
    `${nyTideSource}: ${nyTideNote.slice(0, 60)}`,
  );
  await usPage.screenshot({ path: `${artifacts}currents.png` });
  await us.close();

  // 12e. ENC depth overlays: inside US waters the contours come from the
  // chart's own depth layer (not GEBCO) and spot soundings are the charted
  // values. The sounding toggle must explain itself outside US coverage.
  console.log('step: enc-depth');
  const depthContext = await browser.newContext({
    viewport: { width: 820, height: 1180 },
    deviceScaleFactor: 2,
  });
  const depthPage = await depthContext.newPage();
  depthPage.setDefaultTimeout(25_000);
  const encExports = [];
  depthPage.on('response', (response) => {
    const url = response.url();
    if (url.includes('encdirect') && url.includes('/MapServer/export') && url.includes('layers=show')) {
      const layer = /layers=show:(\d+)/.exec(url)?.[1] ?? '?';
      encExports.push(`${layer}:${response.status()}`);
    }
  });
  depthPage.on('pageerror', (error) => consoleErrors.push(`enc depth pageerror: ${error.message}`));
  await depthPage.goto(`${baseUrl}?lat=40.7&lon=-74.01&z=15`, { waitUntil: 'domcontentloaded' });
  await depthPage.waitForSelector('.leaflet-container');
  await depthPage.waitForTimeout(3500);
  await openMenu(depthPage);
  const depthMenuText = (await depthPage.locator('.menu-panel').textContent()) ?? '';
  check(
    'US chart offers ENC contours and charted soundings',
    depthMenuText.includes('Depth contours') && depthMenuText.includes('Charted soundings'),
  );
  check(
    'no sounding coverage warning in a US harbour',
    !/only cover US waters/.test(depthMenuText),
  );
  await depthPage.locator('.menu-row', { hasText: 'Depth contours' }).first().click();
  await depthPage.locator('.menu-row', { hasText: 'Charted soundings' }).first().click();
  await closeMenu(depthPage);
  await depthPage.waitForTimeout(12_000);
  const depthImages = await depthPage.evaluate(() => {
    const loaded = (pane) =>
      [...document.querySelectorAll(`${pane} .leaflet-tile`)].filter(
        (tile) => tile.complete && tile.naturalWidth >= 250,
      ).length;
    return {
      contours: loaded('.leaflet-contours-pane'),
      soundings: loaded('.leaflet-soundings-pane'),
    };
  });
  check(
    'ENC depth contours render in US waters',
    depthImages.contours >= 2 && encExports.some((entry) => entry === '104:200'),
    `${depthImages.contours} tiles; exports ${encExports.slice(0, 6).join(', ') || 'none'}`,
  );
  check(
    'ENC spot soundings render in a US harbour',
    depthImages.soundings >= 2 && encExports.some((entry) => entry === '76:200'),
    `${depthImages.soundings} tiles; exports ${encExports.slice(0, 6).join(', ') || 'none'}`,
  );
  await depthPage.screenshot({ path: `${artifacts}enc-depth-ny.png` });

  await depthPage.goto(`${baseUrl}?lat=50.76&lon=-1.2&z=13`, { waitUntil: 'domcontentloaded' });
  await depthPage.waitForSelector('.leaflet-container');
  await depthPage.waitForTimeout(4000);
  await openMenu(depthPage);
  const soundingWarning =
    (await depthPage.locator('.inline-warning').first().textContent().catch(() => '')) ?? '';
  check(
    'sounding coverage guard explains non-US water',
    /only cover US waters/.test(soundingWarning),
    soundingWarning.slice(0, 80),
  );
  await closeMenu(depthPage);
  await depthContext.close();

  // 13. Two charts on one relay. A union of distant views used to collapse into
  // one clamped box over open ocean, which starved both clients of traffic.
  const paired = await browser.newContext({ viewport: { width: 430, height: 900 } });
  const solentPage = await paired.newPage();
  const farPage = await paired.newPage();
  await solentPage.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await farPage.goto(`${baseUrl}?lat=40.7&lon=-74.03&z=13`, { waitUntil: 'domcontentloaded' });
  await waitForChart(solentPage);
  await waitForChart(farPage);
  const scopeOf = async (target) => {
    await openMenu(target);
    await target.locator('.menu-row.nav-row', { hasText: 'AIS live traffic' }).first().click();
    await target.waitForSelector('.station-drawer');
    await target.waitForTimeout(7000);
    return (await target.locator('[data-testid="ais-scope"]').textContent()).trim();
  };
  const solentScope = await scopeOf(solentPage);
  const farScope = await scopeOf(farPage);
  const maxSpan = (text) => {
    const match = text.match(/(\d+\.\d)°\s*×\s*(\d+\.\d)°/);
    return match ? Math.max(Number(match[1]), Number(match[2])) : Number.POSITIVE_INFINITY;
  };
  check(
    'two charts on one relay each keep their own AIS scope',
    maxSpan(solentScope) < 3 && maxSpan(farScope) < 3,
    `${solentScope.slice(0, 42)} | ${farScope.slice(0, 42)}`,
  );
  await paired.close();

  // 14. Marks that used to go missing: anchorage grounds and bifurcation marks
  // must plot at their real positions, not just exist in the database.
  const marksContext = await browser.newContext({ viewport: { width: 820, height: 900 }, deviceScaleFactor: 2 });
  const marksPage = await marksContext.newPage();
  const countTitled = (needle) =>
    marksPage.locator(`.marnav-mark-wrap[title*="${needle}"]`).count();
  await marksPage.goto(`${baseUrl}?lat=50.772&lon=-1.2912&z=16`, { waitUntil: 'domcontentloaded' });
  await waitForChart(marksPage);
  await marksPage.waitForTimeout(1200);
  const anchorageMarks = await countTitled('Anchorage');
  check('anchorage grounds plot as NAVAIDs', anchorageMarks >= 1, `${anchorageMarks} anchorages at Portsmouth`);
  await marksPage.screenshot({ path: `${artifacts}anchorage-bifurcation.png` });

  // 15. Legend filters: each class can be switched off, and the choice sticks.
  await openMenu(marksPage);
  await marksPage.locator('.legend summary').click();
  await marksPage.waitForTimeout(250);
  const legendRows = await marksPage.locator('.legend-item').count();
  const rowHeights = await marksPage
    .locator('.legend-item')
    .evaluateAll((rows) => rows.map((row) => Math.round(row.getBoundingClientRect().height)));
  check('legend lists every mark class as a switch', legendRows >= 15, `${legendRows} rows`);
  check(
    'every legend switch is a touch target',
    rowHeights.every((height) => height >= 44),
    `${Math.min(...rowHeights)}-${Math.max(...rowHeights)}px`,
  );
  await marksPage.locator('.legend').scrollIntoViewIfNeeded();
  await marksPage.screenshot({ path: `${artifacts}legend-filters.png` });

  const anchorageSwitch = marksPage.locator('.legend-item[data-group="anchorage"]');
  check('mark classes start switched on', (await anchorageSwitch.getAttribute('aria-checked')) === 'true');
  await anchorageSwitch.click();
  await marksPage.waitForTimeout(600);
  const hiddenCount = await countTitled('Anchorage');
  check(
    'switching a class off removes it from the chart',
    (await anchorageSwitch.getAttribute('aria-checked')) === 'false' && hiddenCount === 0,
    `${hiddenCount} anchorages left`,
  );
  await marksPage.screenshot({ path: `${artifacts}legend-filters-off.png` });

  await marksPage.reload({ waitUntil: 'domcontentloaded' });
  await waitForChart(marksPage);
  const stillHidden = await countTitled('Anchorage');
  await openMenu(marksPage);
  await marksPage.locator('.legend summary').click();
  await marksPage.waitForTimeout(250);
  check(
    'mark filter survives a reload',
    stillHidden === 0 && (await anchorageSwitch.getAttribute('aria-checked')) === 'false',
    `${stillHidden} anchorages after reload`,
  );
  await marksPage.locator('.legend-reset').click();
  await marksPage.waitForTimeout(700);
  const restored = await countTitled('Anchorage');
  check('“Show every mark class” restores them', restored >= 1, `${restored} anchorages restored`);

  await marksPage.goto(`${baseUrl}?lat=40.5521&lon=-74.0308&z=14`, { waitUntil: 'domcontentloaded' });
  await waitForChart(marksPage);
  await marksPage.waitForTimeout(1200);
  const bifurcationMarks = await countTitled('bifurcation');
  check(
    'bifurcation marks plot as NAVAIDs',
    bifurcationMarks >= 1,
    `${bifurcationMarks} bifurcation marks off Ambrose Channel`,
  );
  // 16. Canadian charts: anchor berths and calling-in points are OSM features
  // the classifier used to drop, so they only appeared with the OpenSeaMap
  // raster switched on. They must now plot from the NAVAID overlay itself.
  await marksPage.goto(`${baseUrl}?lat=49.0262&lon=-123.6586&z=13`, { waitUntil: 'domcontentloaded' });
  await marksPage.waitForSelector('.leaflet-container');
  await marksPage.waitForFunction(
    () => document.querySelectorAll('.marnav-mark-wrap').length > 0,
    null,
    { timeout: 30_000 },
  );
  await marksPage.waitForTimeout(2000);
  const anchorBerths = await countTitled('Anchor berth');
  const callingPoints = await countTitled('Calling-in point');
  check(
    'Canadian anchor berths plot as NAVAIDs',
    anchorBerths >= 1,
    `${anchorBerths} anchor berths in Trincomali Channel`,
  );
  check(
    'calling-in points plot as NAVAIDs',
    callingPoints >= 1,
    `${callingPoints} calling-in points near Porlier Pass`,
  );
  const callingLines = await marksPage.locator('path.marnav-calling-line').count();
  check(
    'calling-in point draws its reporting line',
    callingLines >= 1,
    `${callingLines} line(s) across the channel`,
  );
  await marksPage.screenshot({ path: `${artifacts}trincomali-anchorages.png` });

  // 17. Wrecks are their own class. Varvassi (dangerous) and Alchemist
  // (non-dangerous) lie about 600 m apart off the Needles, so one view has both.
  await marksPage.goto(`${baseUrl}?lat=50.6605&lon=-1.5905&z=15`, { waitUntil: 'domcontentloaded' });
  await waitForChart(marksPage);
  await marksPage.waitForTimeout(1500);
  const wreckMarks = await countTitled('Wreck');
  const dangerWrecks = await countTitled('Dangerous wreck');
  check('charted wrecks have their own symbol', wreckMarks >= 1, `${wreckMarks} wrecks off the Needles`);
  check(
    'dangerous wrecks stay distinct from ordinary wrecks',
    dangerWrecks >= 1,
    `${dangerWrecks} dangerous wrecks`,
  );
  await marksPage.screenshot({ path: `${artifacts}wrecks-needles.png` });

  // 18. Transit (range) lights: Inskip Islands in Esquimalt Harbour is a pair of
  // OSM `light_minor` nodes carrying only lower/upper categories, which used to
  // plot as two ordinary minor lights with no leading line.
  await marksPage.goto(`${baseUrl}?lat=48.4423&lon=-123.4388&z=16`, { waitUntil: 'domcontentloaded' });
  await marksPage.waitForSelector('.leaflet-container');
  await marksPage.waitForFunction(
    () => document.querySelectorAll('.marnav-mark-wrap').length > 0,
    null,
    { timeout: 30_000 },
  );
  await marksPage.waitForTimeout(2500);
  const transitFront = await countTitled('Transit front');
  const transitRear = await countTitled('Transit rear');
  check(
    'transit lights are split into front (lower) and rear (higher)',
    transitFront >= 1 && transitRear >= 1,
    `${transitFront} front / ${transitRear} rear at Inskip Islands`,
  );
  const transitLines = await marksPage.locator('path.marnav-transit-line').count();
  check('transit draws its leading line', transitLines >= 1, `${transitLines} leading line(s)`);

  await marksPage.locator('.marnav-mark-wrap[title="Transit front (lower)"]').first().click({ force: true });
  await marksPage.waitForSelector('.navaid-sheet');
  await marksPage.waitForTimeout(400);
  const transitSheet = await marksPage.locator('.navaid-sheet').textContent();
  check(
    'transit sheet names the role and the bearing',
    /Front \(lower\)/.test(transitSheet) && /\d{3}° true/.test(transitSheet),
    transitSheet.replace(/\s+/g, ' ').slice(0, 120),
  );
  await marksPage.screenshot({ path: `${artifacts}transit-inskip.png` });

  // The two lights are 90 m apart, so tapping the other one is fiddly: the
  // sheet has to carry the navigator from the lower light to the upper one.
  const partnerButton = marksPage.getByRole('button', { name: /Show the rear mark/ });
  check(
    'transit sheet offers the paired light',
    (await partnerButton.count()) === 1,
    'Show the rear mark button present',
  );
  await partnerButton.click();
  await marksPage.waitForTimeout(600);
  const rearSheet = await marksPage.locator('.navaid-sheet').textContent();
  check(
    'paired light opens its own reference with the same transit',
    /Rear \(higher\)/.test(rearSheet) &&
      /Inskip Islands rear light/.test(rearSheet) &&
      /\d{3}° true/.test(rearSheet),
    rearSheet.replace(/\s+/g, ' ').slice(0, 120),
  );
  await marksPage.screenshot({ path: `${artifacts}transit-inskip-rear.png` });
  await marksContext.close();

  await browser.close();

  const failures = results.filter((entry) => !entry.ok);
  const realConsoleErrors = consoleErrors.filter(
    (text) => !/Download the React DevTools|favicon/.test(text),
  );

  console.log(`\n${results.length - failures.length}/${results.length} checks passed`);
  if (realConsoleErrors.length) {
    console.log(`console errors (${realConsoleErrors.length}):`);
    for (const error of realConsoleErrors.slice(0, 8)) console.log(`  - ${error}`);
  } else {
    console.log('console errors: none');
  }
  if (failedRequests.length) {
    console.log(`failed requests (${failedRequests.length}):`);
    for (const request of failedRequests.slice(0, 6)) console.log(`  - ${request}`);
  }
  if (cancelledRequests.length) {
    console.log(`cancelled requests (${cancelledRequests.length}): aborted by pan/recentre, not failures`);
  }

  if (failures.length > 0) process.exitCode = 1;
}

run().catch(async (error) => {
  console.error('verification failed:', error?.message ?? error);
  process.exitCode = 1;
  if (activeBrowser) await activeBrowser.close().catch(() => {});
});
