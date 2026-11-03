// Verify the route builder: arm, tap two waypoints, leg + totals show,
// drag a waypoint, reload persists. Localhost-only, no internet needed.
// Run: node scripts/verify-route-builder.mjs
import { chromium } from 'playwright';

const browser = await chromium.launch();
const context = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await context.newPage();
await page.goto('http://127.0.0.1:3012/app?lat=48.0&lon=-126.0&z=10', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.getByRole('button', { name: 'Route builder' }).click();
await page.getByRole('button', { name: '+ Add waypoint' }).click();
await page.locator('.route-adding', { hasText: 'Tap the chart to add waypoints' }).waitFor({ timeout: 10000 });
console.log('adding armed: yes');
// Let the Leaflet map finish initializing before tapping: tiles being
// requested means the map object and its click handler exist. (Leaflet
// panes report a 0x0 box by design, so pane size is never the gate.)
await page.waitForFunction(() => document.querySelectorAll('.leaflet-tile').length > 0, { timeout: 30000 });
await page.waitForTimeout(500);
const box = await page.locator('.leaflet-container').boundingBox();
if (!box) throw new Error('no map container');
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;
await page.mouse.click(cx, cy);
await page.waitForTimeout(800);
const after1 = await page.evaluate(() => document.querySelector('.route-count')?.textContent);
console.log('after tap 1, count:', after1);
await page.mouse.click(cx + 120, cy);
await page.waitForTimeout(800);
const after2 = await page.evaluate(() => document.querySelector('.route-count')?.textContent);
console.log('after tap 2, count:', after2);
await page.waitForFunction(() => document.querySelector('.route-count')?.textContent === '2', { timeout: 10000 });
console.log('two waypoints added: yes');
await page.waitForFunction(() => document.querySelectorAll('.marnav-route-dot').length === 2, { timeout: 10000 });
console.log('two waypoint dots drawn: yes');
const legBefore = await page.locator('.route-legs li').first().textContent();
console.log('leg line:', (legBefore ?? '').trim());
await page.waitForFunction(() => {
  const path = [...document.querySelectorAll('path')].find((p) => p.getAttribute('stroke-dasharray') === '8 6');
  return Boolean(path);
}, { timeout: 10000 });
console.log('dashed route line drawn: yes');
// Drag the first waypoint dot and confirm the leg recomputes.
const dot = page.locator('.marnav-route-dot').first();
const dotBox = await dot.boundingBox();
if (!dotBox) throw new Error('no waypoint dot');
await page.mouse.move(dotBox.x + dotBox.width / 2, dotBox.y + dotBox.height / 2);
await page.mouse.down();
await page.mouse.move(dotBox.x + dotBox.width / 2 + 60, dotBox.y + dotBox.height / 2, { steps: 10 });
await page.mouse.up();
await page.waitForFunction((before) => {
  const leg = document.querySelector('.route-legs li');
  return leg && leg.textContent !== before;
}, legBefore, { timeout: 10000 });
console.log('drag recomputes leg: yes');
// Reload: the route persists on this device.
await page.reload({ waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Route builder' }).click();
await page.waitForFunction(() => document.querySelector('.route-count')?.textContent === '2', { timeout: 15000 });
console.log('route persists after reload: yes');
await page.screenshot({ path: 'verify-route-builder.png' });
await browser.close();
