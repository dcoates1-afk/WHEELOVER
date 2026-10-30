#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describeTssFeature, validateMarineManifest, loadMarineData } from '../src/lib/marineDb.ts';

const dir = mkdtempSync(join(tmpdir(), 'marine-loader-'));
let server;
try {
  const input = join(dir, 'input.geojsonseq');
  const output = join(dir, 'marine-db');
  const features = [
    { type: 'Feature', id: 'w1', properties: { route: 'ferry', name: 'Visible Ferry' }, geometry: { type: 'LineString', coordinates: [[-1, 50], [-0.5, 50.5]] } },
    { type: 'Feature', id: 'w2', properties: { 'seamark:type': 'separation_lane', name: 'Visible TSS' }, geometry: { type: 'MultiLineString', coordinates: [[[-1, 50], [-0.5, 50.5]], [[0.5, 50.5], [1, 51]]] } },
    { type: 'Feature', id: 'w5', properties: { seamark_type: 'separation_zone', osm_id: 42, osm_way_id: 999, name: 'Polygon TSS' }, geometry: { type: 'MultiPolygon', coordinates: [[[[2, 50], [2.1, 50], [2.1, 50.1], [2, 50], [2, 50]]], [[[2.2, 50], [2.3, 50], [2.3, 50.1], [2.2, 50], [2.2, 50]]]] } },
    { type: 'Feature', id: 'w6', properties: { seamark_type: 'separation_zone', osm_id: 42, osm_way_id: 999, name: 'Polygon TSS' }, geometry: { type: 'Polygon', coordinates: [[[2.4, 50], [2.5, 50], [2.5, 50.1], [2.4, 50], [2.4, 50]]] } },
    { type: 'Feature', id: 'r7', properties: { seamark_type: 'separation_lane', osm_ref: 'r777', name: 'Relation TSS' }, geometry: { type: 'MultiLineString', coordinates: [[[3, 50], [3.1, 50.1]], [[3.2, 50.2], [3.3, 50.3]]] } },
    { type: 'Feature', id: 'n3', properties: { 'seamark:type': 'buoy_lateral', name: 'Visible Buoy', 'seamark:buoy_lateral:category': 'port' }, geometry: { type: 'Point', coordinates: [-0.75, 50.25] } },
    { type: 'Feature', id: 'w4', properties: { route: 'ferry', name: 'Elsewhere Ferry' }, geometry: { type: 'LineString', coordinates: [[100, 0], [101, 1]] } },
  ];
  features[1].properties = {
    ...features[1].properties,
    operator: 'Harbour Authority',
    ref: 'TSS-1',
    'seamark:separation_lane:traffic_flow': 'inbound',
    source: 'survey',
  };
  writeFileSync(input, features.map((feature) => `${JSON.stringify(feature)}\n`).join(''));
  const build = spawnSync(process.execPath, ['scripts/build-marine-db.mjs', input, '--out', output], { cwd: process.cwd(), stdio: 'inherit' });
  if (build.status !== 0) throw new Error('marine builder failed');
  const manifest = JSON.parse(readFileSync(resolve(output, 'manifest.json'), 'utf8'));
  if (!validateMarineManifest(manifest)) throw new Error('generated manifest was rejected');

  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = decodeURIComponent(url.pathname).replace(/^\/marine-db\//, '');
    try {
      const body = readFileSync(resolve(output, path));
      res.setHeader('Content-Type', 'application/json');
      res.end(body);
    } catch {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture server failed to bind');
  const origin = `http://127.0.0.1:${address.port}`;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (inputUrl, options) => originalFetch(new URL(String(inputUrl), origin), options);
  try {
    const response = await fetch(`${origin}/marine-db/manifest.json`);
    if (!response.ok) throw new Error(`Fixture manifest request returned HTTP ${response.status}`);
    const data = await loadMarineData([49, -2, 51, 0], { baseUrl: `${origin}/marine-db/` });
    if (data.ferries.length !== 1 || data.ferries[0].id !== 'ferries:w1') throw new Error(`viewport ferry query incorrect: ${data.ferries.map(({ id }) => id).join(',')}`);
    if (data.tss.length !== 1 || data.tss[0].id !== 'tss:w2') throw new Error('viewport TSS query incorrect');
    if (data.tss[0].paths?.length !== 2) throw new Error('multipart TSS line components were flattened or lost');
    const polygonData = await loadMarineData([49, 1.9, 51, 2.4], { baseUrl: `${origin}/marine-db/` });
    if (polygonData.tss.length !== 1 || polygonData.tss[0].id !== 'tss:w999') throw new Error('GDAL OSM way identity was not preserved for TSS polygons');
    if (polygonData.tss[0].polygons?.length !== 3) throw new Error('duplicate TSS way geometries were not merged or multipart TSS polygons were lost');
    if (!describeTssFeature(polygonData.tss[0]).sourceUrl?.endsWith('/way/999')) throw new Error('GDAL osm_way_id did not produce a correct way source link');
    const relationData = await loadMarineData([49, 2.9, 51, 3.4], { baseUrl: `${origin}/marine-db/` });
    if (relationData.tss.length !== 1 || relationData.tss[0].id !== 'tss:r777') throw new Error('GDAL relation identity was not preserved for TSS');
    if (relationData.tss[0].paths?.length !== 2 || !describeTssFeature(relationData.tss[0]).sourceUrl?.endsWith('/relation/777')) throw new Error('relation TSS multipart paths/source URL incorrect');
    const tssInfo = describeTssFeature(data.tss[0]);
    if (tssInfo.title !== 'Visible TSS' || tssInfo.type !== 'separation lane') throw new Error('TSS popup title/type incorrect');
    if (!tssInfo.details.some(([label, value]) => label === 'Operator' && value === 'Harbour Authority')) throw new Error('TSS operator missing from popup data');
    if (!tssInfo.details.some(([label, value]) => label === 'Lane traffic flow' && value === 'inbound')) throw new Error('TSS flow missing from popup data');
    if (!tssInfo.details.some(([label, value]) => label === 'OSM source note' && value === 'survey')) throw new Error('TSS mapped-data citation missing from popup');
    if (tssInfo.sourceUrl !== 'https://www.openstreetmap.org/way/2') throw new Error(`TSS OSM source link incorrect: ${tssInfo.sourceUrl}`);
    if (data.navaids.length !== 1 || data.navaids[0].id !== 'osm:node/3') throw new Error(`viewport NAVAID query incorrect: ${data.navaids.map(({ id }) => id).join(',')}`);
    console.log(`PASS viewport loader: ${data.navaids.length} NAVAID, ${data.ferries.length} ferry, ${data.tss.length} TSS; unrelated route excluded`);
  } finally {
    globalThis.fetch = originalFetch;
  }
} finally {
  if (server?.listening) await new Promise((resolveClose) => server.close(resolveClose));
  rmSync(dir, { recursive: true, force: true });
}
