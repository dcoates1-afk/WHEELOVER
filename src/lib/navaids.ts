import {
  CATEGORY_LABELS as RAW_CATEGORY_LABELS,
  annotateTransits as RAW_ANNOTATE_TRANSITS,
  ialaRegion,
  priorityFor,
  selectVisibleNavaids,
} from '../../shared/navaid-core.mjs';
import type { Navaid, NavaidCategory } from './navaidTypes';

export type { Navaid, NavaidCategory } from './navaidTypes';

export const CATEGORY_LABELS = RAW_CATEGORY_LABELS as Record<NavaidCategory, string>;
// The shared .mjs is typed by navaid-core.d.ts, which TypeScript does not pair
// with a .mjs module here, so the transit annotation is given its real signature.
export const annotateTransits = RAW_ANNOTATE_TRANSITS as (items: Navaid[]) => Navaid[];
export { ialaRegion, selectVisibleNavaids };

export interface SymbolSpec {
  svg: string;
  label: string;
}

const RED = '#e23b3b';
const GREEN = '#26a65b';
const YELLOW = '#f4c531';
const BLACK = '#101820';
const WHITE = '#f4f7f8';
const LIGHT_MAJOR = '#ff43d0';
const LIGHT_MINOR = '#d9a6ff';
const BLUE = '#2f7fd0';

function lateralColours(side: 'port' | 'starboard', region: 'A' | 'B') {
  if (region === 'B') {
    return side === 'port' ? { main: GREEN, band: RED } : { main: RED, band: GREEN };
  }
  return side === 'port' ? { main: RED, band: GREEN } : { main: GREEN, band: RED };
}

function svgWrap(inner: string): string {
  return `<svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true" focusable="false">${inner}</svg>`;
}

function outline(shape: string, fill: string, stroke = '#04141f') {
  return `<g stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round">${shape.replace('{fill}', fill)}</g>`;
}

function can(fill: string) {
  return outline('<rect x="8" y="8" width="16" height="18" rx="3" fill="{fill}"/>', fill);
}

function cone(fill: string) {
  return outline('<path d="M16 6 L25 26 H7 Z" fill="{fill}"/>', fill);
}

function sphere(fill: string, band?: string) {
  const base = outline('<circle cx="16" cy="17" r="9.5" fill="{fill}"/>', fill);
  if (!band) return base;
  return `${base}<rect x="7" y="14" width="18" height="5" fill="${band}" stroke="#04141f" stroke-width="1.2"/>`;
}

/**
 * Bifurcation (preferred-channel) marks are a can or a cone divided by a broad
 * white band. They used to be drawn as a sphere, which is the safe-water mark
 * and made the two impossible to tell apart on the chart.
 */
function bifurcation(shape: 'can' | 'cone', main: string) {
  if (shape === 'can') {
    return `${outline('<rect x="8" y="8" width="16" height="18" rx="3" fill="{fill}"/>', main)}
      <rect x="8" y="13.5" width="16" height="5" fill="${WHITE}" stroke="#04141f" stroke-width="1.4"/>`;
  }
  return `${outline('<path d="M16 6 L25 26 H7 Z" fill="{fill}"/>', main)}
    <path d="M12.6 13.5 L19.4 13.5 L21.6 18.5 L10.4 18.5 Z" fill="${WHITE}" stroke="#04141f" stroke-width="1.4" stroke-linejoin="round"/>`;
}

/**
 * Anchorage: a magenta dashed ground with an anchor, following the chart
 * convention for an anchorage area rather than another buoy-like disc.
 */
function anchorageSvg() {
  const anchor =
    'M16 10.5 V21.5 M12.5 13.5 H19.5 M11 19 A5 5 0 0 0 21 19';
  return `<circle cx="16" cy="16" r="11" fill="rgba(255, 67, 208, 0.14)" stroke="${LIGHT_MAJOR}" stroke-width="1.3" stroke-dasharray="3 2"/>
    <circle cx="16" cy="10.4" r="1.5" fill="none" stroke="#04141f" stroke-width="3.4"/>
    <circle cx="16" cy="10.4" r="1.5" fill="none" stroke="${LIGHT_MAJOR}" stroke-width="1.6"/>
    <path d="${anchor}" fill="none" stroke="#04141f" stroke-width="3.6" stroke-linecap="round"/>
    <path d="${anchor}" fill="none" stroke="${LIGHT_MAJOR}" stroke-width="1.8" stroke-linecap="round"/>`;
}

/**
 * Anchor berth: the anchorage anchor inside a dashed square. The square frame
 * separates a designated berth (usually a tanker berth) from a general
 * anchorage ground, so the two cannot be confused at chart size.
 */
function anchorBerthSvg() {
  const anchor = 'M16 11.5 V22 M12.8 14.5 H19.2 M11.2 19.5 A5 5 0 0 0 20.8 19.5';
  return `<rect x="4.5" y="4.5" width="23" height="23" rx="3" fill="rgba(255, 67, 208, 0.10)" stroke="${LIGHT_MAJOR}" stroke-width="1.3" stroke-dasharray="4 2.5"/>
    <circle cx="16" cy="11.4" r="1.4" fill="none" stroke="#04141f" stroke-width="3.2"/>
    <circle cx="16" cy="11.4" r="1.4" fill="none" stroke="${LIGHT_MAJOR}" stroke-width="1.5"/>
    <path d="${anchor}" fill="none" stroke="#04141f" stroke-width="3.4" stroke-linecap="round"/>
    <path d="${anchor}" fill="none" stroke="${LIGHT_MAJOR}" stroke-width="1.7" stroke-linecap="round"/>`;
}

/**
 * Calling-in point: a VHF handset with radio waves. Canadian Coast Guard
 * calling-in points are reporting lines over the radio, not seamarks, so a
 * radio silhouette reads correctly and cannot be mistaken for a buoy.
 */
function callingInSvg() {
  return `<rect x="7.5" y="13" width="13" height="12" rx="3" fill="#3dd6ff" stroke="#04141f" stroke-width="1.6"/>
    <rect x="10.5" y="16.5" width="7" height="3.5" rx="1" fill="#04141f"/>
    <path d="M9.5 13 V8.5" stroke="#04141f" stroke-width="2.2" stroke-linecap="round"/>
    <circle cx="20.5" cy="19.5" r="1.3" fill="#04141f"/>
    <path d="M23 8 A6.5 6.5 0 0 1 23 16.5" fill="none" stroke="#3dd6ff" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M26 5.2 A10 10 0 0 1 26 19.3" fill="none" stroke="#3dd6ff" stroke-width="1.3" stroke-linecap="round" opacity="0.68"/>`;
}

/**
 * Wreck: a hull listing and half under the waterline, with uneven broken
 * timbers standing out of it and a gash in the side. The silhouette says
 * "wrecked boat" rather than "boat", and shares nothing with the hazard sphere
 * or the dangerous-wreck cross.
 */
function wreckSvg() {
  return `<path d="M2.8 25 Q6.5 23.7 10 25 T17 25 T24 25 T29.2 25" fill="none" stroke="${WHITE}" stroke-width="1.6" stroke-linecap="round" opacity="0.9"/>
    <path d="M4.2 21.6 C8.4 25.6 20.4 22.8 27.4 18.2 L25.4 24.6 C18 28.4 9.4 27.4 4.2 21.6 Z" fill="#8fa3ad" stroke="#04141f" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M21.4 20.4 L22.2 24.2 L19.4 23.6 Z" fill="#8fa3ad" stroke="#04141f" stroke-width="1.2" stroke-linejoin="round"/>
    <path d="M7.6 22 L6.8 15.8 M11.6 21.2 L11.8 13.2 M15.6 20.2 L15 11.6 M19.6 18.6 L20.6 14.4" stroke="#04141f" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M15 11.6 L10.6 12.4" stroke="#04141f" stroke-width="1.4" stroke-linecap="round"/>
    <path d="M6.8 15.8 L3.9 16.2" stroke="#04141f" stroke-width="1.4" stroke-linecap="round"/>
    <path d="M6.2 22.6 C11.4 25.4 19.6 23.8 24.9 20.4" fill="none" stroke="${RED}" stroke-width="1.5"/>`;
}

/**
 * Transit (leading) marks: the two lights that define a leading line, drawn as
 * two dots on a dashed sight line. The filled dot is this mark's end of the
 * transit — lower/front or higher/rear — so a pair of range lights is told
 * apart at a glance instead of both reading as minor lights.
 */
function transitSvg(role: 'front' | 'rear') {
  const dot = (cy: number, filled: boolean, radius: number) =>
    filled
      ? `<circle cx="16" cy="${cy}" r="${radius}" fill="${LIGHT_MAJOR}" stroke="#04141f" stroke-width="1.8"/>`
      : `<circle cx="16" cy="${cy}" r="${radius}" fill="none" stroke="#04141f" stroke-width="3.2"/>` +
        `<circle cx="16" cy="${cy}" r="${radius}" fill="none" stroke="${WHITE}" stroke-width="1.5"/>`;
  return `<line x1="16" y1="3.5" x2="16" y2="28.5" stroke="#04141f" stroke-width="1.3" stroke-dasharray="2 2.6" opacity="0.85"/>
    ${dot(9.5, role === 'rear', 3.4)}
    ${dot(21.5, role === 'front', 3.9)}`;
}

function diamond(fill: string) {
  return outline('<path d="M16 5 L26 16 L16 27 L6 16 Z" fill="{fill}"/>', fill);
}

function cardinalSvg(kind: 'north' | 'east' | 'south' | 'west') {
  // Two stacked triangles: the classic black/yellow quadrant topmark.
  const top = kind === 'north' || kind === 'west' ? BLACK : YELLOW;
  const bottom = kind === 'north' || kind === 'east' ? YELLOW : BLACK;
  const bands =
    kind === 'east'
      ? `<rect x="7" y="12" width="18" height="5" fill="${BLACK}"/>`
      : kind === 'west'
        ? `<rect x="7" y="19" width="18" height="5" fill="${BLACK}"/>`
        : kind === 'south'
          ? `<rect x="7" y="8" width="18" height="6" fill="${YELLOW}"/>`
          : '';
  return `${outline('<rect x="8" y="8" width="16" height="18" rx="3" fill="{fill}"/>', top)}${bands}
    <path d="M16 3 L21 9 H11 Z" fill="${top}" stroke="#04141f" stroke-width="1.2"/>
    <path d="M16 13 L21 19 H11 Z" fill="${bottom}" stroke="#04141f" stroke-width="1.2"/>`;
}

/**
 * Major lights: a saturated magenta flare star with a white core. Distinct from
 * minor lights in silhouette, colour and size, so the two never read alike on a
 * small chart display.
 */
function majorLightSvg() {
  const rays = [0, 45, 90, 135, 180, 225, 270, 315]
    .map((deg) => {
      const rad = (deg * Math.PI) / 180;
      const x1 = 16 - 5 * Math.cos(rad);
      const y1 = 16 - 5 * Math.sin(rad);
      const x2 = 16 + 14 * Math.cos(rad);
      const y2 = 16 + 14 * Math.sin(rad);
      return `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${LIGHT_MAJOR}" stroke-width="2.2" stroke-linecap="round"/>`;
    })
    .join('');
  return `${rays}<circle cx="16" cy="16" r="6.6" fill="${LIGHT_MAJOR}" stroke="${WHITE}" stroke-width="1.3"/><circle cx="16" cy="16" r="2.4" fill="${WHITE}"/>`;
}

/**
 * Minor lights: a soft violet dot with four short flare stubs. The silhouette
 * differs from the major 8-ray star, and the stubs keep it from reading as a
 * hazard ball at chart size.
 */
function minorLightSvg() {
  const stubs = [0, 90, 180, 270]
    .map((deg) => {
      const rad = (deg * Math.PI) / 180;
      const x1 = 16 + 6.4 * Math.cos(rad);
      const y1 = 16 + 6.4 * Math.sin(rad);
      const x2 = 16 + 10.5 * Math.cos(rad);
      const y2 = 16 + 10.5 * Math.sin(rad);
      return `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${LIGHT_MINOR}" stroke-width="1.5" stroke-linecap="round"/>`;
    })
    .join('');
  return `${stubs}<circle cx="16" cy="16" r="9.4" fill="none" stroke="${LIGHT_MINOR}" stroke-width="1.2" opacity="0.55"/>` +
    `<circle cx="16" cy="16" r="5" fill="${LIGHT_MINOR}" stroke="#04141f" stroke-width="1.5"/>` +
    `<circle cx="16" cy="16" r="1.8" fill="#ffffff"/>`;
}

export function symbolFor(category: NavaidCategory, region: 'A' | 'B'): SymbolSpec {
  const label = CATEGORY_LABELS[category] ?? 'Mark';
  switch (category) {
    case 'lateral_port':
      return { svg: svgWrap(can(lateralColours('port', region).main)), label };
    case 'lateral_starboard':
      return { svg: svgWrap(cone(lateralColours('starboard', region).main)), label };
    case 'preferred_channel_port':
      return { svg: svgWrap(bifurcation('can', lateralColours('port', region).main)), label };
    case 'preferred_channel_starboard':
      return { svg: svgWrap(bifurcation('cone', lateralColours('starboard', region).main)), label };
    case 'lateral_other':
      return { svg: svgWrap(can('#8fa3ad')), label };
    case 'cardinal_north':
      return { svg: svgWrap(cardinalSvg('north')), label };
    case 'cardinal_east':
      return { svg: svgWrap(cardinalSvg('east')), label };
    case 'cardinal_south':
      return { svg: svgWrap(cardinalSvg('south')), label };
    case 'cardinal_west':
      return { svg: svgWrap(cardinalSvg('west')), label };
    case 'safe_water':
      return { svg: svgWrap(sphere(WHITE, RED)), label };
    case 'isolated_danger':
      return { svg: svgWrap(sphere(BLACK, RED)), label };
    case 'special_purpose':
      return { svg: svgWrap(diamond(YELLOW)), label };
    case 'range':
      return {
        svg: svgWrap(
          `${outline('<rect x="9" y="4" width="14" height="24" rx="2" fill="{fill}"/>', '#123')}
           <path d="M16 7 L21 13 H11 Z" fill="${WHITE}" stroke="#04141f" stroke-width="1.2"/>
           <path d="M16 25 L21 19 H11 Z" fill="${WHITE}" stroke="#04141f" stroke-width="1.2"/>`,
        ),
        label,
      };
    case 'transit_front':
      return { svg: svgWrap(transitSvg('front')), label };
    case 'transit_rear':
      return { svg: svgWrap(transitSvg('rear')), label };
    case 'major_light':
      return { svg: svgWrap(majorLightSvg()), label };
    case 'light':
      return { svg: svgWrap(minorLightSvg()), label };
    case 'wreck':
      return { svg: svgWrap(wreckSvg()), label };
    case 'hazard':
      return { svg: svgWrap(sphere(WHITE, BLACK)), label };
    case 'hazard_danger':
      return {
        svg: svgWrap(
          `${outline('<circle cx="16" cy="16" r="10" fill="{fill}"/>', '#3b2a2a')}
           <path d="M11 11 L21 21 M21 11 L11 21" stroke="${RED}" stroke-width="3"/>`,
        ),
        label,
      };
    case 'landmark':
      return {
        svg: svgWrap(
          `${outline('<path d="M10 26 V11 L16 5 L22 11 V26 Z" fill="{fill}"/>', '#4a5b66')}
           <rect x="14" y="17" width="4" height="9" fill="${WHITE}"/>`,
        ),
        label,
      };
    case 'marina':
      return {
        svg: svgWrap(
          `${outline('<circle cx="16" cy="16" r="10" fill="{fill}"/>', BLUE)}
           <path d="M16 9 V22 M11 18 A5 5 0 0 0 21 18" stroke="${WHITE}" stroke-width="2" fill="none"/>`,
        ),
        label,
      };
    case 'facility':
      return { svg: svgWrap(outline('<rect x="8" y="8" width="16" height="16" rx="8" fill="{fill}"/>', '#35657a')), label };
    case 'mooring':
      return { svg: svgWrap(outline('<circle cx="16" cy="16" r="6" fill="{fill}"/>', YELLOW)), label };
    case 'anchorage':
      return { svg: svgWrap(anchorageSvg()), label };
    case 'anchor_berth':
      return { svg: svgWrap(anchorBerthSvg()), label };
    case 'calling_in_point':
      return { svg: svgWrap(callingInSvg()), label };
    case 'communication_area':
      return {
        svg: svgWrap(`<path d="M5 10 L11 5 L22 7 L27 14 L23 24 L11 27 L5 20 Z" fill="rgba(61,214,255,.18)" stroke="#3dd6ff" stroke-width="2" stroke-dasharray="3 2"/><path d="M10 16 Q16 9 22 16 M12 19 Q16 15 20 19" fill="none" stroke="#f4f7f8" stroke-width="1.7" stroke-linecap="round"/><circle cx="16" cy="22" r="1.4" fill="#f4f7f8"/>`),
        label,
      };
    case 'notice':
      return { svg: svgWrap(outline('<rect x="9" y="6" width="14" height="20" rx="2" fill="{fill}"/>', '#c9a227')), label };
    case 'gate':
      return {
        svg: svgWrap(
          `<path d="M6 10 L26 10 M6 22 L26 22" stroke="${WHITE}" stroke-width="2"/>
           <path d="M6 10 L16 22 L26 10" stroke="#1d4b63" stroke-width="2" fill="none"/>`,
        ),
        label,
      };
    default:
      return { svg: svgWrap(outline('<circle cx="16" cy="16" r="6" fill="{fill}"/>', '#7d8f99')), label };
  }
}

export function quickInfo(navaid: Navaid, region: 'A' | 'B'): string {
  const label = CATEGORY_LABELS[navaid.category] ?? 'Mark';
  const parts = [label];
  if (navaid.name) parts.push(navaid.name);
  if (navaid.transitBearing !== null && navaid.transitDistanceM !== null) {
    parts.push(`lines up ${String(navaid.transitBearing).padStart(3, '0')}°`);
  }
  if (navaid.channel) parts.push(`VHF Ch ${navaid.channel}`);
  if (navaid.callsign) parts.push(`Call ${navaid.callsign}`);
  if (navaid.light) parts.push(navaid.light);
  else if (navaid.colour) parts.push(navaid.colour);
  parts.push(ialaRegion(navaid.lat, navaid.lon) === region ? 'Tap for full reference' : 'Tap for full reference');
  return parts.join(' · ');
}

export function formatPosition(lat: number, lon: number): string {
  const format = (value: number, positive: string, negative: string) => {
    const hemisphere = value >= 0 ? positive : negative;
    const absolute = Math.abs(value);
    const degrees = Math.floor(absolute);
    const minutes = (absolute - degrees) * 60;
    return `${degrees}° ${minutes.toFixed(3).padStart(6, '0')}′ ${hemisphere}`;
  };
  return `${format(lat, 'N', 'S')}  ${format(lon, 'E', 'W')}`;
}

export function priorityLabel(category: NavaidCategory): number {
  return priorityFor(category) as number;
}
