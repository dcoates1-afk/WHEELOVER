import { chromium } from 'playwright';
const base = 'http://127.0.0.1:3000';
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 900, height: 700 } });
const page = await context.newPage();
page.on('pageerror', (e) => console.log('pageerror:', e.message));
let exports = [];
page.on('response', (r) => {
  const u = r.url();
  if (u.includes('encdirect') && u.includes('layers=show')) {
    exports.push(`${/layers=show:(\d+)/.exec(u)?.[1]}:${r.status()}`);
  }
});

async function openMenu() {
  if ((await page.locator('.menu-panel').count()) === 0) await page.locator('.menu-button').click();
  await page.waitForTimeout(250);
}
async function toggleContours() {
  await openMenu();
  await page.locator('.menu-row', { hasText: 'Depth contours' }).first().click();
  await page.locator('.menu-panel .icon-button').first().click();
  await page.waitForTimeout(8000);
}
async function report(label) {
  const info = await page.evaluate(() => {
    const tiles = [...document.querySelectorAll('.leaflet-contours-pane .leaflet-tile')];
    return {
      count: tiles.length,
      enc: tiles.filter((t) => (t.getAttribute('src') ?? '').includes('encdirect')).length,
      gebco: tiles.filter((t) => (t.getAttribute('src') ?? '').includes('GEBCO_contours')).length,
    };
  });
  console.log(label, JSON.stringify(info), 'exports:', exports.slice(0, 6).join(', ') || 'none');
}

await page.goto(`${base}?lat=40.5&lon=-73.9&z=8`, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('.leaflet-container');
await page.waitForTimeout(3000);
await toggleContours();
await report('z8');
await page.screenshot({ path: 'artifacts/depth-z8.png' });

exports = [];
await page.goto(`${base}?lat=40.5&lon=-73.9&z=10`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.leaflet-container');
await page.waitForTimeout(9000);
await report('z10');
await page.screenshot({ path: 'artifacts/depth-z10.png' });

await browser.close();
