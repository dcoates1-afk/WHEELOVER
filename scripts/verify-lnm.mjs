// Verifies the Local Notices layer: the menu toggle, amber map markers for
// a point and a polygon, the popup text, and the menu list, against a
// canned /api/lnm response so the check does not depend on NAVCEN.
// Usage: PORT=3021 node build/server.mjs  (in another shell)
//        node scripts/verify-lnm.mjs 3021
import { chromium } from 'playwright';

const port = process.argv[2] || '3021';
const browser = await chromium.launch();
const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();

const stub = {
  features: [
    {
      id: 'bridge:1',
      category: 'bridge',
      categoryLabel: 'Bridges',
      title: 'Test Bridge Notice',
      waterway: 'Victoria Harbour',
      subCategory: 'Bridges',
      beginMs: 1726228800000,
      endMs: null,
      description: 'Test bridge description.',
      geometry: { type: 'Point', coordinates: [-123.37, 48.42] },
    },
    {
      id: 'tessAdv:9',
      category: 'tessAdv',
      categoryLabel: 'TESS Advisory',
      title: 'Test Advisory Polygon',
      waterway: 'Haro Strait',
      subCategory: null,
      beginMs: null,
      endMs: null,
      description: '',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-123.4, 48.4],
            [-123.34, 48.4],
            [-123.34, 48.44],
            [-123.4, 48.44],
            [-123.4, 48.4],
          ],
        ],
      },
    },
  ],
  meta: {
    files: 57,
    total: 2,
    returned: 2,
    truncated: false,
    incomplete: [],
    fetchedAt: new Date().toISOString(),
    stale: false,
    cached: false,
  },
};
await page.route('**/api/lnm*', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stub) }),
);

await page.goto(`http://localhost:${port}/app?lat=48.42&lon=-123.37&z=14`, { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Open menu' }).click();
const dialog = page.getByRole('dialog', { name: 'Menu' });
await dialog.waitFor({ state: 'attached' });

// The Map options section starts closed; open it before querying its rows.
const summary = dialog.locator('summary', { hasText: 'Map options' }).first();
await summary.evaluate((el) => el.click());
const toggle = dialog.getByRole('switch', { name: 'Local Notices — off' });
await toggle.evaluate((el) => el.click());
await dialog.getByText('2 local notices in view').waitFor({ timeout: 15000 });
const menuText = (await dialog.textContent()) ?? '';
await page.getByRole('button', { name: 'Close menu' }).click();

const amber = page.locator('path[stroke="#f5b942"]');
await amber.first().waitFor({ timeout: 15000 });
const amberCount = await amber.count();
// The polygon path paints over the point marker, so a normal click is
// intercepted; dispatch the click on the small (point) marker directly.
await page.evaluate(() => {
  const paths = [...document.querySelectorAll('path[stroke="#f5b942"]')];
  const small = paths.find((element) => {
    const rect = element.getBoundingClientRect();
    return rect.width < 40 && rect.height < 40;
  });
  if (!small) throw new Error('no small amber marker found');
  small.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
});
const popup = page.locator('.leaflet-popup-content');
await popup.waitFor({ timeout: 10000 });
const popupText = (await popup.textContent()) ?? '';

const checks = {
  menuListShowsCount: menuText.includes('2 local notices in view'),
  menuListShowsCategories: menuText.includes('Bridges') && menuText.includes('TESS Advisory'),
  amberMarkersPresent: amberCount >= 2,
  popupShowsTitle: popupText.includes('Test Bridge Notice'),
  popupShowsDescription: popupText.includes('Test bridge description.'),
};
console.log(JSON.stringify(checks));
if (!Object.values(checks).every(Boolean)) {
  console.log('VERIFY FAILED');
  process.exit(1);
}

// Disclaimer page carries the new source entry.
await page.goto(`http://localhost:${port}/disclaimer`, { waitUntil: 'domcontentloaded' });
const disclaimerText = (await page.textContent('body')) ?? '';
if (!disclaimerText.includes('Local Notices to Mariners')) {
  console.log('VERIFY FAILED: disclaimer source entry missing');
  process.exit(1);
}
console.log('VERIFY OK');
await browser.close();
