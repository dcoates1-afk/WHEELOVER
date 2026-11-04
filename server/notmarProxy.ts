import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Same-host relay for NGA Maritime Safety Information broadcast warnings.
 * The NGA API sends no CORS headers, so the browser cannot fetch it
 * directly; the server fetches it with a browser-like User-Agent and
 * Referer (required by the service) and caches the feed for 15 minutes,
 * matching the feed's own refresh rhythm. Only the warnings array is
 * relayed, unchanged, with a fetchedAt stamp.
 *
 * When a refresh fails — NGA takes the whole MSI portal down for
 * maintenance from time to time, serving an outage page instead of JSON —
 * the relay serves the last good copy with stale: true rather than
 * failing, so the layer keeps showing warnings through the outage. The
 * next request retries the refresh, so recovery is automatic. Only when
 * no good copy exists at all does the relay return 502.
 */

const NGA_URL = 'https://msi.nga.mil/api/publications/broadcast-warn?status=active&output=json';
const CACHE_TTL_MS = 15 * 60 * 1000;

function sendJson(res: ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(json);
}

export function createNotmarHandler(log: (message: string) => void = () => {}) {
  let cached: { at: number; body: { 'broadcast-warn': unknown; fetchedAt: string } } | null = null;
  return async function notmarHandler(_req: IncomingMessage, res: ServerResponse) {
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      sendJson(res, 200, { ...cached.body, cached: true });
      return;
    }
    try {
      const response = await fetch(NGA_URL, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
          Accept: 'application/json',
          Referer: 'https://msi.nga.mil/home',
        },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`NGA HTTP ${response.status}`);
      const payload = (await response.json()) as { 'broadcast-warn'?: unknown };
      const body = { 'broadcast-warn': payload['broadcast-warn'] ?? [], fetchedAt: new Date().toISOString() };
      cached = { at: Date.now(), body };
      sendJson(res, 200, body);
    } catch (error) {
      log(`notmar proxy: ${error instanceof Error ? error.message : 'fetch failed'}`);
      if (cached) {
        sendJson(res, 200, { ...cached.body, stale: true });
        return;
      }
      sendJson(res, 502, { error: 'NGA warnings unavailable' });
    }
  };
}
