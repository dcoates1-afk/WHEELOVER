import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { serveArchiveFile } from '../../server/archiveServer';

let root = '';
let server: Server;
let origin = '';
const payload = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz');

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'wheel-archive-test-'));
  await mkdir(join(root, 'nested'));
  await writeFile(join(root, 'nested', 'sample.fgb'), payload);
  server = createServer((req, res) => {
    void serveArchiveFile(root, req, res, req.url ?? '/', () => 'application/flatgeobuf');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test HTTP server did not bind');
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await rm(root, { recursive: true, force: true });
});

describe('archive byte-range server', () => {
  it('serves exact byte ranges with 206 and Content-Range', async () => {
    const response = await fetch(`${origin}/nested/sample.fgb`, { headers: { Range: 'bytes=5-11' } });
    expect(response.status).toBe(206);
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(response.headers.get('content-range')).toBe(`bytes 5-11/${payload.length}`);
    expect(response.headers.get('content-length')).toBe('7');
    expect(await response.text()).toBe('56789ab');
  });

  it('supports suffix ranges required by FlatGeobuf readers', async () => {
    const response = await fetch(`${origin}/nested/sample.fgb`, { headers: { Range: 'bytes=-9' } });
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe(`bytes ${payload.length - 9}-${payload.length - 1}/${payload.length}`);
    expect(await response.text()).toBe('rstuvwxyz');
  });

  it('returns 416 for unsatisfiable ranges and rejects methods', async () => {
    const range = await fetch(`${origin}/nested/sample.fgb`, { headers: { Range: 'bytes=999-1000' } });
    expect(range.status).toBe(416);
    expect(range.headers.get('content-range')).toBe(`bytes */${payload.length}`);
    const method = await fetch(`${origin}/nested/sample.fgb`, { method: 'POST' });
    expect(method.status).toBe(405);
  });

  it('supports HEAD metadata without sending the archive body', async () => {
    const response = await fetch(`${origin}/nested/sample.fgb`, { method: 'HEAD', headers: { Range: 'bytes=3-7' } });
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe(`bytes 3-7/${payload.length}`);
    expect(response.headers.get('content-length')).toBe('5');
    expect((await response.arrayBuffer()).byteLength).toBe(0);
  });

  it('rejects decoded traversal and returns the whole file without Range', async () => {
    const traversal = await fetch(`${origin}/%2e%2e/etc/passwd`);
    expect([403, 404]).toContain(traversal.status);
    const response = await fetch(`${origin}/nested/sample.fgb`);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(await readFile(join(root, 'nested', 'sample.fgb')));
  });
});