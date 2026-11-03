import { distanceKm, pointInPolygon, pointSegmentDistanceKm, type LatLon } from './geo';
import type { ChartFeature } from './overpass';
import type { ProtectedAreaFeature } from './protectedAreas';
import type { MarineFeature } from './marineDb';
import type { RouteWaypoint } from './routes';

/**
 * Route-vs-hazard check. It FLAGS hazards on a route; it never certifies a
 * route safe. Only hazards whose chart data has loaded for the route's area
 * can be found — a leg through an unvisited area checks against nothing
 * until that area's data loads, so the panel says "mapped hazards" throughout.
 */

export interface RouteHazard {
  kind: 'area' | 'lane';
  name: string;
  group: string;
}

export interface RouteLegHazards {
  legIndex: number;
  hazards: RouteHazard[];
}

export interface RouteHazardInput {
  waypoints: RouteWaypoint[];
  /** Live chart features (areas carry rings + areaGroup/areaLabel). */
  areas: ChartFeature[];
  /** Natura 2000 features; geometry is GeoJSON ([lon, lat] order). */
  protectedAreas: ProtectedAreaFeature[];
  ferries: MarineFeature[];
  tss: MarineFeature[];
}

/** Legs are sampled about every 100 m; a lane counts as crossed within 50 m. */
export const HAZARD_SAMPLE_KM = 0.1;
export const LANE_PROXIMITY_KM = 0.05;
/** Long legs sample more coarsely rather than stalling the panel. */
const MAX_SAMPLES_PER_LEG = 2000;

interface AreaCandidate {
  name: string;
  group: string;
  rings: LatLon[][];
}

interface LaneCandidate {
  name: string;
  group: string;
  segments: [LatLon, LatLon][];
  rings: LatLon[][];
}

function chartAreaCandidates(features: ChartFeature[]): AreaCandidate[] {
  const out: AreaCandidate[] = [];
  for (const feature of features) {
    if (!feature.rings || feature.rings.length === 0) continue;
    // A ring without an area class is a bridge outline or similar, not a
    // hazard area — the class is what makes it one.
    if (!feature.areaGroup && !feature.areaLabel) continue;
    out.push({
      name: feature.name || feature.areaLabel || 'Marine area',
      group: feature.areaGroup ?? feature.areaLabel ?? 'Marine area',
      rings: feature.rings,
    });
  }
  return out;
}

/** GeoJSON rings are [lon, lat]; the geo helpers take [lat, lon]. */
function geoJsonRings(geometry: unknown): LatLon[][] {
  if (!geometry || typeof geometry !== 'object') return [];
  const { type, coordinates } = geometry as { type?: string; coordinates?: unknown };
  const flip = (ring: unknown): LatLon[] =>
    Array.isArray(ring)
      ? ring
          .filter(
            (point): point is [number, number] =>
              Array.isArray(point) &&
              point.length >= 2 &&
              typeof point[0] === 'number' &&
              typeof point[1] === 'number',
          )
          .map(([lon, lat]) => [lat, lon] as LatLon)
      : [];
  if (type === 'Polygon' && Array.isArray(coordinates)) {
    return (coordinates as unknown[]).map(flip).filter((ring) => ring.length >= 3);
  }
  if (type === 'MultiPolygon' && Array.isArray(coordinates)) {
    const rings: LatLon[][] = [];
    for (const polygon of coordinates as unknown[]) {
      if (!Array.isArray(polygon)) continue;
      for (const ring of polygon.map(flip)) {
        if (ring.length >= 3) rings.push(ring);
      }
    }
    return rings;
  }
  return [];
}

function protectedAreaCandidates(features: ProtectedAreaFeature[]): AreaCandidate[] {
  const out: AreaCandidate[] = [];
  for (const feature of features) {
    const rings = geoJsonRings(feature.geometry);
    if (rings.length === 0) continue;
    out.push({ name: feature.name || 'Protected area', group: 'Protected area', rings });
  }
  return out;
}

function laneCandidates(features: MarineFeature[], group: string, fallbackName: string): LaneCandidate[] {
  const out: LaneCandidate[] = [];
  for (const feature of features) {
    const paths = [feature.path, ...(feature.paths ?? [])].filter(
      (path): path is LatLon[] => Array.isArray(path) && path.length >= 2,
    );
    const segments: [LatLon, LatLon][] = [];
    for (const path of paths) {
      for (let i = 1; i < path.length; i++) segments.push([path[i - 1], path[i]]);
    }
    const rings = (feature.polygons ?? []).flat().filter((ring) => ring.length >= 3);
    if (segments.length === 0 && rings.length === 0) continue;
    out.push({ name: feature.name || fallbackName, group, segments, rings });
  }
  return out;
}

function sampleLeg(from: RouteWaypoint, to: RouteWaypoint): LatLon[] {
  const lengthKm = distanceKm(from.lat, from.lon, to.lat, to.lon);
  const steps = Math.max(1, Math.min(MAX_SAMPLES_PER_LEG, Math.ceil(lengthKm / HAZARD_SAMPLE_KM)));
  const points: LatLon[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    points.push([from.lat + (to.lat - from.lat) * t, from.lon + (to.lon - from.lon) * t]);
  }
  return points;
}

/** One hazard entry per leg per hazard, in the order the leg meets them. */
export function checkRouteHazards(input: RouteHazardInput): RouteLegHazards[] {
  const { waypoints } = input;
  if (waypoints.length < 2) return [];
  const areas = [...chartAreaCandidates(input.areas), ...protectedAreaCandidates(input.protectedAreas)];
  const lanes = [
    ...laneCandidates(input.ferries, 'Ferry route', 'Ferry route'),
    ...laneCandidates(input.tss, 'Traffic separation scheme', 'Traffic separation scheme'),
  ];
  const results: RouteLegHazards[] = [];
  for (let legIndex = 1; legIndex < waypoints.length; legIndex++) {
    const samples = sampleLeg(waypoints[legIndex - 1], waypoints[legIndex]);
    const seen = new Set<string>();
    const hazards: RouteHazard[] = [];
    const hit = (hazard: RouteHazard) => {
      const key = `${hazard.kind}:${hazard.group}:${hazard.name}`;
      if (seen.has(key)) return;
      seen.add(key);
      hazards.push(hazard);
    };
    for (const [lat, lon] of samples) {
      for (const area of areas) {
        if (area.rings.some((ring) => pointInPolygon(lat, lon, ring))) {
          hit({ kind: 'area', name: area.name, group: area.group });
        }
      }
      for (const lane of lanes) {
        const nearSegment = lane.segments.some(
          ([a, b]) => pointSegmentDistanceKm(lat, lon, a, b) < LANE_PROXIMITY_KM,
        );
        const insideZone = lane.rings.some((ring) => pointInPolygon(lat, lon, ring));
        if (nearSegment || insideZone) {
          hit({ kind: 'lane', name: lane.name, group: lane.group });
        }
      }
    }
    results.push({ legIndex: legIndex - 1, hazards });
  }
  return results;
}
