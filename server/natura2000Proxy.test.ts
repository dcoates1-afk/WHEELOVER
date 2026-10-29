import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createNatura2000Handler } from './natura2000Proxy';

async function request(path: string) {
  const handler = createNatura2000Handler();
  const server = createServer((req: IncomingMessage, res: ServerResponse) => void handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing test server address');
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`);
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

afterEach(() => vi.restoreAllMocks());

describe('Natura 2000 proxy', () => {
  it('rejects invalid and oversized bounding boxes', async () => {
    await expect(request('/api/natura2000')).resolves.toMatchObject({ status: 400 });
    await expect(request('/api/natura2000?bbox=0,0,5,5')).resolves.toMatchObject({ status: 400 });
  });

  it('forwards bounded feature requests and returns GeoJSON', async () => {
    const sourceResponse = new Response(JSON.stringify({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', id: 'natura2000areas.12' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const realFetch = globalThis.fetch.bind(globalThis);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
      String(input).startsWith('https://ows.emodnet-humanactivities.eu/wfs')
        ? Promise.resolve(sourceResponse.clone())
        : realFetch(input, init),
    );
    const result = await request('/api/natura2000?bbox=50.7,-1.3,50.8,-1.2');
    expect(result.status).toBe(200);
    expect(result.body.type).toBe('FeatureCollection');
    const sourceCall = fetchMock.mock.calls.find(([input]) => String(input).startsWith('https://ows.emodnet-humanactivities.eu/wfs'));
    expect(sourceCall).toBeDefined();
    const sourceUrl = new URL(String(sourceCall?.[0]));
    expect(sourceUrl.searchParams.get('typeNames')).toBe('emodnet:natura2000areas');
    expect(sourceUrl.searchParams.get('bbox')).toBe('-1.3,50.7,-1.2,50.8,EPSG:4326');
  });
});
