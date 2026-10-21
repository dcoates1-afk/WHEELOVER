import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://127.0.0.1:3000';
const artifacts = new URL('./', import.meta.url).pathname;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

await page.goto(`${base}?lat=50.76&lon=-1.29&z=14`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.leaflet-container');
await page.waitForFunction(() => document.querySelectorAll('.marnav-mark-wrap').length > 3, null, {
  timeout: 30_000,
});

await page.locator('.menu-button').click();
await page.waitForSelector('.menu-panel');
const menu = (await page.locator('.menu-panel').textContent()) ?? '';
console.log('menu has depth numbers:', menu.includes('Depth numbers'));
console.log('menu has public places:', menu.includes('Public places'));

for (const label of ['Depth numbers', 'Show public places']) {
  await page.locator('.menu-row', { hasText: label }).first().click();
  await page.waitForTimeout(200);
}
await page.locator('.menu-panel .icon-button').first().click();
await page.waitForTimeout(500);

try {
  await page.waitForFunction(() => document.querySelectorAll('.marnav-depth-num').length >= 5, null, {
    timeout: 30_000,
  });
} catch {
  console.log('depth labels did not reach 5');
}
try {
  await page.waitForFunction(
    () => [...document.querySelectorAll('.marnav-depth-num')].some((el) => el.title.includes('EMODnet')),
    null,
    { timeout: 30_000 },
  );
} catch {
  console.log('no EMODnet refinement arrived');
}
const depths = await page.evaluate(() =>
  [...document.querySelectorAll('.marnav-depth-num')].slice(0, 12).map((el) => `${el.textContent}:${el.title.includes('EMODnet') ? 'e' : 'g'}`),
);
console.log('depth labels:', depths.length, depths.join(','));

try {
  await page.waitForFunction(() => document.querySelectorAll('.marnav-poi').length >= 3, null, {
    timeout: 30_000,
  });
} catch {
  console.log('places did not reach 3');
}
const places = await page.evaluate(() =>
  [...document.querySelectorAll('.marnav-poi-wrap')].slice(0, 8).map((el) => el.getAttribute('title')),
);
console.log('places:', places.length, places.join(' | '));

await page.screenshot({ path: `${artifacts}places-depth.png` });

const poi = page.locator('.marnav-poi-wrap').first();
if (await poi.count()) {
  await poi.click();
  await page.waitForTimeout(600);
  const popup = (await page.locator('.marnav-poi-popup').textContent().catch(() => '')) ?? '';
  console.log('popup:', popup.replace(/\s+/g, ' ').slice(0, 160));
  await page.screenshot({ path: `${artifacts}places-popup.png` });
}

console.log('console errors:', errors.length, errors.slice(0, 3).join(' | '));
await browser.close();
