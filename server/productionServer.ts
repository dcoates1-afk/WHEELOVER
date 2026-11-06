import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, relative, resolve, sep } from 'node:path';
import { createGzip } from 'node:zlib';
import { serveArchiveFile } from './archiveServer';
import { WebSocketServer } from 'ws';
import { createAisRelay } from './aisRelay';
import { createDepthHandler } from './depthProxy';
import { createOverpassHandler } from './overpassProxy';
import { createNatura2000Handler } from './natura2000Proxy';
import { createLnmHandler } from './lnmProxy';
import { createNotmarHandler } from './notmarProxy';

const root = resolve(process.cwd(), 'dist');
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';
const log = (message: string) => console.info(`[WHEELOVER] ${message}`);
const aisKey = process.env.AISSTREAM_API_KEY ?? '';
const relay = createAisRelay({ apiKey: aisKey, log });
const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
const overpassHandler = createOverpassHandler(log);
const depthHandler = createDepthHandler(log);
const natura2000Handler = createNatura2000Handler();
const notmarHandler = createNotmarHandler(log);
const lnmHandler = createLnmHandler(log);
const contourDir = process.env.WHEELOVER_CONTOUR_DATA_DIR ? resolve(process.env.WHEELOVER_CONTOUR_DATA_DIR) : resolve(root, 'contours');
const marineDir = process.env.WHEELOVER_MARINE_DATA_DIR ? resolve(process.env.WHEELOVER_MARINE_DATA_DIR) : null;

const mimeTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/**
 * Only text-shaped payloads are worth compressing. Images, fonts and archives
 * are already compressed, so gzipping them would spend CPU on Render's small
 * instances to make the response slightly larger.
 */
const COMPRESSIBLE_EXTENSIONS = new Set([
  '.css',
  '.html',
  '.js',
  '.json',
  '.map',
  '.svg',
  '.txt',
  '.webmanifest',
]);

/** Below this size the gzip header costs more than the bytes it saves. */
const MIN_COMPRESS_BYTES = 1024;

/**
 * Answers the one question a response needs: may it be gzipped? q-values are
 * honoured, so an explicit `gzip;q=0` is treated as a refusal rather than a
 * bare mention of the token.
 */
function acceptsGzip(header: string | string[] | undefined): boolean {
  const value = Array.isArray(header) ? header.join(',') : header;
  if (!value) return false;
  let wildcard = 0;
  for (const part of value.split(',')) {
    const [rawName, ...params] = part.trim().split(';');
    const name = rawName.trim().toLowerCase();
    if (!name) continue;
    let quality = 1;
    for (const param of params) {
      const [key, raw] = param.trim().split('=');
      if (key?.trim().toLowerCase() !== 'q') continue;
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) quality = parsed;
    }
    if (name === 'gzip' || name === 'x-gzip') return quality > 0;
    if (name === '*') wildcard = quality;
  }
  return wildcard > 0;
}

function sendError(res: ServerResponse, status: number, message: string) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(message);
}

async function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendError(res, 405, 'Method not allowed');
    return;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    sendError(res, 400, 'Invalid path');
    return;
  }

  const requestedPath = decoded === '/' ? '/index.html' : decoded;
  let file = resolve(root, `.${requestedPath}`);
  const rel = relative(root, file);
  if (rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith(sep)) {
    sendError(res, 403, 'Forbidden');
    return;
  }

  let fileStat;
  try {
    fileStat = await stat(file);
  } catch {
    fileStat = null;
  }

  // This app is a client-side SPA. Serve its entry point for extensionless
  // routes, but return a real 404 for missing assets such as /assets/app.js.
  if ((!fileStat || !fileStat.isFile()) && !extname(decoded)) {
    file = resolve(root, 'index.html');
    try {
      fileStat = await stat(file);
    } catch {
      fileStat = null;
    }
  }

  if (!fileStat?.isFile()) {
    sendError(res, 404, 'Not found');
    return;
  }

  const extension = extname(file).toLowerCase();
  // Applies to HEAD as well, so a HEAD response advertises the same encoding a
  // GET would rather than an identity length the body will never match.
  const compress =
    COMPRESSIBLE_EXTENSIONS.has(extension) &&
    fileStat.size >= MIN_COMPRESS_BYTES &&
    acceptsGzip(req.headers['accept-encoding']);

  res.statusCode = 200;
  res.setHeader('Content-Type', mimeTypes[extension] ?? 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Only Vite's content-hashed assets are safe to cache as immutable. Public
  // data such as the NAVAID manifest can change without its URL changing.
  res.setHeader('Cache-Control', pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
  // The same URL now serves different bytes depending on the client, so any
  // shared cache has to key on the encoding, not just the path.
  res.setHeader('Vary', 'Accept-Encoding');
  // A gzipped body has no known length until it finishes, so the header is
  // omitted and Node falls back to chunked transfer encoding.
  if (compress) res.setHeader('Content-Encoding', 'gzip');
  else res.setHeader('Content-Length', fileStat.size);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  const stream = createReadStream(file);
  stream.on('error', (error) => {
    log(`static file stream failed: ${error.message}`);
    if (!res.headersSent) sendError(res, 500, 'Unable to read file');
    else res.destroy(error);
  });
  if (!compress) {
    stream.pipe(res);
    return;
  }

  // Streamed rather than buffered: the largest data files are several megabytes
  // and this process shares 512 MB of RAM with the AIS relay and its caches.
  const gzip = createGzip({ level: 6 });
  gzip.on('error', (error) => {
    log(`static file compression failed: ${error.message}`);
    res.destroy(error);
  });
  stream.pipe(gzip).pipe(res);
}

async function handleHttp(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/api/overpass') {
    await overpassHandler(req, res);
    return;
  }
  if (url.pathname === '/api/depth') {
    await depthHandler(req, res);
    return;
  }
  if (url.pathname === '/api/natura2000') {
    await natura2000Handler(req, res);
    return;
  }
  if (url.pathname === '/api/notmars') {
    await notmarHandler(req, res);
    return;
  }
  if (url.pathname === '/api/lnm') {
    await lnmHandler(req, res);
    return;
  }
  if (url.pathname.startsWith('/contours/') && contourDir) {
    await serveArchiveFile(contourDir, req, res, url.pathname.slice('/contours'.length), (file) =>
      file.toLowerCase().endsWith('.fgb') ? 'application/flatgeobuf' : 'application/json; charset=utf-8',
    );
    return;
  }
  if (url.pathname.startsWith('/marine-db/') && marineDir) {
    await serveArchiveFile(marineDir, req, res, url.pathname.slice('/marine-db'.length), () => 'application/json; charset=utf-8');
    return;
  }
  await serveStatic(req, res, url.pathname);
}

const server = createServer((req, res) => {
  void handleHttp(req, res).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'unknown server error';
    log(`request failed: ${message}`);
    if (!res.headersSent) sendError(res, 500, 'Internal server error');
    else res.destroy();
  });
});

server.on('upgrade', (req, socket, head) => {
  let pathname = '/';
  try {
    pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
  } catch {
    socket.destroy();
    return;
  }
  if (pathname !== '/ws/ais') {
    socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => relay.attach(ws));
});

server.on('error', (error) => {
  console.error(`[WHEELOVER] HTTP server error: ${error.message}`);
  process.exitCode = 1;
});

relay.start();
log(aisKey ? 'AIS relay ready on /ws/ais' : 'AIS relay in simulated mode (no key)');
server.listen(port, host, () => log(`production server listening on http://${host}:${port}`));

let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  relay.stop();
  wss.close();
  server.close((error) => {
    if (error) {
      console.error(`[WHEELOVER] shutdown failed: ${error.message}`);
      process.exitCode = 1;
    }
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
