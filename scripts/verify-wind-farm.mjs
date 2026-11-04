// Verifies the offshore fetch: a wind-farm area draws its yellow dashed
// boundary, and turbine + rig point marks render beside it, against a canned
// /api/overpass response so the check does not depend on Overpass mirrors.
// Usage: PORT=3021 node build/server.mjs  (in another shell)
//        node scripts/verify-wind-farm.mjs 3021
import { chromium } from 'playwright';

const port = process.argv[2] || '3021';
const browser = await chromium.launch();
const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();

// A farm way ring, one turbine node and one rig node, in Overpass JSON shape.
const stub = {
  elements: [
    {
      type: 'way',
      id: 3,
      geometry: [
        { lat: 50.6, lon: -0.4 },
        { lat: 50.6, lon: -0.1 },
        { lat: 50.8, lon: -0.1 },
        { lat: 50.8, lon: -0.4 },
        { lat: 50.6, lon: -0.4 },
      ],
      tags: { power: 'plant', 'plant:source': 'wind', name: 'Test Farm' },
    },
    {
      type: 'node',
      id: 1,
      lat: 50.7,
      lon: -0.2,
      tags: { power: 'generator', 'generator:source': 'wind', name: 'Test Turbine' },
    },
    {
      type: 'node',
      id: 2,
      lat: 50.75,
      lon: -0.3,
      tags: { 'man_made': 'offshore_platform', name: 'Test Rig' },
    },
  ],
  meta: { cached: false },
};

await page.route('**/api/overpass*', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stub) }),
);

await page.goto(`http://localhost:${port}/app?lat=50.7&lon=-0.25&z=11`, { waitUntil: 'domcontentloaded' });

const yellow = page.locator('path[stroke="#f4c531"]');
await yellow.first().waitFor({ state: 'attached', timeout: 20000 });
const yellowD = (await yellow.first().getAttribute('d')) ?? '';
const markerCount = await page.locator('.leaflet-marker-icon').count();

const checks = {
  // The boundary must carry real projected geometry, not the empty M0 0 a
  // fully off-view ring clips to — so the view is zoomed out to fit it.
  farmBoundaryDrawn: yellowD.length > 10 && yellowD !== 'M0 0',
  pointMarksRendered: markerCount >= 3,
};
console.log(JSON.stringify(checks));
if (!Object.values(checks).every(Boolean)) {
  console.log('VERIFY FAILED');
  process.exit(1);
}
console.log('VERIFY OK');
await browser.close();
