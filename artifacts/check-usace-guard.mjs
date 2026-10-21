import { chromium } from 'playwright';

const base = 'http://127.0.0.1:3000';
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 820, height: 1000 } });
const page = await context.newPage();
page.on('console', (m) => {
  if (m.type() === 'error') console.log('console:', m.text().slice(0, 200));
});
await page.goto(`${base}?lat=40.44&lon=-80.0&z=13`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.leaflet-container');
await page.waitForTimeout(2500);
await page.locator('.menu-button').click();
await page.locator('.menu-row', { hasText: 'USACE IENC' }).first().click();
await page.waitForTimeout(300);
console.log('pittsburgh warning:', JSON.stringify((await page.locator('.inline-warning').allTextContents()).slice(0, 2)));

await page.goto(`${base}?lat=40.7&lon=-74.03&z=13`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.leaflet-container');
await page.waitForTimeout(3500);
await page.locator('.menu-button').click();
await page.waitForTimeout(500);
console.log('nyc warnings:', JSON.stringify((await page.locator('.inline-warning').allTextContents()).slice(0, 3)));
await browser.close();
