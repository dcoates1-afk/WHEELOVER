// Verifies saved routes + MOB in a real browser against the local server.
// Usage: PORT=3015 node build/server.mjs  (in another shell)
//        node scripts/verify-saved-routes-mob.mjs 3015
import { chromium } from 'playwright';

const port = process.argv[2] || '3015';
const base = `http://localhost:${port}/app?lat=48.0&lon=-126.0&z=10`;

const browser = await chromium.launch();
const page = await browser.newPage();
// Seed an active route once; the guard keeps later reloads from wiping
// the saved route the test creates.
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
});
await page.goto(base, { waitUntil: 'domcontentloaded' });
await page.locator('.leaflet-tile').first().waitFor({ state: 'attached', timeout: 30000 });

const routePanel = page.locator('.route-panel');
await page.getByRole('button', { name: 'Route builder' }).click();
await routePanel.waitFor({ timeout: 10000 });
const count = page.locator('.route-panel .route-count');
await count.waitFor();
console.log('route count:', await count.textContent());

// Save the seeded route under a name.
await page.getByLabel('Saved route name').fill('Test Passage');
await routePanel.getByRole('button', { name: 'Save', exact: true }).click();
await routePanel.getByRole('button', { name: 'Test Passage · 2 waypoints' }).waitFor({ timeout: 10000 });
console.log('saved route listed');

// Persistence across reload.
await page.reload({ waitUntil: 'domcontentloaded' });
await page.locator('.leaflet-tile').first().waitFor({ state: 'attached', timeout: 30000 });
await page.getByRole('button', { name: 'Route builder' }).click();
await routePanel.waitFor({ timeout: 10000 });
await routePanel.getByRole('button', { name: 'Test Passage · 2 waypoints' }).waitFor({ timeout: 10000 });
console.log('saved route persisted after reload');

// Load replaces the active route: clear, then load, count returns to 2.
await routePanel.getByRole('button', { name: 'Clear route' }).click();
await page.waitForFunction(
  () => document.querySelector('.route-panel .route-count')?.textContent === '0',
  { timeout: 10000 },
);
await routePanel.getByRole('button', { name: 'Test Passage · 2 waypoints' }).click();
await page.waitForFunction(
  () => document.querySelector('.route-panel .route-count')?.textContent === '2',
  { timeout: 10000 },
);
console.log('load restored 2 waypoints');

// Delete the saved route.
await routePanel.getByRole('button', { name: 'Delete saved route Test Passage' }).click();
await routePanel.getByText('No saved routes yet.').waitFor({ timeout: 10000 });
console.log('saved route deleted');

// MOB: no GPS fix in headless, so it records the screen centre. The open
// route panel covers the MOB button at its offset, so close it first.
await routePanel.getByRole('button', { name: 'Close route builder' }).click();
await page.getByRole('button', { name: 'Man overboard' }).click();
const mobPanel = page.locator('.mob-panel');
await mobPanel.waitFor({ timeout: 10000 });
await mobPanel.getByText(/screen centre/).waitFor({ timeout: 10000 });
const hasMobMarker = await page.evaluate(() =>
  [...document.querySelectorAll('path')].some((p) => p.getAttribute('stroke') === '#ff6b5e'),
);
console.log('mob marker on chart:', hasMobMarker);
if (!hasMobMarker) throw new Error('MOB marker missing from chart');
await mobPanel.getByRole('button', { name: 'Clear MOB' }).click();
await mobPanel.waitFor({ state: 'detached', timeout: 10000 });
const markerAfterClear = await page.evaluate(() =>
  [...document.querySelectorAll('path')].some((p) => p.getAttribute('stroke') === '#ff6b5e'),
);
console.log('mob marker after clear:', markerAfterClear);
if (markerAfterClear) throw new Error('MOB marker still on chart after clear');

await page.screenshot({ path: '/home/hatch/workspace/verify-saved-routes-mob.png' });
await browser.close();
console.log('VERIFY OK');
