import { describe, expect, it } from 'vitest';
import {
  fetchNotmarWarnings,
  notmarAreaName,
  parseNotmarPositions,
  parseNotmarWarnings,
} from './notmars';

describe('parseNotmarPositions', () => {
  it('parses N/W and S/E pairs with minute conversion', () => {
    const positions = parseNotmarPositions(
      'IN 14-51.78N 061-18.18W. AND 33-30.00S 151-00.00E.',
    );
    expect(positions).toHaveLength(2);
    expect(positions[0]?.lat).toBeCloseTo(14.863, 3);
    expect(positions[0]?.lon).toBeCloseTo(-61.303, 3);
    expect(positions[1]?.lat).toBe(-33.5);
    expect(positions[1]?.lon).toBe(151);
  });

  it('returns nothing when the text has no pairs', () => {
    expect(parseNotmarPositions('ALL THE INFORCE WARNINGS ARE LISTED HERE.')).toEqual([]);
  });

  it('caps the pairs per warning', () => {
    const text = Array.from({ length: 60 }, (_, i) => `${10 + (i % 10)}-00.00N 020-00.00W`).join(' ');
    expect(parseNotmarPositions(text)).toHaveLength(50);
    expect(parseNotmarPositions(text, 3)).toHaveLength(3);
  });

  it('drops out-of-range pairs', () => {
    expect(parseNotmarPositions('IN 95-00.00N 020-00.00W.')).toEqual([]);
  });
});

const FEED = {
  'broadcast-warn': [
    {
      msgYear: 2024,
      msgNumber: 500,
      navArea: '4',
      subregion: '25',
      issueDate: '040133Z MAY 2024',
      text: 'MARTINIQUE. 14 METER S/V IN 14-51.78N 061-18.18W.',
    },
    {
      msgYear: 2024,
      msgNumber: 498,
      navArea: '4',
      subregion: 'GEN',
      issueDate: '031637Z MAY 2024',
      text: 'WARNINGS IN FORCE AS OF 031554Z MAY. 496/2024, 495/2024.',
    },
    { msgYear: 2024, navArea: '4', text: 'Missing its number.' },
  ],
};

describe('parseNotmarWarnings', () => {
  it('builds ids, keeps list-only warnings, drops unidentifiable rows', () => {
    const warnings = parseNotmarWarnings(FEED);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]?.id).toBe('4 500/2024');
    expect(warnings[0]?.positions).toHaveLength(1);
    expect(warnings[1]?.positions).toEqual([]);
    expect(warnings[1]?.issueDate).toBe('031637Z MAY 2024');
  });

  it('tolerates a malformed payload', () => {
    expect(parseNotmarWarnings(null)).toEqual([]);
    expect(parseNotmarWarnings({})).toEqual([]);
  });
});

describe('notmarAreaName', () => {
  it('names the known areas and falls back gracefully', () => {
    expect(notmarAreaName('4')).toBe('NAVAREA IV');
    expect(notmarAreaName('P')).toBe('HYDROPAC');
    expect(notmarAreaName('9')).toBe('Area 9');
  });
});

describe('fetchNotmarWarnings', () => {
  it('fetches the relay and parses', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => FEED,
    })) as unknown as typeof fetch;
    try {
      const result = await fetchNotmarWarnings();
      expect(result.warnings).toHaveLength(2);
      expect(result.stale).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('reports a stale relay response', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({ ...FEED, stale: true, fetchedAt: '2026-11-03T00:00:00.000Z' }),
    })) as unknown as typeof fetch;
    try {
      const result = await fetchNotmarWarnings();
      expect(result.warnings).toHaveLength(2);
      expect(result.stale).toBe(true);
      expect(result.fetchedAt).toBe('2026-11-03T00:00:00.000Z');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
