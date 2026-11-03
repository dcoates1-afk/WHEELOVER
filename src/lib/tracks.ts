import { distanceKm } from './geo';

export interface TrackPoint {
  lat: number;
  lon: number;
  at: number;
}

export interface Track {
  id: string;
  startedAt: number;
  endedAt: number | null;
  points: TrackPoint[];
}

export const TRACKS_STORAGE_KEY = 'wheel-over:tracks';

/** A fix only joins the track once the boat has moved this far from the last point. */
export const TRACK_MIN_MOVE_M = 25;

/** Long tracks are halved (every other point kept) once they reach this many points. */
export const TRACK_MAX_POINTS = 5000;

export function makeTrackId(now = Date.now()): string {
  return `track-${now}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createTrack(now = Date.now()): Track {
  return { id: makeTrackId(now), startedAt: now, endedAt: null, points: [] };
}

export function isTrackPoint(value: unknown): value is TrackPoint {
  if (typeof value !== 'object' || value === null) return false;
  const point = value as Record<string, unknown>;
  return (
    typeof point.lat === 'number' &&
    Number.isFinite(point.lat) &&
    point.lat >= -90 &&
    point.lat <= 90 &&
    typeof point.lon === 'number' &&
    Number.isFinite(point.lon) &&
    point.lon >= -180 &&
    point.lon <= 180 &&
    typeof point.at === 'number' &&
    Number.isFinite(point.at)
  );
}

export function isTrack(value: unknown): value is Track {
  if (typeof value !== 'object' || value === null) return false;
  const track = value as Record<string, unknown>;
  return (
    typeof track.id === 'string' &&
    typeof track.startedAt === 'number' &&
    Number.isFinite(track.startedAt) &&
    (track.endedAt === null || (typeof track.endedAt === 'number' && Number.isFinite(track.endedAt))) &&
    Array.isArray(track.points) &&
    track.points.every(isTrackPoint)
  );
}

export function loadTracks(storage: Pick<Storage, 'getItem'> | null | undefined): Track[] {
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(TRACKS_STORAGE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isTrack).sort((a, b) => b.startedAt - a.startedAt);
  } catch {
    return [];
  }
}

export function writeTracks(storage: Pick<Storage, 'setItem'> | null | undefined, tracks: Track[]): void {
  if (!storage) return;
  try {
    storage.setItem(TRACKS_STORAGE_KEY, JSON.stringify(tracks));
  } catch {
    // Private mode or full storage: the in-memory tracks still work.
  }
}

/**
 * Append a fix to a track, returning the track unchanged when the boat has
 * not moved far enough from the last recorded point — this keeps a boat
 * sitting at anchor from filling the track with GPS jitter. Points are
 * halved once the track reaches TRACK_MAX_POINTS so a long passage cannot
 * grow localStorage without bound.
 */
export function appendPoint(
  track: Track,
  fix: { lat: number; lon: number; timestamp: number },
  maxPoints = TRACK_MAX_POINTS,
): Track {
  const last = track.points[track.points.length - 1];
  if (last && distanceKm(last.lat, last.lon, fix.lat, fix.lon) * 1000 < TRACK_MIN_MOVE_M) {
    return track;
  }
  let points = [...track.points, { lat: fix.lat, lon: fix.lon, at: fix.timestamp }];
  if (points.length >= maxPoints) {
    points = points.filter((_, index) => index % 2 === 0);
  }
  return { ...track, points };
}

export function trackDistanceKm(track: Track): number {
  let total = 0;
  for (let i = 1; i < track.points.length; i += 1) {
    const from = track.points[i - 1]!;
    const to = track.points[i]!;
    total += distanceKm(from.lat, from.lon, to.lat, to.lon);
  }
  return total;
}

export function trackDurationMs(track: Track, now = Date.now()): number {
  if (track.points.length === 0) return 0;
  const end = track.endedAt ?? now;
  return Math.max(0, end - track.startedAt);
}

export function formatTrackDuration(track: Track, now = Date.now()): string {
  const minutes = Math.round(trackDurationMs(track, now) / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function formatTrackDate(track: Track): string {
  return new Date(track.startedAt).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
