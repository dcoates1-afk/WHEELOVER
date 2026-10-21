import { chromium } from 'playwright';

const base = 'http://127.0.0.1:3000';
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1180, height: 800 }, deviceScaleFactor: 2 });
const page = await context.newPage();
page.on('console', (message) => {
  if (message.type() === 'error') console.log('console:', message.text().slice(0, 200));
});
page.on('pageerror', (error) => console.log('pageerror:', error.message));

async function chartReady() {
  await page.waitForSelector('.leaflet-container');
  await page.waitForTimeout(2500);
}

async function pick(label) {
  if ((await page.locator('.menu-panel').count()) === 0) await page.locator('.menu-button').click();
  await page.locator('.menu-row', { hasText: label }).first().click();
  await page.waitForTimeout(300);
  await page.locator('.menu-panel .icon-button').first().click();
  await page.waitForTimeout(7000);
}

await page.goto(base, { waitUntil: 'domcontentloaded' });
await chartReady();
await pick('Nautical');
await page.screenshot({ path: 'artifacts/layer-nautical.png' });
await pick('Relief');
await page.screenshot({ path: 'artifacts/layer-relief.png' });
await pick('Standard chart');
await pick('Depth shading');
await pick('Depth contours');
await page.screenshot({ path: 'artifacts/layer-depth-contours.png' });

await page.goto(`${base}?lat=40.44&lon=-80.0&z=13`, { waitUntil: 'domcontentloaded' });
await chartReady();
await pick('USACE IENC');
await page.screenshot({ path: 'artifacts/layer-usace-pittsburgh.png' });
await page.goto(`${base}?lat=40.7&lon=-74.03&z=12`, { waitUntil: 'domcontentloaded' });
await chartReady();
await pick('NOAA Raster');
await page.screenshot({ path: 'artifacts/layer-noaa-raster.png' });

await browser.close();
