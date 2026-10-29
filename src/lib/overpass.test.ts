import { describe, expect, it } from 'vitest';
import { bridgeCrossesWater } from './overpass';

describe('water-crossing bridge detection', () => {
  it('does not treat a charted bridge over untidal water as a tidal bridge', () => {
    expect(bridgeCrossesWater(
      { type: 'way', tags: { 'seamark:type': 'bridge' }, geometry: [{ lat: 51, lon: -1 }, { lat: 51.001, lon: -1 }] },
      [{ type: 'way', tags: { waterway: 'river' }, geometry: [{ lat: 51, lon: -1 }, { lat: 51.001, lon: -1 }] }],
    )).toBe(false);
  });

  it('keeps bridges crossing explicitly tidal water', () => {
    expect(bridgeCrossesWater(
      { type: 'way', tags: { bridge: 'yes' }, geometry: [{ lat: 51, lon: -1 }, { lat: 51.001, lon: -1 }] },
      [{ type: 'way', tags: { waterway: 'river', tidal: 'yes' }, geometry: [{ lat: 51, lon: -1.0003 }, { lat: 51.001, lon: -1.0003 }] }],
    )).toBe(true);
  });

  it('keeps bridges crossing a mapped tidal channel', () => {
    expect(bridgeCrossesWater(
      { type: 'way', tags: { bridge: 'yes' }, geometry: [{ lat: 51, lon: -1 }, { lat: 51.001, lon: -1 }] },
      [{ type: 'way', tags: { waterway: 'tidal_channel' }, geometry: [{ lat: 51.0003, lon: -1.0003 }, { lat: 51.0007, lon: -1.0003 }] }],
    )).toBe(true);
  });

  it('does not include bridges over rivers that lack tidal tags', () => {
    expect(bridgeCrossesWater(
      { type: 'way', tags: { bridge: 'yes' }, geometry: [{ lat: 51, lon: -1 }, { lat: 51.001, lon: -1 }] },
      [{ type: 'way', tags: { waterway: 'river' }, geometry: [{ lat: 51.0003, lon: -1.0003 }, { lat: 51.0007, lon: -1.0003 }] }],
    )).toBe(false);
  });

  it('does not match a nearby inland canal even with imperfect geometry', () => {
    expect(bridgeCrossesWater(
      { type: 'way', tags: { bridge: 'yes' }, geometry: [{ lat: 51, lon: -1 }, { lat: 51.001, lon: -1 }] },
      [{ type: 'way', tags: { waterway: 'canal' }, geometry: [{ lat: 51, lon: -1.0003 }, { lat: 51.001, lon: -1.0003 }] }],
    )).toBe(false);
  });

  it('does not accept ordinary bridges far from mapped water', () => {
    expect(bridgeCrossesWater(
      { type: 'way', tags: { bridge: 'yes' }, geometry: [{ lat: 51, lon: -1 }, { lat: 51.001, lon: -1 }] },
      [{ type: 'way', tags: { waterway: 'river' }, geometry: [{ lat: 51, lon: -1.01 }, { lat: 51.001, lon: -1.01 }] }],
    )).toBe(false);
  });
});
