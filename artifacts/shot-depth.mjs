import { chromium } from 'playwright';

const base = 'http://127.0.0.1:3000';
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1180, height: 800 }, deviceScaleFactor: 2 });
const page = await context.newPage();

async function ready() {
  await page.waitForSelector('.leaflet-container');
  await page.waitForTimeout(2500);
}
async function open() {
  if ((await page.locator('.menu-panel').count()) === 0) await page.locator('.menu-button').click();
}
async function pickRow(label) {
  await open();
  await page.locator('.menu-row', { hasText: label }).first().click();
  await page.waitForTimeout(250);
}
async function close() {
  await page.locator('.menu-panel .icon-button').first().click();
  await page.waitForTimeout(6000);
}

await page.goto(base, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'domcontentloaded' });
await ready();
await pickRow('Depth shading');
await close();
await page.screenshot({ path: 'artifacts/depth-only-osm.png' });

await page.goto(`${base}?lat=40.7&lon=-74.03&z=12`, { waitUntil: 'domcontentloaded' });
await ready();
await pickRow('NOAA Raster');
await close();
await page.screenshot({ path: 'artifacts/noaa-raster-plain.png' });

await pickRow('Depth shading');
await close();
await page.screenshot({ path: 'artifacts/noaa-raster-depth.png' });

await browser.close();
