import { bearingDegrees, distanceMeters } from '../../shared/navaid-core.mjs';
import type { AisVessel } from './ais';
import { vesselLabel } from './ais';
import { formatDepthWithUnit, formatDistance } from './settings';
import type { DepthUnit, DistanceUnit } from './settings';
import { formatWatchAge } from './voyageWatch';
import type { AnchorWatch, CourseWatch, VoyageWatch } from './voyageWatch';

/**
 * Chart alerts for the two conditions the boat settings can judge: depth under
 * the keel and AIS traffic closing on the vessel.
 *
 * The depth figures come from the modelled seabed (GEBCO, refined by EMODnet),
 * not from a survey, so an alert is a prompt to look at the chart rather than a
 * measured clearance.
 */

export type AlertKind = 'shallow' | 'proximity' | 'anchor' | 'course';
export type AlertLevel = 'danger' | 'caution';

export interface ChartAlert {
  /** Stable key: the same condition keeps the same id as it updates. */
  id: string;
  kind: AlertKind;
  level: AlertLevel;
  title: string;
  detail: string;
}

export const DRAUGHT_MIN_M = 0.2;
export const DRAUGHT_MAX_M = 20;
/** Half a nautical mile: close enough to be worth a look on deck. */
export const PROXIMITY_RADIUS_M = 926;
export const PROXIMITY_DANGER_M = 463;
/** Clearance below the keel that still counts as shallow. */
export const SHALLOW_MARGIN_M = 1;

/** The draught entered in Boat settings, in metres, or null when unset. */
export function parseDraught(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const value = Number.parseFloat(String(raw).replace(',', '.').trim());
  if (!Number.isFinite(value) || value < DRAUGHT_MIN_M || value > DRAUGHT_MAX_M) return null;
  return Math.round(value * 100) / 100;
}

/**
 * Depth left under the keel. Anything at or below zero is a danger; a thin
 * margin is a caution, because the model itself is coarser than the seabed.
 */
export function shallowWaterAlert(
  depthM: number | null | undefined,
  draughtM: number | null | undefined,
  options: { unit?: DepthUnit; marginM?: number } = {},
): ChartAlert | null {
  if (draughtM === null || draughtM === undefined) return null;
  if (depthM === null || depthM === undefined || !Number.isFinite(depthM) || depthM <= 0) return null;
  const unit = options.unit ?? 'm';
  const margin = options.marginM ?? SHALLOW_MARGIN_M;
  const underKeel = depthM - draughtM;
  const detail = `Modelled depth ${formatDepthWithUnit(depthM, unit)} against a ${formatDepthWithUnit(
    draughtM,
    unit,
  )} draught`;
  if (underKeel <= 0) {
    return {
      id: 'shallow',
      kind: 'shallow',
      level: 'danger',
      title: 'Shallow water',
      detail: `${detail} — no water left under the keel.`,
    };
  }
  if (underKeel < margin) {
    return {
      id: 'shallow',
      kind: 'shallow',
      level: 'caution',
      title: 'Shallow water',
      detail: `${detail} — ${formatDepthWithUnit(underKeel, unit)} under the keel.`,
    };
  }
  return null;
}

/** The fix fields the watch alerts need; a full GeoFix satisfies it. */
export interface FixLike {
  lat: number;
  lon: number;
  heading?: number | null;
  compass?: number | null;
  sog?: number | null;
}

/**
 * The boat has swung outside the circle it was anchored in. Anything beyond
 * twice the circle is a danger: at that point the anchor has certainly broken
 * out rather than the boat swinging on a scope.
 */
export function anchorDriftAlert(
  fix: FixLike | null,
  anchor: AnchorWatch | null,
  options: { now?: number; distanceUnit?: DistanceUnit } = {},
): ChartAlert | null {
  if (!fix || !anchor) return null;
  const distance = distanceMeters(anchor.lat, anchor.lon, fix.lat, fix.lon);
  if (!Number.isFinite(distance) || distance <= anchor.radiusM) return null;
  const unit = options.distanceUnit ?? 'm-nm';
  const outside = distance - anchor.radiusM;
  const age = formatWatchAge((options.now ?? Date.now()) - anchor.droppedAt);
  const since = age === 'just now' ? 'dropped just now' : `dropped ${age} ago`;
  const bearing = Math.round(bearingDegrees(fix.lat, fix.lon, anchor.lat, anchor.lon));
  return {
    id: 'anchor-drift',
    kind: 'anchor',
    level: distance >= anchor.radiusM * 2 ? 'danger' : 'caution',
    title: 'Anchor dragging',
    detail: `${formatDistance(distance, unit)} from the anchor — ${formatDistance(
      outside,
      unit,
    )} outside the ${formatDistance(anchor.radiusM, unit)} circle · bearing ${bearing}° · ${since}`,
  };
}

/** Signed difference, positive to starboard, negative to port. */
function signedBearingGap(from: number, to: number): number {
  const diff = ((((from - to) % 360) + 540) % 360) - 180;
  return diff;
}

/**
 * The heading has wandered off the course to steer. A vessel known to be stopped
 * has no heading worth judging, so the alert stays quiet; an unknown speed is
 * judged on the heading alone, because a device that reports no SOG still knows
 * which way the bow is pointing.
 */
export function offCourseAlert(
  fix: FixLike | null,
  course: CourseWatch | null,
  options: { minSpeedKn?: number } = {},
): ChartAlert | null {
  if (!fix || !course) return null;
  const steering = fix.heading ?? fix.compass ?? null;
  if (steering === null || !Number.isFinite(steering)) return null;
  const sog = fix.sog ?? null;
  if (sog !== null && sog < (options.minSpeedKn ?? 0.5)) return null;
  const signed = signedBearingGap(steering, course.bearingDeg);
  const deviation = Math.abs(signed);
  if (deviation <= course.toleranceDeg) return null;
  const side = signed > 0 ? 'starboard' : 'port';
  return {
    id: 'off-course',
    kind: 'course',
    level: deviation >= course.toleranceDeg * 2 ? 'danger' : 'caution',
    title: 'Off course',
    detail: `Steering ${Math.round(steering)}° against ${Math.round(
      course.bearingDeg,
    )}° — ${Math.round(deviation)}° to ${side}`,
  };
}

export interface TrafficThreat {
  vessel: AisVessel;
  distanceM: number;
  bearing: number;
  closing: boolean;
}

/** Normalise a bearing difference to 0–180°. */
function bearingGap(a: number, b: number): number {
  const diff = Math.abs(((a - b) % 360) + 360) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/**
 * The nearest transmitting vessel inside the proximity radius, with whether its
 * course points at the vessel. A stopped target is still reported: a moored
 * ship is a hazard to a moving boat, not the other way round.
 */
export function nearestTraffic(
  fix: FixLike | null,
  vessels: AisVessel[],
  radiusM: number = PROXIMITY_RADIUS_M,
): TrafficThreat | null {
  if (!fix) return null;
  let best: TrafficThreat | null = null;
  for (const vessel of vessels) {
    const distance = distanceMeters(fix.lat, fix.lon, vessel.lat, vessel.lon);
    if (!Number.isFinite(distance) || distance > radiusM) continue;
    if (best && distance >= best.distanceM) continue;
    const bearing = bearingDegrees(fix.lat, fix.lon, vessel.lat, vessel.lon);
    const moving = vessel.cog !== null && (vessel.sog ?? 0) >= 0.5;
    const closing = moving ? bearingGap(vessel.cog as number, bearing + 180) <= 45 : false;
    best = { vessel, distanceM: distance, bearing, closing };
  }
  return best;
}

export function proximityAlert(
  threat: TrafficThreat | null,
  radiusM: number = PROXIMITY_RADIUS_M,
  options: { distanceUnit?: DistanceUnit } = {},
): ChartAlert | null {
  if (!threat) return null;
  const name = vesselLabel(threat.vessel);
  const speed = threat.vessel.sog !== null ? `${threat.vessel.sog.toFixed(1)} kn` : 'speed unknown';
  const motion = threat.closing ? 'closing' : (threat.vessel.sog ?? 0) < 0.5 ? 'stopped' : 'moving away';
  const level: AlertLevel = threat.distanceM <= Math.min(PROXIMITY_DANGER_M, radiusM / 2) ? 'danger' : 'caution';
  return {
    id: `proximity:${threat.vessel.mmsi}`,
    kind: 'proximity',
    level,
    title: `${name} nearby`,
    detail: `${formatDistance(threat.distanceM, options.distanceUnit)} away, bearing ${Math.round(threat.bearing)}° · ${speed} · ${motion}`,
  };
}

/** Every alert the current fix, traffic, watch and settings justify, worst first. */
export function chartAlerts({
  fix,
  vessels,
  watch,
  depthM,
  draughtM,
  depthUnit,
  distanceUnit,
  shallowEnabled,
  trafficEnabled,
  anchorEnabled,
  courseEnabled,
}: {
  fix: FixLike | null;
  vessels: AisVessel[];
  watch: VoyageWatch;
  depthM: number | null;
  draughtM: number | null;
  depthUnit?: DepthUnit;
  distanceUnit?: DistanceUnit;
  shallowEnabled: boolean;
  trafficEnabled: boolean;
  anchorEnabled: boolean;
  courseEnabled: boolean;
}): ChartAlert[] {
  if (!fix) return [];
  const alerts: ChartAlert[] = [];
  if (shallowEnabled) {
    const shallow = shallowWaterAlert(depthM, draughtM, { unit: depthUnit });
    if (shallow) alerts.push(shallow);
  }
  if (trafficEnabled) {
    const proximity = proximityAlert(nearestTraffic(fix, vessels), PROXIMITY_RADIUS_M, { distanceUnit });
    if (proximity) alerts.push(proximity);
  }
  if (anchorEnabled) {
    const drift = anchorDriftAlert(fix, watch.anchor, { distanceUnit });
    if (drift) alerts.push(drift);
  }
  if (courseEnabled) {
    const offCourse = offCourseAlert(fix, watch.course);
    if (offCourse) alerts.push(offCourse);
  }
  return alerts.sort((a, b) => (a.level === b.level ? 0 : a.level === 'danger' ? -1 : 1));
}
