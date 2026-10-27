import { describe, expect, it } from 'vitest';
import { isUsWaters } from './usWaters';

describe('NOAA chart coverage regions', () => {
  it('accepts points in the contiguous US, Alaska, Hawaii and Puerto Rico', () => {
    expect(isUsWaters(40.7, -74)).toBe(true);
    expect(isUsWaters(61.2, -149.9)).toBe(true);
    expect(isUsWaters(21.3, -157.8)).toBe(true);
    expect(isUsWaters(18.2, -66.5)).toBe(true);
  });

  it('rejects points outside those NOAA coverage envelopes', () => {
    expect(isUsWaters(50.76, -1.2)).toBe(false);
    expect(isUsWaters(-33.9, 151.2)).toBe(false);
  });
});
