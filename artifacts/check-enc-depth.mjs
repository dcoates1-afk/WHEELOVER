import { chromium } from 'playwright';

const base = 'http://127.0.0.1:3000';
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2 });
const page = await context.newPage();
page.on('pageerror', (e) => console.log('pageerror:', e.message));
const exports = [];
page.on('response', (r) => {
  const u = r.url();
  if (u.includes('encdirect') && u.includes('layers=show')) {
    exports.push(`${/layers=show:(\d+)/.exec(u)?.[1]}:${r.status()}`);
  }
});

async function openMenu() {
  if ((await page.locator('.menu-panel').count()) === 0) await page.locator('.menu-button').click();
  await page.waitForTimeout(300);
}

await page.goto(`${base}?lat=40.7&lon=-74.01&z=15`, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('.leaflet-container');
await page.waitForTimeout(3500);
await openMenu();
const menuText = await page.locator('.menu-panel').textContent();
console.log('menu has soundings:', menuText.includes('Spot soundings'));
console.log('warning:', /only cover US waters/.test(menuText ?? ''));
await page.locator('.menu-row', { hasText: 'Depth contours' }).first().click();
await page.locator('.menu-row', { hasText: 'Spot soundings' }).first().click();
await page.locator('.menu-panel .icon-button').first().click();
await page.waitForTimeout(12000);
const stats = await page.evaluate(() => {
  const loaded = (pane) =>
    [...document.querySelectorAll(`${pane} .leaflet-tile`)].filter(
      (tile) => tile.complete && tile.naturalWidth >= 250,
    ).length;
  return {
    contours: loaded('.leaflet-contours-pane'),
    soundings: loaded('.leaflet-soundings-pane'),
    soundingsSrc: document.querySelector('.leaflet-soundings-pane .leaflet-tile')?.getAttribute('src') ?? null,
  };
});
console.log(JSON.stringify(stats));
console.log('exports:', exports.slice(0, 20).join(', '));
await page.screenshot({ path: 'artifacts/enc-depth-check.png' });
await browser.close();
