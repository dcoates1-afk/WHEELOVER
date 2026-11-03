// Verify local pins end to end: add via placement tap, rename, reload and
// confirm the pin persists on the device. Run: node scripts/verify-pins.mjs
import { chromium } from 'playwright';

const browser = await chromium.launch();
const context = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await context.newPage();
await page.goto('http://127.0.0.1:3006/app?lat=48.0&lon=-126.0&z=10', { waitUntil: 'networkidle', timeout: 60000 });
const pinsButton = page.locator('.pins-button');
await pinsButton.waitFor({ state: 'visible', timeout: 30000 });
await pinsButton.click();
await page.locator('.pins-add').click();
const size = page.viewportSize();
await page.mouse.click(size.width * 0.5, size.height * 0.4);
await page.locator('.marnav-pin-wrap').first().waitFor({ state: 'attached', timeout: 10000 });
console.log('pin marker on chart: yes');
const firstName = await page.locator('.pins-list button strong').first().textContent();
console.log('pin in list:', firstName);
await page.locator('.pins-editor input').fill('Test Anchorage');
await page.waitForTimeout(500);
await page.reload({ waitUntil: 'networkidle', timeout: 60000 });
await page.locator('.pins-button').click();
const persisted = await page.locator('.pins-list button strong').first().textContent();
console.log('pin after reload:', persisted);
const markerStillThere = (await page.locator('.marnav-pin-wrap').count()) > 0;
console.log('pin marker after reload:', markerStillThere);
await page.screenshot({ path: 'verify-pins.png' });
await browser.close();
if (persisted !== 'Test Anchorage' || !markerStillThere) process.exit(1);
