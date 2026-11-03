// Verify the anti-grounding flag with a stubbed GEBCO identify endpoint:
// deep water, then a shallow band, then land along one leg. Localhost-only.
// Run: node scripts/verify-route-grounding.mjs
import { chromium } from 'playwright';

const browser = await chromium.launch();
const context = await browser.newContext({ ignoreHTTPSErrors: true });
// Seed a draught (guarded: only when the key is absent, so reloads keep it).
await context.addInitScript(() => {
  if (!localStorage.getItem('wheel-over:settings')) {
    localStorage.setItem('wheel-over:settings', JSON.stringify({ boat: { draughtM: '2.5' } }));
  }
});
const page = await context.newPage();
await page.route('**/di-elevation.img.arcgis.com/**', async (route) => {
  const url = new URL(route.request().url());
  const geometry = JSON.parse(url.searchParams.get('geometry') ?? '{"points":[]}');
  const results = (geometry.points ?? []).map(([lon, lat]) => ({
    location: { x: lon, y: lat },
    value: lon >= -125.95 ? 4 : lon >= -125.97 ? -1.5 : -30,
  }));
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results }) });
});
await page.goto('http://127.0.0.1:3014/app?lat=48.0&lon=-125.95&z=12', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.getByRole('button', { name: 'Route builder' }).click();
const latInput = page.getByLabel('Waypoint latitude');
const lonInput = page.getByLabel('Waypoint longitude');
await latInput.fill('48.0');
await lonInput.fill('-126.0');
await page.locator('.route-typed button').click();
await latInput.fill('48.0');
await lonInput.fill('-125.9');
await page.locator('.route-typed button').click();
await page.waitForFunction(() => document.querySelector('.route-count')?.textContent === '2', { timeout: 10000 });
console.log('two waypoints typed: yes');
await page.getByRole('button', { name: 'Check grounding' }).click();
await page.waitForFunction(() => {
  const items = [...document.querySelectorAll('.route-hazards-legs li')];
  return items.some((li) => /May cross land/.test(li.textContent ?? ''));
}, { timeout: 30000 });
console.log('land flag shown: yes');
await page.waitForFunction(() => {
  const items = [...document.querySelectorAll('.route-hazards-legs li')];
  return items.some((li) => /Shallowest water 1\.5 m/.test(li.textContent ?? ''));
}, { timeout: 10000 });
console.log('shallow flag shown: yes');
await page.screenshot({ path: 'verify-route-grounding.png' });
await browser.close();
