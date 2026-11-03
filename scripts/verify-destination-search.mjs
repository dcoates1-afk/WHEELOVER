// Verify destination search end to end: type, pick a result, confirm the
// chart flies there and pins the place. Run: node scripts/verify-destination-search.mjs
//
// NOTE: the audit browser cannot reach the live internet, so Nominatim is
// answered with a canned response here. The live service itself was verified
// from the shell, and the request URL + parsing are covered by unit tests.
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
await page.route('**/nominatim.openstreetmap.org/search*', (route) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([
      { display_name: 'Cowes, Isle of Wight, England, United Kingdom', lat: '50.76', lon: '-1.30' },
      { display_name: 'Cowes, Phillip Island, Victoria, Australia', lat: '-38.45', lon: '145.24' },
    ]),
  }),
);
page.on('console', (msg) => {
  if (msg.type() === 'error') console.log('[console.error]', msg.text());
});
await page.goto('http://127.0.0.1:3005/app?lat=48.42&lon=-123.37&z=12', { waitUntil: 'networkidle', timeout: 60000 });
const input = page.locator('input[aria-label="Search destinations"]');
await input.waitFor({ state: 'visible', timeout: 30000 });
await input.fill('Cowes Isle of Wight');
await page.locator('.destination-search-results button').first().waitFor({ state: 'visible', timeout: 30000 });
const labels = await page.locator('.destination-search-results button strong').allTextContents();
console.log('results:', labels);
await page.locator('.destination-search-results button').first().click();
await page.waitForTimeout(2500);
const pin = page.locator('path[stroke="#f2a65a"]');
await pin.first().waitFor({ state: 'attached', timeout: 10000 });
const box = await pin.first().boundingBox();
const viewport = page.viewportSize();
console.log('pin box:', box, 'viewport:', viewport);
const inView = box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height;
console.log('pin in viewport (map flew there):', inView);
await pin.first().hover().catch(() => {});
await page.waitForTimeout(500);
const tip = await page.locator('.leaflet-tooltip:visible').allTextContents().catch(() => []);
console.log('visible tooltips:', tip);
await page.screenshot({ path: 'verify-destination-search.png' });
await browser.close();
if (!inView) process.exit(1);
