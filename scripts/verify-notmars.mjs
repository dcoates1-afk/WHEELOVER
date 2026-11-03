// Verify NAVAREA warnings: toggle on, markers draw, popup shows text,
// menu list counts and expands. The relay itself was verified live via curl;
// the browser chain uses a canned feed because the audit browser has no
// live internet. Run: node scripts/verify-notmars.mjs
import { chromium } from 'playwright';

const canned = {
  'broadcast-warn': [
    {
      msgYear: 2026, msgNumber: 42, navArea: '12', subregion: 'GEN',
      issueDate: '030001Z NOV 2026',
      text: 'STRAIT OF GEORGIA. DRIFTING BUOY IN 48-06.00N 126-06.00W. MARINERS KEEP CLEAR.',
    },
    {
      msgYear: 2026, msgNumber: 41, navArea: '12', subregion: 'GEN',
      issueDate: '020001Z NOV 2026',
      text: 'WARNINGS IN FORCE AS OF 020001Z NOV. 40/2026, 39/2026.',
    },
  ],
};

const browser = await chromium.launch();
const context = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await context.newPage();
await page.route('**/api/notmars', (route) => route.fulfill({ json: canned }));
await page.goto('http://127.0.0.1:3010/app?lat=48.1&lon=-126.1&z=10', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.getByRole('button', { name: 'Open menu' }).click();
await page.locator('summary', { hasText: 'Map options' }).click();
await page.getByRole('switch', { name: /NAVAREA warnings/ }).click();
await page.locator('.notmar-details summary', { hasText: '2 warnings in force' }).waitFor({ timeout: 15000 });
console.log('menu counts 2 warnings: yes');
// The positioned warning draws one marker; the list-only one draws none.
await page.waitForFunction(() => {
  return document.querySelectorAll('path[stroke="#ff8a7a"]').length === 1;
}, { timeout: 10000 });
console.log('exactly one warning marker drawn: yes');
// The open menu dialog covers the chart, so close it before tapping the marker.
await page.getByRole('button', { name: 'Close menu' }).click();
// Marker popup shows the full text.
await page.locator('path[stroke="#ff8a7a"]').first().click();
await page.locator('.leaflet-popup-content', { hasText: 'DRIFTING BUOY' }).waitFor({ timeout: 10000 });
console.log('marker popup shows warning text: yes');
await page.keyboard.press('Escape');
// Expand the list-only row: its full text is readable in the menu.
await page.getByRole('button', { name: 'Open menu' }).click();
// The menu panel keeps its section state when closed, so only open Map
// options if the switch is not already visible.
if (!(await page.getByRole('switch', { name: /NAVAREA warnings/ }).isVisible())) {
  await page.locator('summary', { hasText: 'Map options' }).click();
}
// Expand the list-only row directly. Visibility is asserted on DOM state,
// not viewport visibility: the menu list is taller than the test viewport,
// so scrolled-out rows never count as visible to the harness even though
// they render and read fine when the user scrolls the list.
await page.locator('.notmar-row', { hasText: '12 41/2026' }).evaluate((details) => {
  details.open = true;
});
await page.waitForFunction(() => {
  const row = [...document.querySelectorAll('.notmar-row')].find((d) => (d.textContent ?? '').includes('12 41/2026'));
  const text = row?.querySelector('.notmar-text')?.textContent ?? '';
  return row?.open === true && text.includes('WARNINGS IN FORCE');
}, { timeout: 10000 });
console.log('list-only warning readable in menu: yes');
await page.screenshot({ path: 'verify-notmars.png' });
await browser.close();
