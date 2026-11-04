import { distanceKm } from './geo';
import { initialBearingDeg, KM_PER_NM, type RouteWaypoint } from './routes';

// Active navigation: follow the GPS fix along the active route and report
// the next waypoint. The target starts at the second waypoint (the first is
// where the route starts) and advances when the boat comes within arrival
// range of it. When the last waypoint is reached the route is complete.
// Nothing here steers the boat — it reports distance and bearing, and the
// skipper still decides.

/** Arrival range: inside this the target advances to the next waypoint. */
export const NAV_ARRIVAL_NM = 0.1;

export interface NavTarget {
  index: number;
  distanceNm: number;
  bearingDeg: number;
}

/** Target waypoint for the current position, or null without a fix or route. */
export function navTarget(
  fix: RouteWaypoint | null,
  waypoints: RouteWaypoint[],
  targetIndex: number,
): NavTarget | null {
  if (!fix || waypoints.length < 2) return null;
  const clamped = Math.min(Math.max(targetIndex, 1), waypoints.length - 1);
  const target = waypoints[clamped];
  const km = distanceKm(fix.lat, fix.lon, target.lat, target.lon);
  return {
    index: clamped,
    distanceNm: km / KM_PER_NM,
    bearingDeg: initialBearingDeg(fix, target),
  };
}

/**
 * Next target index after the current fix: advance while the boat is inside
 * arrival range of the target, stopping at the last waypoint. Returns the
 * index to aim at next, plus whether the route is complete.
 */
export function advanceNavTarget(
  fix: RouteWaypoint | null,
  waypoints: RouteWaypoint[],
  targetIndex: number,
): { index: number; complete: boolean } {
  if (!fix || waypoints.length < 2) return { index: 1, complete: false };
  const lastIndex = waypoints.length - 1;
  // At the last waypoint the route is complete, even if earlier waypoints
  // were never aimed at (a boat joining mid-route, for instance).
  const last = navTarget(fix, waypoints, lastIndex);
  if (last !== null && last.distanceNm <= NAV_ARRIVAL_NM) {
    return { index: lastIndex, complete: true };
  }
  let index = Math.min(Math.max(targetIndex, 1), lastIndex);
  while (index < lastIndex) {
    const target = navTarget(fix, waypoints, index);
    if (!target || target.distanceNm > NAV_ARRIVAL_NM) break;
    index += 1;
  }
  return { index, complete: false };
}

/**
 * Whether the follow pan should recentre: only when the fix has drifted
 * past a quarter of the view span from the centre, so following does not
 * re-centre (and refetch the overlay) on every fix.
 */
export function shouldFollowPan(
  fixLat: number,
  fixLon: number,
  centerLat: number,
  centerLon: number,
  spanDeg: number,
): boolean {
  const quarter = spanDeg / 4;
  return Math.abs(fixLat - centerLat) > quarter || Math.abs(fixLon - centerLon) > quarter;
}
