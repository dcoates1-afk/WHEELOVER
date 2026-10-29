import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createWreckResearchHandler } from './wreckResearchProxy';

async function request(path: string) {
  const handler = createWreckResearchHandler();
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

describe('EMODnet wreck research proxy', () => {
  it('rejects missing and out-of-range coordinates', async () => {
    await expect(request('/api/wreck-research')).resolves.toMatchObject({ status: 400 });
    await expect(request('/api/wreck-research?lat=91&lon=0')).resolves.toMatchObject({ status: 400 });
  });

  it('returns nearby heritage records with the dataset source fields intact', async () => {
    const sourceResponse = new Response(JSON.stringify({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [-0.92, 50.74] }, properties: { name: 'HMS A1', sink_context: 'Sunk as a target.', obj_type: 'Submarine' } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const realFetch = globalThis.fetch.bind(globalThis);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
      String(input).startsWith('https://ows.emodnet-humanactivities.eu/wfs')
        ? Promise.resolve(sourceResponse.clone())
        : realFetch(input, init),
    );
    const result = await request('/api/wreck-research?lat=50.74&lon=-0.92');
    expect(result.status).toBe(200);
    expect((result.body.features as Array<{ properties: Record<string, string> }>)[0].properties).toMatchObject({
      name: 'HMS A1',
      sink_context: 'Sunk as a target.',
      obj_type: 'Submarine',
    });
    const sourceCall = fetchMock.mock.calls.find(([input]) => String(input).startsWith('https://ows.emodnet-humanactivities.eu/wfs'));
    expect(sourceCall).toBeDefined();
    const requestUrl = new URL(String(sourceCall?.[0]));
    expect(requestUrl.searchParams.get('typeNames')).toBe('emodnet:heritageshipwrecks');
    expect(requestUrl.searchParams.get('bbox')).toContain('EPSG:4326');
  });
});
