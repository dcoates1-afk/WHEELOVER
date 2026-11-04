import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createNotmarHandler } from '../../server/notmarProxy';

/** One server per test: the handler holds the cache, so requests in a test must share it. */
async function startServer() {
  const handler = createNotmarHandler(() => {});
  const server = createServer((req: IncomingMessage, res: ServerResponse) => void handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing test server address');
  return {
    request: async (path: string) => {
      const response = await fetch(`http://127.0.0.1:${address.port}${path}`);
      return { status: response.status, body: (await response.json()) as Record<string, unknown> };
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

const FEED = {
  'broadcast-warn': [
    {
      navArea: '4',
      msgNumber: '123',
      msgYear: '2026',
      subregion: '',
      issueDate: '2026-11-03',
      text: 'TEST WARNING 14-51.78N 061-18.18W',
    },
  ],
};

/** Intercept only the NGA URL; the test's own localhost requests pass through. */
function mockNga(behavior: { current: 'ok' | 'fail' }) {
  const realFetch = globalThis.fetch.bind(globalThis);
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = String(input);
    if (!url.startsWith('https://msi.nga.mil/')) return realFetch(input, init);
    if (behavior.current === 'fail') return Promise.reject(new Error('NGA down'));
    return Promise.resolve(
      new Response(JSON.stringify(FEED), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('notmar proxy stale fallback', () => {
  it('serves fresh warnings', async () => {
    mockNga({ current: 'ok' });
    const server = await startServer();
    try {
      const result = await server.request('/api/notmars');
      expect(result.status).toBe(200);
      expect(result.body['broadcast-warn']).toHaveLength(1);
      expect(result.body.stale).toBeUndefined();
    } finally {
      await server.close();
    }
  });

  it('serves the last good copy with stale: true when the refresh fails', async () => {
    const behavior = { current: 'ok' as 'ok' | 'fail' };
    mockNga(behavior);
    const server = await startServer();
    try {
      const first = await server.request('/api/notmars');
      expect(first.status).toBe(200);
      vi.useFakeTimers();
      vi.advanceTimersByTime(16 * 60 * 1000);
      behavior.current = 'fail';
      try {
        const second = await server.request('/api/notmars');
        expect(second.status).toBe(200);
        expect(second.body.stale).toBe(true);
        expect(second.body['broadcast-warn']).toHaveLength(1);
        expect(typeof second.body.fetchedAt).toBe('string');
      } finally {
        vi.useRealTimers();
      }
    } finally {
      await server.close();
    }
  });

  it('returns 502 when there is no cached copy and the fetch fails', async () => {
    mockNga({ current: 'fail' });
    const server = await startServer();
    try {
      const result = await server.request('/api/notmars');
      expect(result.status).toBe(502);
      expect(result.body.error).toBe('NGA warnings unavailable');
    } finally {
      await server.close();
    }
  });
});
