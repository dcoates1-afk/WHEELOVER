import { describe, expect, it } from 'vitest';
import {
  appendPoint,
  createTrack,
  formatTrackDuration,
  loadTracks,
  trackDistanceKm,
  writeTracks,
  TRACKS_STORAGE_KEY,
} from './tracks';

function memoryStorage(initial?: Record<string, string>): Storage {
  const store = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => [...store.keys()][index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  } as Storage;
}

describe('appendPoint', () => {
  it('keeps the first point and drops sub-25 m jitter', () => {
    let track = createTrack(0);
    track = appendPoint(track, { lat: 48.0, lon: -126.0, timestamp: 0 });
    expect(track.points).toHaveLength(1);
    // ~11 m east at this latitude: dropped.
    track = appendPoint(track, { lat: 48.0, lon: -125.99985, timestamp: 1000 });
    expect(track.points).toHaveLength(1);
    // ~110 m east: kept.
    track = appendPoint(track, { lat: 48.0, lon: -125.9985, timestamp: 2000 });
    expect(track.points).toHaveLength(2);
  });

  it('halves the points at the cap', () => {
    let track = createTrack(0);
    for (let i = 0; i < 5; i += 1) {
      track = appendPoint(track, { lat: 48.0, lon: -126.0 + i * 0.01, timestamp: i * 1000 }, 4);
    }
    expect(track.points.length).toBeLessThan(5);
    expect(track.points[0]?.lon).toBe(-126.0);
  });
});

describe('track stats', () => {
  it('sums legs and formats duration', () => {
    let track = createTrack(0);
    track = appendPoint(track, { lat: 48.0, lon: -126.0, timestamp: 0 });
    track = appendPoint(track, { lat: 48.0, lon: -125.9, timestamp: 3600000 });
    expect(trackDistanceKm(track)).toBeGreaterThan(7);
    expect(trackDistanceKm(track)).toBeLessThan(8);
    expect(formatTrackDuration({ ...track, endedAt: 3600000 }, 3600000)).toBe('1h 0m');
  });
});

describe('storage round trip', () => {
  it('writes and loads newest first, dropping bad rows', () => {
    const storage = memoryStorage();
    const oldTrack = { ...createTrack(1000), points: [{ lat: 48, lon: -126, at: 1000 }] };
    const newTrack = { ...createTrack(2000), points: [{ lat: 49, lon: -127, at: 2000 }] };
    writeTracks(storage, [oldTrack, newTrack]);
    expect(loadTracks(storage).map((track) => track.startedAt)).toEqual([2000, 1000]);
    const dirty = memoryStorage({ [TRACKS_STORAGE_KEY]: JSON.stringify([{ id: 'x' }, newTrack]) });
    expect(loadTracks(dirty)).toHaveLength(1);
  });
});
