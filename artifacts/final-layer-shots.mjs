import { chromium } from 'playwright';

const base = 'http://127.0.0.1:3000';
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 840 }, deviceScaleFactor: 2 });
const page = await context.newPage();
page.on('pageerror', (error) => console.log('pageerror:', error.message));

async function ready(ms = 3000) {
  await page.waitForSelector('.leaflet-container');
  await page.waitForTimeout(ms);
}
async function open() {
  if ((await page.locator('.menu-panel').count()) === 0) await page.locator('.menu-button').click();
  await page.waitForTimeout(250);
}
async function pickRow(label) {
  await open();
  await page.locator('.menu-row', { hasText: label }).first().click();
  await page.waitForTimeout(250);
}
async function close(ms = 5000) {
  await page.locator('.menu-panel .icon-button').first().click();
  await page.waitForTimeout(ms);
}

await page.goto(base, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'domcontentloaded' });
await ready();

await pickRow('Nautical');
await close();
await page.screenshot({ path: 'artifacts/layer-nautical.png' });

await pickRow('Relief');
await close();
await page.screenshot({ path: 'artifacts/layer-relief.png' });

await pickRow('Standard chart');
await close(1000);
await pickRow('Depth shading');
await close(5500);
await page.screenshot({ path: 'artifacts/layer-depth.png' });

await pickRow('Depth contours');
await close(5500);
await page.screenshot({ path: 'artifacts/layer-depth-contours.png' });

// Menu with the whole base list visible.
await open();
await page.screenshot({ path: 'artifacts/layers-menu.png' });
await close(300);

await pickRow('Depth shading');
await pickRow('Depth contours');
await close(500);

await page.goto(`${base}?lat=40.44&lon=-80.0&z=13`, { waitUntil: 'domcontentloaded' });
await ready(2500);
await pickRow('USACE IENC');
await close(9000);
await page.screenshot({ path: 'artifacts/layer-usace.png' });

await page.goto(`${base}?lat=40.7&lon=-74.03&z=12`, { waitUntil: 'domcontentloaded' });
await ready(2500);
await pickRow('NOAA Raster');
await close(8000);
await page.screenshot({ path: 'artifacts/layer-noaa-raster.png' });

await browser.close();
