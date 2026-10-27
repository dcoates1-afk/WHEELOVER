import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isAbsolute, relative, resolve } from 'node:path';

function sendError(res: ServerResponse, status: number, message: string, size?: number): void {
  res.statusCode = status;
  if (status === 416 && size !== undefined) {
    res.setHeader('Content-Range', `bytes */${size}`);
    res.setHeader('Accept-Ranges', 'bytes');
  }
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(message);
}

/** Serve one file from a configured archive directory, including HTTP range reads. */
export async function serveArchiveFile(
  archiveDir: string,
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  contentType: (path: string) => string,
): Promise<void> {
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

  const root = resolve(archiveDir);
  const file = resolve(root, `.${decoded}`);
  const relativePath = relative(root, file);
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    sendError(res, 403, 'Forbidden');
    return;
  }

  try {
    const [rootRealPath, fileRealPath] = await Promise.all([realpath(root), realpath(file)]);
    const realRelativePath = relative(rootRealPath, fileRealPath);
    if (!realRelativePath || realRelativePath.startsWith('..') || isAbsolute(realRelativePath)) {
      sendError(res, 403, 'Forbidden');
      return;
    }
    const info = await stat(fileRealPath);
    if (!info.isFile()) {
      sendError(res, 404, 'Not found');
      return;
    }

    res.setHeader('Content-Type', contentType(fileRealPath));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', pathname.endsWith('/manifest.json') ? 'no-cache' : 'public, max-age=86400');

    const range = req.headers.range;
    let start = 0;
    let end = info.size - 1;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || info.size === 0) {
        sendError(res, 416, 'Range not satisfiable', info.size);
        return;
      }
      if (!match[1] && !match[2]) {
        sendError(res, 416, 'Range not satisfiable', info.size);
        return;
      }
      if (!match[1]) {
        const suffixLength = Number(match[2]);
        if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
          sendError(res, 416, 'Range not satisfiable', info.size);
          return;
        }
        start = Math.max(0, info.size - suffixLength);
      } else {
        start = Number(match[1]);
        end = match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1;
      }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= info.size || start > end) {
        sendError(res, 416, 'Range not satisfiable', info.size);
        return;
      }
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${info.size}`);
    } else {
      res.statusCode = 200;
    }

    const length = info.size === 0 ? 0 : end - start + 1;
    res.setHeader('Content-Length', length);
    if (req.method === 'HEAD' || length === 0) {
      res.end();
      return;
    }
    const stream = createReadStream(fileRealPath, { start, end });
    stream.on('error', (error) => {
      if (!res.headersSent) sendError(res, 500, 'Unable to read archive file');
      else res.destroy(error);
    });
    stream.pipe(res);
  } catch {
    sendError(res, 404, 'Not found');
  }
}
