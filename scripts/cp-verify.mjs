// Verifies Coast Pilot rows render on real bridge cards in the local app.
// Run: node scripts/cp-verify.mjs
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:3003';

async function findAndClickBridge(page, namePart) {
  const markers = page.locator('path[fill="#fff4bb"]');
  const count = await markers.count();
  for (let i = 0; i < count; i++) {
    const d = (await markers.nth(i).getAttribute('d')) || '';
    if (!d.includes('a5,5')) continue; // circleMarker arc, not an outline polygon
    await markers.nth(i).hover({ timeout: 5000 }).catch(() => {});
    const tip = await page.locator('.leaflet-tooltip:visible').allTextContents().catch(() => []);
    if (tip.some((t) => t.toLowerCase().includes(namePart.toLowerCase()))) {
      await markers.nth(i).click({ timeout: 5000 });
      return true;
    }
  }
  return false;
}

async function readPopup(page) {
  await page.locator('.leaflet-popup-content').first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(3000); // survive the autopan refetch + restore
  return page.locator('.leaflet-popup-content').first().innerText();
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 200)));

try {
  // Golden Gate
  await page.goto(`${BASE}/app?lat=37.82&lon=-122.48&z=13`, { waitUntil: 'domcontentloaded' });
  await page.waitForResponse((r) => r.url().includes('coastpilot.json'), { timeout: 240000 });
  await page.waitForTimeout(2000);
  const foundGG = await findAndClickBridge(page, 'Golden Gate');
  console.log('golden gate marker found:', foundGG);
  if (foundGG) {
    const text = await readPopup(page);
    console.log('--- GOLDEN GATE CARD ---');
    console.log(text.slice(0, 2000));
    await page.screenshot({ path: '/home/hatch/workspace/coast-pilot/golden-gate-card.png' });
  }

  // Park Street (Tidal Canal group least)
  await page.goto(`${BASE}/app?lat=37.765&lon=-122.235&z=15`, { waitUntil: 'domcontentloaded' });
  await page.waitForResponse((r) => r.url().includes('coastpilot.json'), { timeout: 240000 });
  await page.waitForTimeout(2000);
  const foundPark = await findAndClickBridge(page, 'Park Street');
  console.log('park street marker found:', foundPark);
  if (foundPark) {
    const text = await readPopup(page);
    console.log('--- PARK STREET CARD ---');
    console.log(text.slice(0, 2000));
    await page.screenshot({ path: '/home/hatch/workspace/coast-pilot/park-street-card.png' });
  }
} catch (e) {
  console.log('VERIFY ERROR:', String(e).slice(0, 500));
} finally {
  await browser.close();
}
