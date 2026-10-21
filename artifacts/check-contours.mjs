import { chromium } from 'playwright';

const base = 'http://127.0.0.1:3000';
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 2 });
const page = await context.newPage();
page.on('pageerror', (error) => console.log('pageerror:', error.message));

async function openMenu() {
  if ((await page.locator('.menu-panel').count()) === 0) await page.locator('.menu-button').click();
  await page.waitForTimeout(250);
}
async function toggle(label) {
  await openMenu();
  await page.locator('.menu-row', { hasText: label }).first().click();
  await page.waitForTimeout(200);
}
async function closeMenu(ms = 5000) {
  await page.locator('.menu-panel .icon-button').first().click();
  await page.waitForTimeout(ms);
}

for (const zoom of [11, 13, 16]) {
  await page.goto(`${base}?lat=50.76&lon=-1.2&z=${zoom}`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${base}?lat=50.76&lon=-1.2&z=${zoom}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.leaflet-container');
  await page.waitForTimeout(3000);
  await toggle('Depth shading');
  await toggle('Depth contours');
  await closeMenu(6000);
  const stats = await page.evaluate(() => {
    const count = (pane) => document.querySelectorAll(`${pane} .leaflet-tile`).length;
    const tile = document.querySelector('.leaflet-contours-pane .leaflet-tile');
    return {
      zoom: document.querySelector('.marnav-map')?.getAttribute('data-zoom'),
      depth: count('.leaflet-depth-pane'),
      contours: count('.leaflet-contours-pane'),
      src: tile?.getAttribute('src') ?? null,
      width: tile?.getAttribute('width') ?? null,
    };
  });
  console.log(`zoom ${zoom}:`, JSON.stringify(stats));
  await page.screenshot({ path: `artifacts/contour-zoom-${zoom}.png` });
  await toggle('Depth shading');
  await toggle('Depth contours');
  await closeMenu(500);
}

await browser.close();
