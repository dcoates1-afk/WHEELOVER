import { bearingDegrees, distanceMeters } from '../../shared/navaid-core.mjs';
import type { AisVessel } from './ais';
import { relativeAge, vesselLabel } from './ais';
import { vesselCountry } from './mmsi';
import {
  convertLength,
  formatDepthWithUnit,
  formatDimension,
  formatDistance,
  lengthUnitLabel,
} from './settings';
import type { DepthUnit, DistanceUnit } from './settings';

/**
 * Presentation for AIS targets.
 *
 * MarineTraffic's chart works because class and status are readable before any
 * text: colour says what the vessel is, the outline says what it is doing. This
 * module owns that mapping so the marker, the hover card, the station list and
 * the detail sheet cannot drift apart.
 */

export type VesselKind =
  | 'cargo'
  | 'tanker'
  | 'passenger'
  | 'highspeed'
  | 'fishing'
  | 'tug'
  | 'pleasure'
  | 'sailing'
  | 'law'
  | 'military'
  | 'other'
  | 'unknown';

export const VESSEL_KIND_LABELS: Record<VesselKind, string> = {
  cargo: 'Cargo',
  tanker: 'Tanker',
  passenger: 'Passenger',
  highspeed: 'High-speed craft',
  fishing: 'Fishing',
  tug: 'Tug / towing',
  pleasure: 'Pleasure craft',
  sailing: 'Sailing',
  law: 'Law enforcement',
  military: 'Military',
  other: 'Other',
  unknown: 'Unknown type',
};

/** Colour reads as class at chart size; the outline carries the status. */
export const VESSEL_KIND_COLOURS: Record<VesselKind, string> = {
  cargo: '#2fa96b',
  tanker: '#e0453f',
  passenger: '#3b82f6',
  highspeed: '#22c4d6',
  fishing: '#e08a2e',
  tug: '#c9772f',
  pleasure: '#a855f7',
  sailing: '#c084fc',
  law: '#64748b',
  military: '#7c8a5a',
  other: '#8fa3ad',
  unknown: '#8fa3ad',
};

const NAV_STATUS_LABELS: Record<number, string> = {
  0: 'Under way using engine',
  1: 'At anchor',
  2: 'Not under command',
  3: 'Restricted manoeuvrability',
  4: 'Constrained by draught',
  5: 'Moored',
  6: 'Aground',
  7: 'Engaged in fishing',
  8: 'Under way sailing',
  9: 'Reserved (high-speed craft)',
  10: 'Reserved (wing in ground)',
  11: 'Towing astern',
  12: 'Pushing ahead',
  13: 'Reserved',
  14: 'AIS-SART / MOB',
  15: 'Undefined',
};

export type VesselMotion = 'underway' | 'anchored' | 'moored' | 'restricted' | 'aground' | 'stopped' | 'unknown';

const UNDERWAY_COLOUR = '#35c46a';
const ANCHORED_COLOUR = '#f4c531';
const MOORED_COLOUR = '#f59e42';
const RESTRICTED_COLOUR = '#ef4444';
const AGROUND_COLOUR = '#ef4444';
const STOPPED_COLOUR = '#8fa3ad';
const UNKNOWN_COLOUR = '#8fa3ad';

const KIND_BY_TYPE_CODE = (code: number): VesselKind => {
  if (code >= 20 && code <= 29) return 'other'; // wing in ground
  if (code === 30) return 'fishing';
  if (code === 31 || code === 32 || code === 52) return 'tug';
  if (code === 35) return 'military';
  if (code === 36) return 'sailing';
  if (code === 37) return 'pleasure';
  if (code >= 40 && code <= 49) return 'highspeed';
  if (code === 55) return 'law';
  if (code >= 60 && code <= 69) return 'passenger';
  if (code >= 70 && code <= 79) return 'cargo';
  if (code >= 80 && code <= 89) return 'tanker';
  if (code >= 90 && code <= 99) return 'other';
  return 'other';
};

/** Type code first; the label is a fallback for feeds that only send a name. */
export function vesselKind(vessel: AisVessel): VesselKind {
  if (vessel.typeCode !== null && vessel.typeCode > 0) return KIND_BY_TYPE_CODE(vessel.typeCode);
  const label = (vessel.shipType ?? '').toLowerCase();
  if (!label) return 'unknown';
  if (label.includes('tanker')) return 'tanker';
  if (label.includes('cargo')) return 'cargo';
  if (label.includes('passenger')) return 'passenger';
  if (label.includes('high-speed')) return 'highspeed';
  if (label.includes('fish')) return 'fishing';
  if (label.includes('tug') || label.includes('tow')) return 'tug';
  if (label.includes('sail')) return 'sailing';
  if (label.includes('pleasure')) return 'pleasure';
  if (label.includes('law')) return 'law';
  if (label.includes('military')) return 'military';
  if (label.includes('unknown') || label.includes('type')) return 'unknown';
  return 'other';
}

export function vesselKindLabel(vessel: AisVessel): string {
  const kind = vesselKind(vessel);
  return kind === 'unknown' && vessel.shipType ? vessel.shipType : VESSEL_KIND_LABELS[kind];
}

export function vesselColour(vessel: AisVessel): string {
  return VESSEL_KIND_COLOURS[vesselKind(vessel)];
}

/** Navigational status as broadcast, with a speed-based fallback. */
export function navStatusLabel(status: number | null, sog: number | null = null): string {
  if (status !== null && status !== 15 && NAV_STATUS_LABELS[status]) return NAV_STATUS_LABELS[status];
  if (status === 15) return 'Undefined';
  if (sog === null) return 'Status not reported';
  return sog >= 0.5 ? 'Under way' : 'Stationary';
}

export function vesselMotion(vessel: AisVessel): VesselMotion {
  switch (vessel.navStatus) {
    case 1:
      return 'anchored';
    case 5:
      return 'moored';
    case 2:
    case 3:
    case 4:
      return 'restricted';
    case 6:
      return 'aground';
    case 0:
    case 7:
    case 8:
    case 11:
    case 12:
      return 'underway';
    default:
      break;
  }
  if (vessel.sog === null) return 'unknown';
  return vessel.sog >= 0.5 ? 'underway' : 'stopped';
}

export function vesselStatusColour(vessel: AisVessel): string {
  switch (vesselMotion(vessel)) {
    case 'underway':
      return UNDERWAY_COLOUR;
    case 'anchored':
      return ANCHORED_COLOUR;
    case 'moored':
      return MOORED_COLOUR;
    case 'restricted':
      return RESTRICTED_COLOUR;
    case 'aground':
      return AGROUND_COLOUR;
    case 'stopped':
      return STOPPED_COLOUR;
    default:
      return UNKNOWN_COLOUR;
  }
}

/** The direction the marker points: course over ground, else heading. */
export function vesselCourse(vessel: AisVessel): number {
  if (vessel.cog !== null) return vessel.cog;
  if (vessel.heading !== null) return vessel.heading;
  return 0;
}

export function vesselIsMoving(vessel: AisVessel): boolean {
  const motion = vesselMotion(vessel);
  return motion === 'underway' || motion === 'restricted';
}

/** Icon size grows with hull length, so a ferry does not look like a dinghy. */
export function vesselIconSize(vessel: AisVessel, zoom: number): number {
  const base = zoom >= 15 ? 30 : zoom >= 12 ? 26 : zoom >= 9 ? 22 : 18;
  const length = vessel.length ?? 0;
  if (length >= 150) return base + 6;
  if (length >= 80) return base + 3;
  return base;
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * Marker silhouette: a hull with a pointed bow when under way, a disc when
 * stopped. The fill is the vessel class, the outline the navigational status.
 */
export function vesselIconSvg(vessel: AisVessel, size: number): string {
  const fill = vesselColour(vessel);
  const stroke = vesselStatusColour(vessel);
  const moving = vesselIsMoving(vessel);
  const hull = moving
    ? '<path d="M16 2.4 L25.4 13.8 L21.6 28.4 L16 25.8 L10.4 28.4 L6.6 13.8 Z" fill="' +
      fill +
      '" stroke="' +
      stroke +
      '" stroke-width="2.1" stroke-linejoin="round"/>' +
      '<path d="M16 8.4 L16 21.4" stroke="rgba(4,20,31,0.45)" stroke-width="1.5" stroke-linecap="round"/>'
    : '<circle cx="16" cy="16" r="8.8" fill="' +
      fill +
      '" stroke="' +
      stroke +
      '" stroke-width="2.2"/>' +
      '<circle cx="16" cy="16" r="2.6" fill="rgba(4,20,31,0.55)"/>';
  return `<svg viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true" focusable="false">${hull}</svg>`;
}

/** Small colour key used by the station list and the detail sheet. */
export function vesselSwatchSvg(vessel: AisVessel, size = 14): string {
  return `<svg viewBox="0 0 16 16" width="${size}" height="${size}" aria-hidden="true" focusable="false">
    <circle cx="8" cy="8" r="6" fill="${vesselColour(vessel)}" stroke="${vesselStatusColour(vessel)}" stroke-width="2"/>
  </svg>`;
}

export function speedLabel(vessel: AisVessel): string {
  return vessel.sog === null ? '—' : `${vessel.sog.toFixed(1)} kn`;
}

export function courseLabel(vessel: AisVessel): string {
  return vessel.cog === null ? '—' : `${String(Math.round(vessel.cog)).padStart(3, '0')}°`;
}

export function headingLabel(vessel: AisVessel): string {
  return vessel.heading === null ? '—' : `${String(Math.round(vessel.heading)).padStart(3, '0')}°`;
}

/** Hull size as figures plus the unit they are written in. */
export function dimensionParts(
  vessel: AisVessel,
  unit: DistanceUnit = 'm-nm',
): { length: string; beam: string; unit: string } {
  return {
    length: vessel.length === null ? '—' : formatDimension(convertLength(vessel.length, unit)),
    beam: vessel.beam === null ? '—' : formatDimension(convertLength(vessel.beam, unit)),
    unit: lengthUnitLabel(unit),
  };
}

/**
 * Hull size in the length unit of the chosen distance pair, so a target reads
 * in the same units as the boat beside it.
 */
export function dimensionsLabel(vessel: AisVessel, unit: DistanceUnit = 'm-nm'): string | null {
  if (vessel.length === null && vessel.beam === null) return null;
  const size = dimensionParts(vessel, unit);
  return `${size.length} ${size.unit} × ${size.beam} ${size.unit}`;
}

/** Reported maximum draught in the chosen depth unit. */
export function draughtLabel(vessel: AisVessel, unit: DepthUnit = 'm'): string | null {
  return vessel.draught === null ? null : formatDepthWithUnit(vessel.draught, unit);
}

/**
 * One label/value line of the hover card. A value the transponder has not sent
 * is written as a dash placeholder rather than dropped, so the card keeps its
 * shape from target to target and a missing field is visible as missing.
 */
function tipRow(label: string, value: string | null): string {
  return value === null
    ? `<div class="vessel-tip-row"><dt>${escapeHtml(label)}</dt><dd class="missing">---</dd></div>`
    : `<div class="vessel-tip-row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

/** A titled block of label/value rows, the way a tracking card groups them. */
function tipBlock(title: string, rows: string[]): string {
  return `<div class="vessel-tip-block">
      <p class="vessel-tip-block-title">${escapeHtml(title)}</p>
      <dl class="vessel-tip-rows">${rows.join('')}</dl>
    </div>`;
}

/**
 * Chart label for the picked target: its name, the course it is steering and,
 * when this device has a fix, how far off it is and on what bearing. Sits
 * beside the ring so the vessel stays identifiable — and its range readable —
 * with the sheet closed. The name is escaped: it arrives as untrusted radio
 * text.
 */
export function selectedVesselLabelHtml(
  vessel: AisVessel,
  from: { lat: number; lon: number } | null = null,
  distanceUnit: DistanceUnit = 'm-nm',
): string {
  const course =
    vessel.cog === null ? 'COG —' : `COG ${String(Math.round(vessel.cog)).padStart(3, '0')}°`;
  // Without a fix there is nothing to measure from, so the range line is left
  // out rather than filled with a guess.
  const range = from
    ? `<span class="ais-label-range">${escapeHtml(
        `${formatDistance(
          distanceMeters(from.lat, from.lon, vessel.lat, vessel.lon),
          distanceUnit,
        )} · brg ${String(
          Math.round(bearingDegrees(from.lat, from.lon, vessel.lat, vessel.lon)) % 360,
        ).padStart(3, '0')}°`,
      )}</span>`
    : '';
  return `<span class="ais-label-name">${escapeHtml(vesselLabel(vessel))}</span><span class="ais-label-course">${escapeHtml(course)}</span>${range}`;
}

/**
 * Hover card: the vessel card a tracking site puts over a target, in this
 * chart's own dark styling. Name, type and flag identify the target, then the
 * particulars, then the reported voyage and the position it was heard at.
 *
 * The field names and their order follow the tracking cards navigators already
 * read (type, IMO, MMSI, call sign, size, draught, status, speed, course,
 * destination, ETA, received), and unreported values print as `---`. Every
 * value is escaped because an AIS name is untrusted text arriving off a radio
 * network.
 */
export function vesselTooltipHtml(
  vessel: AisVessel,
  now = Date.now(),
  distanceUnit: DistanceUnit = 'm-nm',
  depthUnit: DepthUnit = 'm',
): string {
  const kind = vesselKindLabel(vessel);
  const status = navStatusLabel(vessel.navStatus, vessel.sog);
  const name = escapeHtml(vesselLabel(vessel));
  const swatch = vesselSwatchSvg(vessel, 13);
  const transponder = vessel.transponder ? `Class ${vessel.transponder}` : null;
  const { country, iso2 } = vesselCountry(vessel);
  const flagLine = country
    ? `<p class="vessel-tip-flag">${iso2 ? `<span class="vessel-flagcode">${escapeHtml(iso2)}</span>` : ''}${escapeHtml(country)}</p>`
    : '';
  const particulars = [
    // The type and report class sit under the name, as they do on a tracking
    // card, so the table starts with the identifiers.
    tipRow('IMO', vessel.imo === null ? null : String(vessel.imo)),
    tipRow('MMSI', String(vessel.mmsi)),
    tipRow('Call sign', vessel.callSign),
    // Size and draught follow the Distance and Depth settings, so a target
    // reads in the same units as the boat beside it.
    tipRow('Size (L × B)', dimensionsLabel(vessel, distanceUnit)),
    tipRow('Draught', draughtLabel(vessel, depthUnit)),
    tipRow('Status', status),
  ];
  const passage = [
    tipRow('Speed', vessel.sog === null ? null : `${vessel.sog.toFixed(1)} kn`),
    tipRow('Course', vessel.cog === null ? null : `${Math.round(vessel.cog)}°`),
    tipRow('Destination', vessel.destination),
    tipRow('ETA', vessel.eta),
    tipRow('Received', relativeAge(vessel.lastSeen, now)),
  ];
  const foot = [
    vessel.simulated ? 'Simulated traffic' : 'AISStream live feed',
    vessel.name ? null : 'no static report yet',
  ]
    .filter(Boolean)
    .join(' · ');
  return `<div class="vessel-tip-card">
    <p class="vessel-tip-eyebrow">Vessel details</p>
    <p class="vessel-tip-head">${swatch}<strong>${name}</strong></p>
    <p class="vessel-tip-kind">${escapeHtml(transponder ? `${kind} · ${transponder}` : kind)}</p>
    ${flagLine}
    ${tipBlock('Particulars', particulars)}
    ${tipBlock('Voyage and position', passage)}
    <p class="vessel-tip-foot">${escapeHtml(foot)}</p>
    <p class="vessel-tip-hint">Click the target for its full vessel record</p>
  </div>`;
}
