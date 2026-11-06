const EARTH_RADIUS_KM = 6371;

const toRad = (value: number) => (value * Math.PI) / 180;

/** Great-circle distance in kilometres. */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

const COMPASS = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
];

/** Sixteen-point compass name for a bearing in degrees true. */
export function compassPoint(degrees: number): string {
  const normalised = ((degrees % 360) + 360) % 360;
  return COMPASS[Math.round(normalised / 22.5) % 16];
}

/** A chart viewport: [south, west, north, east] in degrees. */
export type Bounds = [number, number, number, number];

/**
 * Longitude ranges a box covers, split at the antimeridian: a box running from
 * +170 to -170 is two ranges, not one that spans the globe the long way round.
 */
function longitudeRanges(west: number, east: number): Array<[number, number]> {
  return west <= east ? [[west, east]] : [[west, 180], [-180, east]];
}

/**
 * True when two chart viewports overlap. This decides whether a regional
 * dataset is worth downloading, so it errs towards a false positive: an unneeded
 * fetch costs bytes, a skipped one loses lights off the chart.
 *
 * Longitudes are compared modulo 360 so a coverage box may be written in the
 * compact "Pacific" form (e.g. -216..-122 for a volume that straddles the
 * antimeridian) and still match a view given in ordinary -180..180 degrees.
 */
export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  const [aSouth, aWest, aNorth, aEast] = a;
  const [bSouth, bWest, bNorth, bEast] = b;
  if (aNorth < bSouth || bNorth < aSouth) return false;
  const aRanges = longitudeRanges(aWest, aEast);
  const bRanges = longitudeRanges(bWest, bEast);
  return aRanges.some(([aStart, aEnd]) =>
    bRanges.some(([bStart, bEnd]) =>
      [-360, 0, 360].some((shift) => aStart <= bEnd + shift && bStart + shift <= aEnd),
    ),
  );
}

// --- Route safety helpers -------------------------------------------------
// Small pure functions for the route-vs-hazard checks. Coordinates are
// [lat, lon] pairs throughout, matching the rest of the app. Distances use a
// local flat-earth projection around the segment's midpoint: accurate well
// under a kilometre for the short legs these checks run on, and far cheaper
// than a great-circle per sample. These helpers never decide anything on
// their own — the route checks report what they find and the skipper decides.

type LatLon = [number, number];

export type { LatLon };

function toLocalKm(lat: number, lon: number, lat0: number): { x: number; y: number } {
  return {
    x: toRad(lon) * EARTH_RADIUS_KM * Math.cos(toRad(lat0)),
    y: toRad(lat) * EARTH_RADIUS_KM,
  };
}

/** Shortest distance in kilometres from a point to a line segment. */
export function pointSegmentDistanceKm(
  lat: number,
  lon: number,
  a: LatLon,
  b: LatLon,
): number {
  const lat0 = (a[0] + b[0]) / 2;
  const p = toLocalKm(lat, lon, lat0);
  const pa = toLocalKm(a[0], a[1], lat0);
  const pb = toLocalKm(b[0], b[1], lat0);
  const dx = pb.x - pa.x;
  const dy = pb.y - pa.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - pa.x, p.y - pa.y);
  const t = Math.max(0, Math.min(1, ((p.x - pa.x) * dx + (p.y - pa.y) * dy) / lenSq));
  return Math.hypot(p.x - (pa.x + t * dx), p.y - (pa.y + t * dy));
}

/**
 * Ray-casting point-in-polygon test. A point on an edge counts as inside —
 * for a hazard check, touching the boundary is the same as crossing it.
 */
export function pointInPolygon(lat: number, lon: number, ring: LatLon[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [latI, lonI] = ring[i];
    const [latJ, lonJ] = ring[j];
    // On-edge check: collinear and within the edge's bounding box.
    const cross = (lon - lonI) * (latJ - latI) - (lat - latI) * (lonJ - lonI);
    const onEdge =
      Math.abs(cross) < 1e-12 &&
      lat >= Math.min(latI, latJ) && lat <= Math.max(latI, latJ) &&
      lon >= Math.min(lonI, lonJ) && lon <= Math.max(lonI, lonJ);
    if (onEdge) return true;
    const crosses =
      (latI > lat) !== (latJ > lat) &&
      lon < ((lonJ - lonI) * (lat - latI)) / (latJ - latI) + lonI;
    if (crosses) inside = !inside;
  }
  return inside;
}
