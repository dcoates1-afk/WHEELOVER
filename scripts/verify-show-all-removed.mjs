// Verifies the "Show all marks" toggle is gone and the Chart detail section
// still renders with mark stats and the Legend & mark filters.
// Usage: PORT=3018 node build/server.mjs  (in another shell)
//        node scripts/verify-show-all-removed.mjs 3018
import { chromium } from 'playwright';

const port = process.argv[2] || '3018';
const browser = await chromium.launch();
const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
await page.goto(`http://localhost:${port}/app?lat=48.42&lon=-123.37&z=14`, { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Open menu' }).click();
const dialog = page.getByRole('dialog', { name: 'Menu' });
await dialog.waitFor({ state: 'attached' });
const text = (await dialog.textContent()) ?? '';
const checks = {
  noShowAllMarks: !text.includes('Show all marks'),
  hasLegendFilters: text.includes('Legend & mark filters'),
  hasMarkStats: (await page.getByTestId('mark-stats').count()) === 1,
};
console.log(JSON.stringify(checks));
if (!Object.values(checks).every(Boolean)) {
  console.log('VERIFY FAILED');
  process.exit(1);
}
console.log('VERIFY OK');
await browser.close();
