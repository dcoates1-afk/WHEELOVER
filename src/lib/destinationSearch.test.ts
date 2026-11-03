import { describe, expect, it, vi } from 'vitest';
import {
  buildSearchUrl,
  parseSearchResults,
  searchDestinations,
} from './destinationSearch';

describe('buildSearchUrl', () => {
  it('encodes the query and asks for eight JSON results', () => {
    const url = new URL(buildSearchUrl('Victoria Harbour'));
    expect(url.origin + url.pathname).toBe('https://nominatim.openstreetmap.org/search');
    expect(url.searchParams.get('format')).toBe('jsonv2');
    expect(url.searchParams.get('q')).toBe('Victoria Harbour');
    expect(url.searchParams.get('limit')).toBe('8');
  });
});

describe('parseSearchResults', () => {
  it('splits the first display-name part off as the place name', () => {
    const results = parseSearchResults([
      { display_name: 'Victoria Harbour, Victoria, BC, Canada', lat: '48.42', lon: '-123.37' },
    ]);
    expect(results).toEqual([
      { name: 'Victoria Harbour', detail: 'Victoria, BC, Canada', lat: 48.42, lon: -123.37 },
    ]);
  });

  it('drops rows without a usable name or coordinates', () => {
    const results = parseSearchResults([
      { display_name: 'Nowhere', lat: 'abc', lon: '-123.37' },
      { lat: '48.42', lon: '-123.37' },
      { display_name: ', , ', lat: '48.42', lon: '-123.37' },
      { display_name: 'Good Place', lat: 48.42, lon: -123.37 },
    ]);
    expect(results).toEqual([{ name: 'Good Place', detail: '', lat: 48.42, lon: -123.37 }]);
  });

  it('returns nothing for a non-array payload', () => {
    expect(parseSearchResults({ error: 'nope' })).toEqual([]);
    expect(parseSearchResults(null)).toEqual([]);
  });
});

describe('searchDestinations', () => {
  it('parses a successful fetch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [{ display_name: 'Cowes, Isle of Wight', lat: '50.76', lon: '-1.3' }],
      }),
    );
    try {
      await expect(searchDestinations('Cowes')).resolves.toEqual([
        { name: 'Cowes', detail: 'Isle of Wight', lat: 50.76, lon: -1.3 },
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('throws on a failed fetch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }));
    try {
      await expect(searchDestinations('Cowes')).rejects.toThrow('429');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
