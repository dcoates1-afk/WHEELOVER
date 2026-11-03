// Verify the boat log end to end: log entry, checklist tick persistence,
// maintenance status, fuel totals. Run: node scripts/verify-boat-log.mjs
import { chromium } from 'playwright';

const browser = await chromium.launch();
const context = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await context.newPage();
await page.goto('http://127.0.0.1:3007/app?lat=48.0&lon=-126.0&z=10', { waitUntil: 'domcontentloaded', timeout: 60000 });
const boatButton = page.locator('.boat-button');
await boatButton.waitFor({ state: 'visible', timeout: 30000 });
await boatButton.click();
await page.locator('input[aria-label="Trip title"]').fill('Cowes to Yarmouth');
await page.locator('.boat-submit').first().click();
await page.locator('.boat-list li strong', { hasText: 'Cowes to Yarmouth' }).waitFor({ timeout: 10000 });
console.log('log entry added: yes');
await page.getByRole('tab', { name: 'Checklist' }).click();
await page.locator('.boat-check-item', { hasText: 'Weather and tides checked' }).click();
await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
await page.locator('.boat-button').click();
await page.getByRole('tab', { name: 'Checklist' }).click();
const ticked = await page.locator('.boat-check-item input').first().isChecked();
console.log('checklist tick persisted after reload:', ticked);
await page.getByRole('tab', { name: 'Maintenance' }).click();
await page.locator('input[aria-label="Maintenance task"]').fill('Engine oil change');
await page.locator('input[placeholder="e.g. 90"]').fill('90');
await page.locator('.boat-submit').first().click();
// A scheduled task that was never done reads as overdue until it is done.
await page.locator('.maint-pill', { hasText: 'Overdue' }).waitFor({ timeout: 10000 });
console.log('maintenance task with Overdue pill: yes');
await page.locator('.boat-row-actions button', { hasText: 'Mark done' }).click();
await page.locator('.maint-pill', { hasText: 'On schedule' }).waitFor({ timeout: 10000 });
console.log('maintenance task On schedule after Mark done: yes');
await page.getByRole('tab', { name: 'Fuel' }).click();
await page.locator('input[placeholder="e.g. 40"]').fill('40');
await page.locator('input[placeholder="e.g. 80"]').fill('80');
await page.locator('.boat-submit').first().click();
await page.locator('.boat-progress', { hasText: '40.0 L total' }).waitFor({ timeout: 10000 });
console.log('fuel totals show 40.0 L: yes');
await page.screenshot({ path: 'verify-boat-log.png' });
await browser.close();
if (!ticked) process.exit(1);
