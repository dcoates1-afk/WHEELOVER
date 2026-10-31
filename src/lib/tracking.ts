import { bearingDegrees, distanceMeters } from '../../shared/navaid-core.mjs';
import { relativeAge } from './ais';
import type { AisVessel } from './ais';
import {
  courseLabel,
  dimensionsLabel,
  draughtLabel,
  headingLabel,
  navStatusLabel,
  speedLabel,
  vesselKindLabel,
} from './aisVessel';
import { formatCoordinate } from './coordinates';
import { vesselCountry } from './mmsi';
import { formatDistance } from './settings';
import type { CoordinateFormat, DepthUnit, DistanceUnit } from './settings';

/**
 * The AIS reference turned into pages.
 *
 * A tracking card is read in two passes: what the target is doing right now,
 * then what it is and where it says it is going. These three pages keep that
 * order, and every field is built here rather than in the component so the
 * units, the age of a report and the "not reported" cases stay in one place.
 */
export type TrackingPage = 'overview' | 'particulars' | 'voyage';

export const TRACKING_PAGES: { id: TrackingPage; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'particulars', label: 'Particulars' },
  { id: 'voyage', label: 'Voyage' },
];

export interface TrackingField {
  label: string;
  /** Null when the transponder has not sent this yet; the page says so. */
  value: string | null;
}

export interface TrackingContext {
  /** Chart centre the range and bearing are measured from. */
  centre: [number, number];
  distanceUnit?: DistanceUnit;
  depthUnit?: DepthUnit;
  coordinateFormat?: CoordinateFormat;
  /** Report age is measured against this, so a test can pin the clock. */
  now?: number;
}

function bearingText(from: [number, number], to: [number, number]): string {
  const bearing = Math.round(bearingDegrees(from[0], from[1], to[0], to[1]));
  return `${String(bearing % 360).padStart(3, '0')}°`;
}

function flagText(vessel: AisVessel): string | null {
  const { iso2, country } = vesselCountry(vessel);
  if (!iso2 && !country) return null;
  return [iso2, country].filter(Boolean).join(' · ');
}

function typeText(vessel: AisVessel): string {
  const kind = vesselKindLabel(vessel);
  if (!vessel.shipType) return kind;
  return vessel.shipType === kind ? kind : `${vessel.shipType} · ${kind}`;
}

/** Fields for one page of the tracking card, in reading order. */
export function trackingFields(
  page: TrackingPage,
  vessel: AisVessel,
  context: TrackingContext,
): TrackingField[] {
  const { centre, distanceUnit, depthUnit, coordinateFormat = 'latlon', now = Date.now() } = context;
  const rangeM = distanceMeters(centre[0], centre[1], vessel.lat, vessel.lon);
  const range = `${formatDistance(rangeM, distanceUnit)} · bearing ${bearingText(centre, [vessel.lat, vessel.lon])}`;
  const source = vessel.simulated ? 'Simulated traffic' : 'AISStream live feed';

  if (page === 'overview') {
    return [
      { label: 'Status', value: navStatusLabel(vessel.navStatus, vessel.sog) },
      { label: 'Speed over ground', value: speedLabel(vessel) },
      { label: 'Course over ground', value: courseLabel(vessel) },
      { label: 'Heading', value: headingLabel(vessel) },
      { label: 'Position', value: formatCoordinate(vessel.lat, vessel.lon, coordinateFormat) },
      { label: 'From chart centre', value: range },
      { label: 'Position report', value: relativeAge(vessel.lastSeen, now) },
      { label: 'AIS source', value: source },
    ];
  }

  if (page === 'particulars') {
    return [
      { label: 'Type', value: typeText(vessel) },
      { label: 'MMSI', value: String(vessel.mmsi) },
      { label: 'IMO', value: vessel.imo === null ? null : String(vessel.imo) },
      { label: 'Call sign', value: vessel.callSign },
      { label: 'Flag', value: flagText(vessel) },
      { label: 'Size (L × B)', value: dimensionsLabel(vessel, distanceUnit) },
      { label: 'Draught', value: draughtLabel(vessel, depthUnit) },
      { label: 'Transponder', value: vessel.transponder ? `Class ${vessel.transponder}` : null },
      { label: 'Static report', value: vessel.staticAt === null ? null : relativeAge(vessel.staticAt, now) },
      { label: 'AIS source', value: source },
    ];
  }

  return [
    { label: 'Destination', value: vessel.destination },
    { label: 'ETA (reported)', value: vessel.eta },
    { label: 'Status', value: navStatusLabel(vessel.navStatus, vessel.sog) },
    { label: 'Speed over ground', value: speedLabel(vessel) },
    { label: 'Course over ground', value: courseLabel(vessel) },
    { label: 'Reported draught', value: draughtLabel(vessel, depthUnit) },
    { label: 'Range from chart centre', value: formatDistance(rangeM, distanceUnit) },
    { label: 'Position report', value: relativeAge(vessel.lastSeen, now) },
  ];
}

/** Targets nearest the chart centre first, for the picker. */
export function trackingTargets(
  vessels: AisVessel[],
  centre: [number, number],
  limit = 40,
): { vessel: AisVessel; metres: number }[] {
  return vessels
    .map((vessel) => ({
      vessel,
      metres: distanceMeters(centre[0], centre[1], vessel.lat, vessel.lon),
    }))
    .sort((a, b) => a.metres - b.metres)
    .slice(0, limit);
}

/** Name shown at the head of the card, falling back to the MMSI. */
export function trackingTitle(vessel: AisVessel): string {
  return vessel.name ?? `MMSI ${vessel.mmsi}`;
}

/** One-line identity under the title, in the order the chart reads it. */
export function trackingSubtitle(vessel: AisVessel): string {
  const kind = vesselKindLabel(vessel);
  const status = navStatusLabel(vessel.navStatus, vessel.sog);
  const parts = [kind, status];
  if (vessel.transponder) parts.push(`Class ${vessel.transponder}`);
  return parts.join(' · ');
}
