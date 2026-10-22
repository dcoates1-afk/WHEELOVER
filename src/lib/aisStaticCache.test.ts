import { describe, expect, it } from 'vitest';
import type { AisVessel } from './ais';
import {
  AIS_STATIC_STORAGE_KEY,
  applyStaticInfo,
  readAisStaticCache,
  rememberVessels,
  writeAisStaticCache,
} from './aisStaticCache';

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

function vessel(overrides: Partial<AisVessel> = {}): AisVessel {
  return {
    mmsi: 316001234,
    name: null,
    lat: 48.44,
    lon: -123.44,
    sog: 6,
    cog: 15,
    heading: 14,
    shipType: null,
    typeCode: null,
    destination: null,
    navStatus: 0,
    callSign: null,
    imo: null,
    draught: null,
    length: null,
    beam: null,
    eta: null,
    transponder: 'B',
    lastSeen: Date.now(),
    staticAt: null,
    simulated: false,
    ...overrides,
  };
}

describe('AIS static cache', () => {
  it('round-trips static fields through storage', () => {
    const storage = new MemoryStorage();
    const cache = rememberVessels(
      new Map(),
      [
        vessel({
          name: 'INSPECTOR',
          shipType: 'Cargo',
          typeCode: 70,
          destination: 'VANCOUVER',
          callSign: 'CGCX',
          imo: 9_123_456,
          draught: 5.2,
          length: 112,
          beam: 18,
          eta: '14 Jun 22:00 UTC',
        }),
      ],
      1_000,
    );
    expect(cache.changed).toBe(true);
    writeAisStaticCache(storage, cache.cache);

    const loaded = readAisStaticCache(storage, 2_000);
    const record = loaded.get(316001234);
    expect(record?.name).toBe('INSPECTOR');
    expect(record?.typeCode).toBe(70);
    expect(record?.destination).toBe('VANCOUVER');
    expect(record?.length).toBe(112);
    expect(record?.beam).toBe(18);
    expect(record?.transponder).toBe('B');
    expect(record?.savedAt).toBe(1_000);
  });

  it('imports static data from previous prefixes and writes to WHEELOVER storage', () => {
    const leewardStorage = new MemoryStorage();
    leewardStorage.setItem('leeward:ais-static', JSON.stringify({
      '316001240': { name: 'LEEWARDED', savedAt: 1_000 },
    }));
    expect(readAisStaticCache(leewardStorage, 2_000).get(316001240)?.name).toBe('LEEWARDED');

    const storage = new MemoryStorage();
    storage.setItem('marnav:ais-static', JSON.stringify({
      '316001241': { name: 'LEGACY', savedAt: 1_000 },
    }));
    expect(readAisStaticCache(storage, 2_000).get(316001241)?.name).toBe('LEGACY');
    writeAisStaticCache(storage, new Map([[316001241, {
      name: 'WHEELOVER', shipType: null, typeCode: null, destination: null, callSign: null,
      imo: null, draught: null, length: null, beam: null, eta: null, transponder: null, savedAt: 2_000,
    }]]));
    expect(storage.getItem(AIS_STATIC_STORAGE_KEY)).toContain('WHEELOVER');
  });

  it('ignores junk, bad MMSIs and stale records', () => {
    const storage = new MemoryStorage();
    storage.setItem(AIS_STATIC_STORAGE_KEY, 'not json');
    expect(readAisStaticCache(storage).size).toBe(0);

    storage.setItem(
      AIS_STATIC_STORAGE_KEY,
      JSON.stringify({
        '12': { name: 'TOO SHORT', savedAt: 1000 },
        '316001234': { name: 'OLD', savedAt: 1000 },
        '316001235': { name: '', savedAt: 1000 },
        '316001236': { name: 'FRESH', savedAt: Date.now() },
      }),
    );
    const loaded = readAisStaticCache(storage);
    expect([...loaded.keys()]).toEqual([316001236]);
  });

  it('never overwrites a live value with a cached one', () => {
    const live = vessel({ name: 'LIVE NAME', typeCode: 70, destination: 'AT SEA' });
    const merged = applyStaticInfo(live, {
      name: 'CACHED NAME',
      shipType: 'Cargo',
      typeCode: 70,
      destination: 'CACHED PORT',
      callSign: 'CALL',
      imo: null,
      draught: null,
      length: 50,
      beam: 9,
      eta: null,
      transponder: 'A',
      savedAt: 5_000,
    });
    expect(merged.name).toBe('LIVE NAME');
    expect(merged.destination).toBe('AT SEA');
    expect(merged.callSign).toBe('CALL');
    expect(merged.length).toBe(50);
    // The live Class B report wins over the cached Class A record.
    expect(merged.transponder).toBe('B');
    expect(merged.staticAt).toBe(5_000);
  });

  it('only reports a change when a field actually moved', () => {
    const first = rememberVessels(new Map(), [vessel({ name: 'ONE', typeCode: 70 })], 1_000);
    const unchanged = rememberVessels(first.cache, [vessel({ name: 'ONE', typeCode: 70 })], 9_000);
    expect(unchanged.changed).toBe(false);
    expect(unchanged.cache.get(316001234)?.savedAt).toBe(1_000);

    const moved = rememberVessels(first.cache, [vessel({ name: 'ONE', typeCode: 70, destination: 'OSLO' })], 9_000);
    expect(moved.changed).toBe(true);
    expect(moved.cache.get(316001234)?.destination).toBe('OSLO');
    expect(moved.cache.get(316001234)?.savedAt).toBe(9_000);
  });

  it('skips targets with nothing static to remember', () => {
    const result = rememberVessels(new Map(), [vessel()], 1_000);
    expect(result.changed).toBe(false);
    expect(result.cache.size).toBe(0);
  });
});
