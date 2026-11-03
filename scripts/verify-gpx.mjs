// Verify GPX export/import end to end. Run: node scripts/verify-gpx.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const browser = await chromium.launch();
const context = await browser.newContext({ ignoreHTTPSErrors: true, acceptDownloads: true });
const page = await context.newPage();
await page.addInitScript(() => {
  // Seed only once: addInitScript re-runs on reload, and must not wipe
  // the imported pin that persistence is supposed to prove.
  if (!localStorage.getItem('wheel-over:pins')) {
    localStorage.setItem('wheel-over:pins', JSON.stringify([
      { id: 'pin-seed', lat: 48.0, lon: -126.0, title: 'Seed Anchorage', note: 'seed note', createdAt: 1000 },
    ]));
  }
});
await page.goto('http://127.0.0.1:3009/app?lat=48.0&lon=-126.0&z=12', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.locator('.boat-button').click();
await page.getByRole('tab', { name: 'Tracks' }).click();
// Export: the downloaded file must contain the seeded pin's name.
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 15000 }),
  page.locator('.track-recording .boat-submit', { hasText: 'Export GPX' }).click(),
]);
const exported = readFileSync(await download.path(), 'utf8');
console.log('export contains seeded pin:', exported.includes('Seed Anchorage'));
console.log('export has wpt, no trk (no tracks seeded):', exported.includes('<wpt') && !exported.includes('<trk>'));
if (!exported.includes('Seed Anchorage')) process.exit(1);
// Import: canned file with 1 wpt, 1 trk, 1 rte.
await page.locator('input[aria-label="Import a GPX file"]').setInputFiles('/home/hatch/workspace/gpx-import-sample.gpx');
await page.locator('.boat-panel', { hasText: 'Added 1 pin(s) and 1 track(s)' }).waitFor({ timeout: 10000 });
await page.locator('.boat-panel', { hasText: '1 planned route(s) skipped' }).waitFor({ timeout: 10000 });
console.log('import result message: yes');
await page.locator('.boat-list li', { hasText: '2 points' }).first().waitFor({ timeout: 10000 });
console.log('imported track in list: yes');
await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
await page.locator('.pins-button').click();
await page.locator('.pins-panel', { hasText: 'Imported Cove' }).waitFor({ timeout: 10000 });
console.log('imported pin persisted after reload: yes');
await page.screenshot({ path: 'verify-gpx.png' });
await browser.close();
