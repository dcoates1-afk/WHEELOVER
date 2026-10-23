#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateMarineManifest, loadMarineData } from '../src/lib/marineDb.ts';

const dir = mkdtempSync(join(tmpdir(), 'marine-loader-'));
let server;
try {
  const input = join(dir, 'input.geojsonseq');
  const output = join(dir, 'marine-db');
  const features = [
    { type: 'Feature', id: 'w1', properties: { route: 'ferry', name: 'Visible Ferry' }, geometry: { type: 'LineString', coordinates: [[-1, 50], [-0.5, 50.5]] } },
    { type: 'Feature', id: 'w2', properties: { 'seamark:type': 'separation_lane', name: 'Visible TSS' }, geometry: { type: 'LineString', coordinates: [[-1, 50], [-0.5, 50.5]] } },
    { type: 'Feature', id: 'n3', properties: { 'seamark:type': 'buoy_lateral', name: 'Visible Buoy', 'seamark:buoy_lateral:category': 'port' }, geometry: { type: 'Point', coordinates: [-0.75, 50.25] } },
    { type: 'Feature', id: 'w4', properties: { route: 'ferry', name: 'Elsewhere Ferry' }, geometry: { type: 'LineString', coordinates: [[100, 0], [101, 1]] } },
  ];
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
    if (data.ferries.length !== 1 || data.ferries[0].id !== 'ferries:w1') throw new Error('viewport ferry query incorrect');
    if (data.tss.length !== 1 || data.tss[0].id !== 'tss:w2') throw new Error('viewport TSS query incorrect');
    if (data.navaids.length !== 1 || data.navaids[0].id !== 'osm:node/3') throw new Error(`viewport NAVAID query incorrect: ${data.navaids.map(({ id }) => id).join(',')}`);
    console.log(`PASS viewport loader: ${data.navaids.length} NAVAID, ${data.ferries.length} ferry, ${data.tss.length} TSS; unrelated route excluded`);
  } finally {
    globalThis.fetch = originalFetch;
  }
} finally {
  if (server?.listening) await new Promise((resolveClose) => server.close(resolveClose));
  rmSync(dir, { recursive: true, force: true });
}
