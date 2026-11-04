// Verifies the NAVAREA warnings stale-cache fallback: when the relay serves
// its last good copy (stale: true), the menu shows the warnings plus the
// "last good" note, and the marker still draws, against a canned response.
// Usage: PORT=3021 node build/server.mjs  (in another shell)
//        node scripts/verify-notmar-stale.mjs 3021
import { chromium } from 'playwright';

const port = process.argv[2] || '3021';
const browser = await chromium.launch();
const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();

const stub = {
  'broadcast-warn': [
    {
      navArea: '4',
      msgNumber: '123',
      msgYear: '2026',
      subregion: '',
      issueDate: '2026-11-03',
      text: 'TEST WARNING 14-51.78N 061-18.18W',
    },
  ],
  fetchedAt: '2026-11-03T00:00:00.000Z',
  stale: true,
};
await page.route('**/api/notmars', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stub) }),
);

await page.goto(`http://localhost:${port}/app?lat=14.86&lon=-61.3&z=10`, { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Open menu' }).click();
const dialog = page.getByRole('dialog', { name: 'Menu' });
await dialog.waitFor({ state: 'attached' });

// The Map options section starts closed; open it before querying its rows.
const summary = dialog.locator('summary', { hasText: 'Map options' }).first();
await summary.evaluate((el) => el.click());
const toggle = dialog.getByRole('switch', { name: 'NAVAREA warnings — off' });
await toggle.evaluate((el) => el.click());
await dialog.getByText('1 warnings in force').waitFor({ timeout: 15000 });
const menuText = (await dialog.textContent()) ?? '';
await page.getByRole('button', { name: 'Close menu' }).click();

const salmon = page.locator('path[stroke="#ff8a7a"]');
await salmon.first().waitFor({ timeout: 15000 });

const checks = {
  menuListShowsCount: menuText.includes('1 warnings in force'),
  staleNoteShown: menuText.includes('Showing last good warnings — fresh data could not be loaded.'),
  markerDrawn: (await salmon.count()) >= 1,
};
console.log(JSON.stringify(checks));
if (!Object.values(checks).every(Boolean)) {
  console.log('VERIFY FAILED');
  process.exit(1);
}
console.log('VERIFY OK');
await browser.close();
