// Verify track recording end to end with emulated GPS movement.
// Run: node scripts/verify-tracks.mjs
import { chromium } from 'playwright';

const browser = await chromium.launch();
const context = await browser.newContext({ ignoreHTTPSErrors: true });
await context.grantPermissions(['geolocation']);
await context.setGeolocation({ latitude: 48.0, longitude: -126.0 });
const page = await context.newPage();
await page.goto('http://127.0.0.1:3008/app?lat=48.0&lon=-126.0&z=13', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.locator('.boat-button').click();
await page.getByRole('tab', { name: 'Tracks' }).click();
const startButton = page.locator('.track-recording .boat-submit', { hasText: 'Start recording' });
await startButton.waitFor({ state: 'visible', timeout: 15000 });
// Wait until a GPS fix enables the button.
await page.waitForFunction(() => {
  const button = document.querySelector('.track-recording .boat-submit');
  return button && !button.disabled;
}, { timeout: 30000 });
console.log('start enabled with GPS fix: yes');
await startButton.click();
await page.locator('.track-recording', { hasText: 'Recording' }).waitFor({ timeout: 10000 });
console.log('recording started: yes');
// Move diagonally (~250 m) so the track line has a non-zero bounding box.
await context.setGeolocation({ latitude: 48.001, longitude: -125.997 });
await page.waitForFunction(() => {
  const box = document.querySelector('.track-recording');
  return box && /2 points/.test(box.textContent ?? '');
}, { timeout: 30000 });
console.log('second point recorded after move: yes');
await page.locator('.track-recording .boat-submit', { hasText: 'Stop and save track' }).click();
await page.locator('.boat-list li', { hasText: 'points' }).first().waitFor({ timeout: 10000 });
console.log('track saved to list: yes');
await page.locator('.boat-row-actions button', { hasText: 'Show' }).first().click();
await page.locator('.boat-row-actions button', { hasText: 'Hide' }).first().waitFor({ timeout: 10000 });
// Presence in the DOM, not Playwright visibility: a perfectly straight track
// can have a zero-height box and still paint fine.
await page.waitForFunction(() => {
  return document.querySelectorAll('path.leaflet-interactive[stroke="#3dd6ff"]').length > 0;
}, { timeout: 10000 });
console.log('saved track drawn on chart: yes');
await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
await page.locator('.boat-button').click();
await page.getByRole('tab', { name: 'Tracks' }).click();
await page.locator('.boat-list li', { hasText: 'points' }).first().waitFor({ timeout: 10000 });
console.log('track persisted after reload: yes');
await page.screenshot({ path: 'verify-tracks.png' });
await browser.close();
