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

function collection(features: unknown[]) {
  return new Response(JSON.stringify({ type: 'FeatureCollection', features }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Route the two EMODnet layers to different collections, and fail others. */
function mockLayers(layers: Record<string, Response | 'fail'>) {
  const realFetch = globalThis.fetch.bind(globalThis);
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = String(input);
    if (!url.startsWith('https://ows.emodnet-humanactivities.eu/wfs')) return realFetch(input, init);
    const typeNames = new URL(url).searchParams.get('typeNames') ?? '';
    const response = layers[typeNames];
    if (!response) throw new Error(`unexpected layer ${typeNames}`);
    if (response === 'fail') return Promise.reject(new Error('source down'));
    return Promise.resolve(response.clone());
  });
}

afterEach(() => vi.restoreAllMocks());

describe('Natura 2000 proxy', () => {
  it('rejects invalid and oversized bounding boxes', async () => {
    await expect(request('/api/natura2000')).resolves.toMatchObject({ status: 400 });
    await expect(request('/api/natura2000?bbox=0,0,5,5')).resolves.toMatchObject({ status: 400 });
  });

  it('merges the Natura and protected-area layers, keeping one outline per site', async () => {
    const fetchMock = mockLayers({
      'emodnet:natura2000areas': collection([
        { type: 'Feature', id: 'natura2000areas.12', properties: { sitename: 'Baie de Seine occidentale' } },
      ]),
      'emodnet:marineprotectedareas': collection([
        { type: 'Feature', id: 'mpa.1', properties: { name: 'BAIE DE SEINE OCCIDENTALE' } },
        { type: 'Feature', id: 'mpa.2', properties: { name: 'SOLENT MARITIME' } },
        { type: 'Feature', id: 'mpa.3', properties: { name: 'SOLENT &amp; ISLE OF WIGHT LAGOONS' } },
      ]),
    });

    const result = await request('/api/natura2000?bbox=50.6,-1.6,50.9,-1.1');
    expect(result.status).toBe(200);
    expect(result.body.type).toBe('FeatureCollection');
    const features = result.body.features as Array<{ id: string; properties: Record<string, string> }>;
    // The French site is in both layers and must be drawn once; the two UK
    // sites exist only in the protected-area layer and must survive.
    expect(features.map((feature) => feature.id)).toEqual(['natura2000areas.12', 'mpa.2', 'mpa.3']);
    expect(features[0].properties.designation_layer).toBe('Natura 2000 site');
    expect(features[1].properties.designation_layer).toBe('Marine protected area');

    const urls = fetchMock.mock.calls
      .map(([input]) => String(input))
      .filter((url) => url.startsWith('https://ows.emodnet-humanactivities.eu/wfs'))
      .map((url) => new URL(url));
    expect(urls.map((url) => url.searchParams.get('typeNames'))).toEqual([
      'emodnet:natura2000areas',
      'emodnet:marineprotectedareas',
    ]);
    for (const url of urls) {
      expect(url.searchParams.get('bbox')).toBe('-1.6,50.6,-1.1,50.9,EPSG:4326');
    }
  });

  it('still answers when only one conservation layer responds', async () => {
    mockLayers({
      'emodnet:natura2000areas': 'fail',
      'emodnet:marineprotectedareas': collection([{ type: 'Feature', id: 'mpa.9', properties: { name: 'SOLENT MARITIME' } }]),
    });
    const result = await request('/api/natura2000?bbox=50.5,-1.4,50.7,-1.2');
    expect(result.status).toBe(200);
    expect((result.body.features as unknown[]).length).toBe(1);
  });

  it('reports a source failure rather than an empty overlay when both layers fail', async () => {
    mockLayers({
      'emodnet:natura2000areas': 'fail',
      'emodnet:marineprotectedareas': 'fail',
    });
    const result = await request('/api/natura2000?bbox=50.2,-1.4,50.4,-1.2');
    expect(result.status).toBe(502);
  });
});
