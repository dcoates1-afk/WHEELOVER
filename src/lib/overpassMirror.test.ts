import { describe, expect, it } from 'vitest';
import {
  MAX_MIRROR_LAG_MS,
  mirrorDataIsCurrent,
  replySourceTimestamp,
} from '../../server/overpassProxy';

describe('Overpass mirror freshness', () => {
  it('reads the mirror data timestamp from the reply', () => {
    expect(replySourceTimestamp({ osm3s: { timestamp_osm_base: '2026-11-01T17:57:55Z' } })).toBe(
      Date.parse('2026-11-01T17:57:55Z'),
    );
    expect(replySourceTimestamp({ elements: [] })).toBeNull();
    expect(replySourceTimestamp({ osm3s: { timestamp_osm_base: 'not a date' } })).toBeNull();
    expect(replySourceTimestamp(null)).toBeNull();
  });

  it('treats a mirror months behind as not current', () => {
    const now = Date.parse('2026-11-01T18:00:00Z');
    const hoursOld = Date.parse('2026-11-01T06:00:00Z');
    const monthsOld = Date.parse('2026-08-10T00:10:23Z');
    expect(mirrorDataIsCurrent(hoursOld, now)).toBe(true);
    expect(mirrorDataIsCurrent(monthsOld, now)).toBe(false);
    expect(mirrorDataIsCurrent(now - MAX_MIRROR_LAG_MS - 1, now)).toBe(false);
    // A mirror that reports no timestamp cannot be judged, so it keeps its trust.
    expect(mirrorDataIsCurrent(null, now)).toBe(true);
  });
});
