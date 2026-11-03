// Verify the route hazard check against a real ferry lane from the local
// marine archive (Balsa Cerro Negro, Chile). Localhost-only: the ferry
// shards are served by the local server, no live mirrors needed.
// Run: node scripts/verify-route-hazards.mjs
import { chromium } from 'playwright';

const browser = await chromium.launch();
const context = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await context.newPage();
await page.goto('http://127.0.0.1:3013/app?lat=-36.85531&lon=-72.38543&z=16', { waitUntil: 'domcontentloaded', timeout: 60000 });
// Ferry shards load per view from the local archive; wait for one, but keep
// going on timeout — the panel still renders from whatever loaded.
try {
  await page.waitForResponse(/ferries\/.*\.json/, { timeout: 30000 });
  console.log('ferry shard loaded: yes');
} catch {
  console.log('ferry shard loaded: timeout (continuing)');
}
await page.getByRole('button', { name: 'Route builder' }).click();
const latInput = page.getByLabel('Waypoint latitude');
const lonInput = page.getByLabel('Waypoint longitude');
await latInput.fill('-36.85531');
await lonInput.fill('-72.39543');
await page.locator('.route-typed button').click();
await latInput.fill('-36.85531');
await lonInput.fill('-72.37543');
await page.locator('.route-typed button').click();
await page.waitForFunction(() => document.querySelector('.route-count')?.textContent === '2', { timeout: 10000 });
console.log('two waypoints typed: yes');
await page.waitForFunction(() => {
  const items = [...document.querySelectorAll('.route-hazards-legs li')];
  return items.some((li) => /ferry/i.test(li.textContent ?? ''));
}, { timeout: 30000 });
const hazardText = await page.locator('.route-hazards-legs li').first().textContent();
console.log('hazard line:', (hazardText ?? '').trim());
await page.screenshot({ path: 'verify-route-hazards.png' });
await browser.close();
