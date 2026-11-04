import { isValidWaypoint, type RouteWaypoint } from './routes';

// Saved routes: named copies of a route, kept on this device only so the
// navigator can return to a passage later. Loading a saved route replaces
// the active route — the builder always works on one route at a time.

export interface SavedRoute {
  id: string;
  name: string;
  waypoints: RouteWaypoint[];
  speedKnots: number;
  createdAt: number;
}

export const SAVED_ROUTES_STORAGE_KEY = 'wheel-over:saved-routes';

export function createSavedRoute(
  name: string,
  waypoints: RouteWaypoint[],
  speedKnots: number,
  now: number = Date.now(),
): SavedRoute {
  return {
    id: `route-${now}-${Math.floor(Math.random() * 1e9).toString(36)}`,
    name,
    waypoints: waypoints.map((point) => ({ ...point })),
    speedKnots,
    createdAt: now,
  };
}

export function isValidSavedRoute(value: unknown): value is SavedRoute {
  if (!value || typeof value !== 'object') return false;
  const route = value as Partial<SavedRoute>;
  return (
    typeof route.id === 'string' &&
    route.id.length > 0 &&
    typeof route.name === 'string' &&
    route.name.length > 0 &&
    Array.isArray(route.waypoints) &&
    route.waypoints.length >= 2 &&
    route.waypoints.every(isValidWaypoint) &&
    typeof route.speedKnots === 'number' &&
    Number.isFinite(route.speedKnots) &&
    route.speedKnots > 0 &&
    typeof route.createdAt === 'number' &&
    Number.isFinite(route.createdAt)
  );
}

/** Stored saved routes, newest first; malformed rows are dropped, never trusted. */
export function loadSavedRoutes(storage: Storage | null): SavedRoute[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(SAVED_ROUTES_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isValidSavedRoute)
      .sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

export function writeSavedRoutes(storage: Storage | null, routes: SavedRoute[]): void {
  if (!storage) return;
  try {
    storage.setItem(SAVED_ROUTES_STORAGE_KEY, JSON.stringify(routes));
  } catch {
    // A full or unavailable store must not break the chart.
  }
}
