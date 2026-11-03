import { distanceKm } from './geo';
import { GEBCO_IDENTIFY } from './depthLabels';
import type { RouteWaypoint } from './routes';

/**
 * Anti-grounding flag. It FLAGS legs that may ground; it never clears a
 * route. GEBCO is a modelled ~450 m grid referenced to mean sea level, not
 * a survey and not chart datum, and tide is NOT applied in v1 — so a
 * narrow channel can read as land and a shallow reading near low water is
 * worse than shown.
 *
 * Why this does its own GEBCO fetch instead of reusing the depth labels:
 * the label parser drops land values (they are not depths to label), but
 * for a grounding check a land value IS the signal. This parser keeps raw
 * elevations: >= 0 means the grid cell is at or above sea level.
 */

export interface GroundingPoint {
  lat: number;
  lon: number;
  legIndex: number;
}

export interface GroundingSample extends GroundingPoint {
  /** Raw GEBCO elevation in metres, or null when the grid has no value. */
  elevation: number | null;
}

export interface GroundingFlag {
  legIndex: number;
  kind: 'land' | 'shallow';
  /** How many samples on this leg raised this flag. */
  count: number;
  /** Worst spot: highest elevation for land, shallowest water for shallow. */
  lat: number;
  lon: number;
  /** Water depth at the worst shallow spot, or elevation at the worst land spot. */
  metres: number;
}

export interface GroundingResult {
  flags: GroundingFlag[];
  sampled: number;
  unsampled: number;
}

/** Legs are sampled about every 250 m; long routes sample more coarsely. */
export const GROUNDING_SPACING_KM = 0.25;
const MAX_SAMPLES = 2000;
const GEBCO_CHUNK = 50;

export function sampleRoute(waypoints: RouteWaypoint[], spacingKm = GROUNDING_SPACING_KM): GroundingPoint[] {
  if (waypoints.length < 2) return [];
  let totalKm = 0;
  for (let i = 1; i < waypoints.length; i++) {
    totalKm += distanceKm(waypoints[i - 1].lat, waypoints[i - 1].lon, waypoints[i].lat, waypoints[i].lon);
  }
  const spacing = Math.max(spacingKm, totalKm / MAX_SAMPLES);
  const points: GroundingPoint[] = [];
  for (let leg = 1; leg < waypoints.length; leg++) {
    const from = waypoints[leg - 1];
    const to = waypoints[leg];
    const lengthKm = distanceKm(from.lat, from.lon, to.lat, to.lon);
    const steps = Math.max(1, Math.ceil(lengthKm / spacing));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      points.push({
        lat: from.lat + (to.lat - from.lat) * t,
        lon: from.lon + (to.lon - from.lon) * t,
        legIndex: leg - 1,
      });
    }
  }
  return points;
}

/** Group samples into per-leg flags: worst spot per leg per kind. */
export function evaluateGrounding(
  samples: GroundingSample[],
  draughtM: number,
  marginM: number,
): GroundingResult {
  const required = draughtM + marginM;
  const byKey = new Map<string, GroundingFlag>();
  let sampled = 0;
  let unsampled = 0;
  for (const sample of samples) {
    if (sample.elevation === null || !Number.isFinite(sample.elevation)) {
      unsampled++;
      continue;
    }
    sampled++;
    if (sample.elevation >= 0) {
      const key = `${sample.legIndex}:land`;
      const current = byKey.get(key);
      if (!current || sample.elevation > current.metres) {
        byKey.set(key, {
          legIndex: sample.legIndex,
          kind: 'land',
          count: (current?.count ?? 0) + 1,
          lat: sample.lat,
          lon: sample.lon,
          metres: sample.elevation,
        });
      } else {
        current.count++;
      }
      continue;
    }
    const waterDepth = -sample.elevation;
    if (waterDepth < required) {
      const key = `${sample.legIndex}:shallow`;
      const current = byKey.get(key);
      if (!current || waterDepth < current.metres) {
        byKey.set(key, {
          legIndex: sample.legIndex,
          kind: 'shallow',
          count: (current?.count ?? 0) + 1,
          lat: sample.lat,
          lon: sample.lon,
          metres: waterDepth,
        });
      } else {
        current.count++;
      }
    }
  }
  const flags = [...byKey.values()].sort((a, b) => a.legIndex - b.legIndex || (a.kind < b.kind ? -1 : 1));
  return { flags, sampled, unsampled };
}

interface GebcoIdentifyResult {
  location?: { x?: unknown; y?: unknown };
  value?: unknown;
}

/** Raw GEBCO elevations for the given points, in the same batches of 50 the
 * depth labels use. Land elevations are kept; only missing or absurd
 * values come back null. */
export async function fetchGebcoElevations(
  points: GroundingPoint[],
  signal: AbortSignal,
): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  const keyFor = (lat: number, lon: number) => `${lat.toFixed(5)}:${lon.toFixed(5)}`;
  for (let start = 0; start < points.length; start += GEBCO_CHUNK) {
    if (signal.aborted) break;
    const chunk = points.slice(start, start + GEBCO_CHUNK);
    const geometry = {
      points: chunk.map((point) => [point.lon, point.lat]),
      spatialReference: { wkid: 4326 },
    };
    const url =
      `${GEBCO_IDENTIFY}?f=json&geometry=${encodeURIComponent(JSON.stringify(geometry))}` +
      '&geometryType=esriGeometryMultipoint&sr=4326&returnGeometry=false';
    try {
      const response = await fetch(url, { signal });
      if (!response.ok) throw new Error(`GEBCO HTTP ${response.status}`);
      const body = (await response.json()) as { results?: unknown; value?: unknown };
      const entries = Array.isArray(body?.results)
        ? (body.results as GebcoIdentifyResult[])
        : body && body.value !== undefined
          ? [body as GebcoIdentifyResult]
          : [];
      const byLocation = new Map<string, number>();
      for (const entry of entries) {
        const lon = Number(entry?.location?.x);
        const lat = Number(entry?.location?.y);
        const value = Number(entry?.value);
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(value)) continue;
        if (value <= -11_000) continue;
        byLocation.set(keyFor(lat, lon), value);
      }
      for (const point of chunk) {
        out.set(keyFor(point.lat, point.lon), byLocation.get(keyFor(point.lat, point.lon)) ?? null);
      }
    } catch {
      // A failed chunk leaves its points unsampled; the panel says so
      // instead of pretending the leg was checked.
      for (const point of chunk) {
        if (!out.has(keyFor(point.lat, point.lon))) out.set(keyFor(point.lat, point.lon), null);
      }
    }
  }
  return out;
}
