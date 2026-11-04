// Verifies the NAVAREA warnings in-session refresh: the layer loads on
// switch-on, and a 15-minute timer tick replaces the held copy without a
// reload, against a canned /api/notmars that changes between calls.
// Usage: PORT=3022 node build/server.mjs  (in another shell)
//        node scripts/verify-notmar-refresh.mjs 3022
import { chromium } from 'playwright';

const port = process.argv[2] || '3022';
const browser = await chromium.launch();
const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
// Fake timers before the app loads, so the 15-minute interval can be jumped.
await page.clock.install();

const warning = (number) => ({
  navArea: '4',
  msgNumber: String(number),
  msgYear: '2026',
  subregion: '',
  issueDate: '2026-11-03',
  text: `TEST WARNING ${number} 14-51.78N 061-18.18W`,
});
let calls = 0;
await page.route('**/api/notmars', (route) => {
  calls += 1;
  const body = {
    'broadcast-warn': [warning(calls === 1 ? 111 : 222)],
    fetchedAt: new Date().toISOString(),
  };
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});

await page.goto(`http://localhost:${port}/app?lat=14.86&lon=-61.3&z=10`, { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Open menu' }).click();
const dialog = page.getByRole('dialog', { name: 'Menu' });
await dialog.waitFor({ state: 'attached' });

// The Map options section starts closed; open it before querying its rows.
const summary = dialog.locator('summary', { hasText: 'Map options' }).first();
await summary.evaluate((el) => el.click());
const toggle = dialog.getByRole('switch', { name: 'NAVAREA warnings — off' });
await toggle.evaluate((el) => el.click());
// List items live inside the (possibly closed) section body, so poll the
// dialog's text rather than waiting on visibility.
await page.waitForFunction(
  () => document.querySelector('[role="dialog"]')?.textContent?.includes('4 111/2026'),
  { timeout: 15000 },
);

// Jump the 15-minute interval: the second fetch must replace the held copy.
await page.clock.fastForward(15 * 60 * 1000);
await page.waitForFunction(
  () => document.querySelector('[role="dialog"]')?.textContent?.includes('4 222/2026'),
  { timeout: 15000 },
);
const menuText = (await dialog.textContent()) ?? '';

const checks = {
  refreshReplacesRatherThanAppends:
    menuText.includes('4 222/2026') && !menuText.includes('4 111/2026'),
  secondFetchHappened: calls >= 2,
};
console.log(JSON.stringify({ ...checks, calls }));
if (!Object.values(checks).every(Boolean)) {
  console.log('VERIFY FAILED');
  process.exit(1);
}
console.log('VERIFY OK');
await browser.close();
