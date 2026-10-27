import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { HttpReader } from 'flatgeobuf/lib/mjs/http-reader.js';
import { fromFeature } from 'flatgeobuf/lib/mjs/geojson/feature.js';

const archive = resolve(process.argv[2] ?? 'public/contours');
const manifest = JSON.parse(await readFile(resolve(archive, 'manifest.json'), 'utf8'));
assert.equal(manifest.schema, 1);
assert.ok(manifest.shards.length);
const server = createServer(async (req, res) => {
  try {
    const decoded = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    const file = resolve(archive, `.${decoded}`);
    const rel = file.slice(archive.length);
    if (file === archive || (!rel.startsWith(sep) && rel !== '') || rel.startsWith(`${sep}..${sep}`) || rel === `${sep}..`) { res.writeHead(403).end(); return; }
    const info = await stat(file);
    res.setHeader('Content-Type', extname(file) === '.fgb' ? 'application/flatgeobuf' : 'application/json');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Access-Control-Allow-Origin', '*');
    const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? '');
    if (range) {
      const start = Number(range[1]); const end = Math.min(Number(range[2]), info.size - 1);
      res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${info.size}`, 'Content-Length': end - start + 1 });
      createReadStream(file, { start, end }).pipe(res); return;
    }
    res.writeHead(200, { 'Content-Length': info.size }); createReadStream(file).pipe(res);
  } catch { res.writeHead(404).end(); }
});
await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
try {
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/`;
  const manifestResponse = await fetch(new URL('manifest.json', base));
  assert.equal(manifestResponse.status, 200);
  for (const shard of manifest.shards) {
    const url = new URL(shard.path, base).toString(); let requests = 0;
    const reader = await HttpReader.openSource({ async getRange(start, length) {
      requests += 1;
      const response = await fetch(url, { headers: { Range: `bytes=${start}-${start + length - 1}` } });
      assert.equal(response.status, 206);
      assert.match(response.headers.get('content-range') ?? '', new RegExp(`^bytes ${start}-\\d+/${shard.totalBytes}$`));
      return response.arrayBuffer();
    } });
    let count = 0;
    for await (const item of reader.selectBbox({ minX: shard.bounds[1], minY: shard.bounds[0], maxX: shard.bounds[3], maxY: shard.bounds[2] })) {
      const feature = fromFeature(item.id, item.feature, reader.header);
      assert.ok(feature.geometry);
      assert.ok(Number.isFinite(Number(feature.properties?.elev_m)));
      count += 1;
    }
    assert.equal(count, shard.count, `${shard.path} decoded count`);
    assert.ok(requests >= 2, `${shard.path} used HTTP byte ranges`);
    console.log(`PASS ${shard.path}: ${count} features across ${requests} HTTP ranges`);
  }
} finally {
  await new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
}
console.log(`PASS contour archive: ${manifest.shards.length} shards; ${manifest.shards.reduce((sum, shard) => sum + shard.count, 0)} vectors`);
