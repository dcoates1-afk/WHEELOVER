// Verifies the Data sources & disclaimer link moved out of Map options to
// the bottom of the main menu.
// Usage: PORT=3017 node build/server.mjs  (in another shell)
//        node scripts/verify-disclaimer-link.mjs 3017
import { chromium } from 'playwright';

const port = process.argv[2] || '3017';
const browser = await chromium.launch();
const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
await page.goto(`http://localhost:${port}/app?lat=48.42&lon=-123.37&z=14`, { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Open menu' }).click();
await page.getByRole('dialog', { name: 'Menu' }).waitFor({ state: 'attached' });

// The link must exist, point at /disclaimer, and sit outside Map options:
// its nearest section ancestor must NOT be the Map options section, and it
// must be the last child of the menu body (after Mark database).
const result = await page.evaluate(() => {
  const link = document.querySelector('a.disclaimer-link');
  if (!link) return 'no link found';
  const section = link.closest('details.menu-section');
  const parent = link.parentElement;
  const last = parent ? parent.lastElementChild === link : false;
  return JSON.stringify({
    href: link.getAttribute('href'),
    inSection: section ? section.querySelector('summary')?.textContent?.trim() : null,
    isLastInMenuBody: last,
  });
});
console.log(result);
const parsed = JSON.parse(result);
if (parsed.href !== '/disclaimer' || parsed.inSection !== null || !parsed.isLastInMenuBody) {
  console.log('VERIFY FAILED');
  process.exit(1);
}
console.log('VERIFY OK');
await browser.close();
