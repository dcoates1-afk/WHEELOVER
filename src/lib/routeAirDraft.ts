import { distanceKm, pointSegmentDistanceKm, type LatLon } from './geo';
import { clearancesForFeature, decidingClearance, type ClearanceDatasets } from './clearances';
import type { ChartFeature } from './overpass';
import type { RouteWaypoint } from './routes';

/**
 * Route air-draft check. It FLAGS bridges a route may not clear; it never
 * certifies a route passable. Figures are judged at their stated datum
 * with NO tide applied: water above the datum eats clearance metre for
 * metre, so a pass at datum level is not a pass at high water, and a
 * fail at datum level is a warning to check the tide, not a proof the
 * bridge can never be passed. A figure whose datum is not stated
 * ("datum not stated" in the datasets) can never support a pass — it is
 * reported as unverifiable, never counted as clearing.
 *
 * Bridges come from the chart features the route panel already receives
 * (the bridges part of the chart-features pipeline); authority figures
 * come from the clearance join in clearances.ts, the same join the bridge
 * cards use. Only bridges whose chart data has loaded for the route's
 * area can be found — a leg through an unvisited area checks against
 * nothing until that area's data loads.
 */

export type AirDraftVerdict = 'fail' | 'pass' | 'unverified';

export interface AirDraftBridgeCheck {
  legIndex: number;
  bridgeId: string;
  name: string;
  lat: number;
  lon: number;
  verdict: AirDraftVerdict;
  /** Most restrictive datum-known standing figure behind the verdict, metres, or null. */
  clearanceM: number | null;
  /** Air draft + margin the figure was judged against, metres. */
  requiredM: number;
  /** Datum of the figure behind the verdict, or null when there is none. */
  datum: string | null;
  /** Sources behind the verdict (all sources when no datum-known figure exists). */
  sources: string[];
  /** True when the bridge also carries datum-unknown figures, which never count. */
  hasDatumUnknown: boolean;
  /** True when the figure behind the verdict is a group least (a lower bound). */
  least: boolean;
  /** Most generous open figure for a movable bridge, metres, or null. */
  openM: number | null;
}

export interface AirDraftResult {
  checks: AirDraftBridgeCheck[];
}

export interface AirDraftInput {
  waypoints: RouteWaypoint[];
  /** Chart features; only type 'bridge' entries are considered. */
  bridges: ChartFeature[];
  datasets: ClearanceDatasets;
  airDraftM: number;
  marginM: number;
}

/** Legs are sampled about every 100 m; a bridge counts as crossed within 50 m. */
export const AIR_DRAFT_SAMPLE_KM = 0.1;
export const BRIDGE_PROXIMITY_KM = 0.05;
/** Long legs sample more coarsely rather than stalling the panel. */
const MAX_SAMPLES_PER_LEG = 2000;

function sampleLeg(from: RouteWaypoint, to: RouteWaypoint): LatLon[] {
  const lengthKm = distanceKm(from.lat, from.lon, to.lat, to.lon);
  const steps = Math.max(1, Math.min(MAX_SAMPLES_PER_LEG, Math.ceil(lengthKm / AIR_DRAFT_SAMPLE_KM)));
  const points: LatLon[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    points.push([from.lat + (to.lat - from.lat) * t, from.lon + (to.lon - from.lon) * t]);
  }
  return points;
}

function bridgeSegments(bridge: ChartFeature): [LatLon, LatLon][] {
  const path = bridge.path ?? [];
  if (path.length >= 2) {
    const segments: [LatLon, LatLon][] = [];
    for (let i = 1; i < path.length; i++) segments.push([path[i - 1], path[i]]);
    return segments;
  }
  return [];
}

function sampleCrossesBridge(lat: number, lon: number, bridge: ChartFeature): boolean {
  const segments = bridgeSegments(bridge);
  if (segments.length === 0) {
    return distanceKm(lat, lon, bridge.lat, bridge.lon) < BRIDGE_PROXIMITY_KM;
  }
  return segments.some(([a, b]) => pointSegmentDistanceKm(lat, lon, a, b) < BRIDGE_PROXIMITY_KM);
}

function evaluateBridge(
  bridge: ChartFeature,
  datasets: ClearanceDatasets,
  requiredM: number,
  legIndex: number,
): AirDraftBridgeCheck {
  const rows = clearancesForFeature(bridge, datasets);
  const hasDatumUnknown = rows.some((row) => row.datum === null);
  const known = rows.filter((row) => row.datum !== null);
  // The deciding figure is the lowest datum-stated exact figure (Doug's
  // rule: close but conflicting heights use the lower one, safest call) —
  // see decidingClearance in clearances.ts.
  const deciding = decidingClearance(rows);
  const clearanceM = deciding?.value ?? null;
  const datum = deciding?.datum ?? null;
  const least = deciding?.least ?? false;
  // A least figure below the requirement proves nothing: the real
  // clearance is at least that figure, so it may still clear. Only an
  // exact figure below the requirement is a fail.
  let verdict: AirDraftVerdict = 'unverified';
  if (clearanceM !== null && deciding !== null) {
    if (!deciding.least) verdict = clearanceM < requiredM ? 'fail' : 'pass';
    else verdict = clearanceM >= requiredM ? 'pass' : 'unverified';
  }
  const openValues: number[] = [];
  for (const row of rows) openValues.push(...row.openValues);
  const sources = [...new Set((known.length > 0 ? known : rows).map((row) => row.source))];
  return {
    legIndex,
    bridgeId: bridge.id,
    name: bridge.name || 'Bridge',
    lat: bridge.lat,
    lon: bridge.lon,
    verdict,
    clearanceM,
    requiredM,
    datum,
    sources,
    hasDatumUnknown,
    least,
    openM: openValues.length > 0 ? Math.min(...openValues) : null,
  };
}

/** One check per bridge crossed, in the order each leg meets them. */
export function checkRouteAirDraft(input: AirDraftInput): AirDraftResult {
  const { waypoints } = input;
  if (waypoints.length < 2) return { checks: [] };
  const requiredM = input.airDraftM + input.marginM;
  const bridges = input.bridges.filter((feature) => feature.type === 'bridge');
  const checks: AirDraftBridgeCheck[] = [];
  for (let legIndex = 1; legIndex < waypoints.length; legIndex++) {
    const samples = sampleLeg(waypoints[legIndex - 1], waypoints[legIndex]);
    const seen = new Set<string>();
    for (const [lat, lon] of samples) {
      for (const bridge of bridges) {
        if (seen.has(bridge.id)) continue;
        if (!sampleCrossesBridge(lat, lon, bridge)) continue;
        seen.add(bridge.id);
        checks.push(evaluateBridge(bridge, input.datasets, requiredM, legIndex - 1));
      }
    }
  }
  return { checks };
}
