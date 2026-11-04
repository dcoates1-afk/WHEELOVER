// Verifies the rest-of-the-list batch: route fuel estimate, grounding
// auto-recalc, navigation strip + completion, fuel tank level, tide stations.
// Usage: PORT=3016 node build/server.mjs  (in another shell)
//        node scripts/verify-rest-of-list.mjs 3016
import { chromium } from 'playwright';

const port = process.argv[2] || '3016';
const browser = await chromium.launch();
const context = await browser.newContext({ ignoreHTTPSErrors: true });
await context.grantPermissions(['geolocation']);
await context.setGeolocation({ latitude: 48.0, longitude: -126.0 });
const page = await context.newPage();

// GEBCO stub: everything deep, so grounding reports no flags.
await page.route('**/di-elevation.img.arcgis.com/**', async (route) => {
  const url = new URL(route.request().url());
  const geometry = JSON.parse(url.searchParams.get('geometry') ?? '{"points":[]}');
  const results = (geometry.points ?? []).map(([lon, lat]) => ({
    location: { x: lon, y: lat },
    value: -30,
  }));
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results }) });
});
// NOAA stub: two tide events for any station lookup.
await page.route('**/datagetter*', async (route) => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      predictions: [
        { t: '2026-11-03 10:00', v: '1.23', type: 'H' },
        { t: '2026-11-03 16:00', v: '0.45', type: 'L' },
      ],
    }),
  });
});

// Seed a route, a draught, and a fuel burn rate; guarded so reloads keep
// the records the test creates.
await page.addInitScript(() => {
  if (!localStorage.getItem('wheel-over:route')) {
    localStorage.setItem(
      'wheel-over:route',
      JSON.stringify([
        { lat: 48.0, lon: -126.0 },
        { lat: 48.0, lon: -125.9 },
      ]),
    );
  }
  if (!localStorage.getItem('wheel-over:settings')) {
    localStorage.setItem(
      'wheel-over:settings',
      JSON.stringify({ boat: { draughtM: '2.5', fuelBurnLph: '8' } }),
    );
  }
});

await page.goto(`http://localhost:${port}/app?lat=48.0&lon=-126.0&z=12`, {
  waitUntil: 'domcontentloaded',
});
await page.locator('.leaflet-tile').first().waitFor({ state: 'attached', timeout: 30000 });

// --- Route panel: fuel estimate, grounding check + auto-recalc, navigation.
await page.getByRole('button', { name: 'Route builder' }).click();
const routePanel = page.locator('.route-panel');
await routePanel.waitFor({ timeout: 10000 });
await routePanel.getByText(/Fuel ~[\d.]+ L/).waitFor({ timeout: 10000 });
console.log('route fuel estimate shown');

await routePanel.getByRole('button', { name: 'Check grounding' }).click();
await routePanel.getByText('No grounding flags on the sampled route.').waitFor({ timeout: 30000 });
console.log('grounding check ran, no flags');

// Adding a waypoint makes the result stale; auto-recalc replaces it.
await page.getByLabel('Waypoint latitude').fill('48.0');
await page.getByLabel('Waypoint longitude').fill('-125.8');
await routePanel.getByRole('button', { name: 'Add', exact: true }).click();
await routePanel.getByText('The route changed since this check').waitFor({ timeout: 10000 });
await routePanel.getByText('The route changed since this check').waitFor({ state: 'detached', timeout: 30000 });
await routePanel.getByText('No grounding flags on the sampled route.').waitFor({ timeout: 10000 });
console.log('grounding auto-recalc ran after route change');

// Navigation: start at W1, target W2; moving the fix advances the target;
// reaching the last waypoint completes the route. (The route has three
// waypoints here because the auto-recalc step added one.)
await routePanel.getByRole('button', { name: 'Start navigating' }).click();
const strip = page.locator('.nav-strip');
await strip.waitFor({ timeout: 10000 });
await strip.getByText(/Next W2/).waitFor({ timeout: 15000 });
console.log('nav strip shows next waypoint');
await context.setGeolocation({ latitude: 48.0, longitude: -125.9 });
await strip.getByText(/Next W3/).waitFor({ timeout: 30000 });
console.log('nav target advanced to W3');
await context.setGeolocation({ latitude: 48.0, longitude: -125.8 });
await strip.getByText('Route complete').waitFor({ timeout: 30000 });
console.log('nav route complete after fix reached W3');
await strip.getByRole('button', { name: 'Stop', exact: true }).click();
await strip.waitFor({ state: 'detached', timeout: 10000 });

// --- Boat log: fuel level + capacity.
await page.getByRole('button', { name: 'Boat log' }).click();
const boatPanel = page.locator('.boat-panel');
await boatPanel.waitFor({ timeout: 10000 });
await boatPanel.getByRole('tab', { name: 'Fuel' }).click();
await boatPanel.getByLabel('Tank capacity (L, optional)').fill('200');
await boatPanel.getByLabel('Litres').fill('40');
await boatPanel.getByLabel('Total cost (optional)').fill('80');
await boatPanel.getByLabel('Tank level after fill (L, optional)').fill('120');
await boatPanel.getByRole('button', { name: 'Add fill' }).click();
await boatPanel.getByText(/Last recorded tank level: 120.0 L \(60% of tank\)/).waitFor({ timeout: 10000 });
await boatPanel.getByText(/avg 2.00 per L/).waitFor({ timeout: 10000 });
console.log('fuel level + capacity + avg cost shown');

// --- Tide stations: toggle the layer, tap a marker, read the forecast.
await page.goto(`http://localhost:${port}/app?lat=47.7&lon=-122.3&z=10`, {
  waitUntil: 'domcontentloaded',
});
await page.locator('.leaflet-tile').first().waitFor({ state: 'attached', timeout: 30000 });
await page.getByRole('button', { name: 'Open menu' }).click();
await page.locator('summary', { hasText: 'Map options' }).click();
const tideSwitch = page.getByRole('switch', { name: /Tide stations/ });
// Playwright's scroll-into-view hangs on the menu's smooth-scroll CSS, so
// the tap is dispatched directly: the row is already visible and enabled,
// and a finger scroll reaches it the same way.
await tideSwitch.evaluate((el) => el.click());
// Same Playwright/smooth-scroll hang as the switch: dispatch the close tap.
await page.getByRole('button', { name: 'Close menu' }).evaluate((el) => el.click());
await page.waitForFunction(
  () =>
    [...document.querySelectorAll('path')].some((p) => p.getAttribute('stroke') === '#7be0a3'),
  { timeout: 30000 },
);
console.log('tide station markers drawn');
// Markers rebuild when the view settles; let the layer settle before tapping.
await page.waitForTimeout(1000);
await page.locator('path[stroke="#7be0a3"]').first().click();
const tidePanel = page.locator('.tide-panel');
await tidePanel.waitFor({ timeout: 10000 });
await tidePanel.getByText(/High water/).waitFor({ timeout: 30000 });
console.log('tide station panel shows forecast');

await page.screenshot({ path: '/home/hatch/workspace/verify-rest-of-list.png' });
await browser.close();
console.log('VERIFY OK');
