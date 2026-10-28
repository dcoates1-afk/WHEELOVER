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

function can(fill: string, top = fill) {
  // Chart-style can buoy: square-sided body, narrow neck and small top bar.
  return `<path d="M16 3 V8" stroke="#04141f" stroke-width="2" stroke-linecap="round"/>
    ${outline('<path d="M12 8 H20 V11 H23 V25 H9 V11 H12 Z" fill="{fill}"/>', fill)}
    <rect x="12" y="6" width="8" height="4" rx="1" fill="${top}" stroke="#04141f" stroke-width="1.1"/>
    <path d="M9 18 H23" stroke="#04141f" stroke-width="1.2" opacity=".65"/>`;
}

function cone(fill: string, top = fill) {
  // Chart-style nun buoy: pointed body with a short neck and cap.
  return `<path d="M16 3 V7" stroke="#04141f" stroke-width="2" stroke-linecap="round"/>
    ${outline('<path d="M12 7 H20 L23 11 L18 25 H14 L9 11 Z" fill="{fill}"/>', fill)}
    <path d="M12 7 L16 3 L20 7 Z" fill="${top}" stroke="#04141f" stroke-width="1.1" stroke-linejoin="round"/>
    <path d="M9.7 13 H22.3" stroke="#04141f" stroke-width="1.2" opacity=".65"/>`;
}

function sphere(fill: string, band?: string) {
  const base = outline('<circle cx="16" cy="17.5" r="8.5" fill="{fill}"/>', fill);
  if (!band) return base;
  // Safe-water balls use vertical red/white stripes. Other banded marks use
  // horizontal black/red or black/white bands to keep their chart meanings apart.
  const stripe = fill === WHITE && band === RED
    ? `<path d="M10.3 12.2 Q11.4 10.2 13 9.7 V25.3 Q11.4 24.8 10.3 22.8 Z M19 9.7 Q20.6 10.2 21.7 12.2 V22.8 Q20.6 24.8 19 25.3 Z" fill="${band}" stroke="#04141f" stroke-width=".7"/>
       <path d="M13 9.7 Q16 8.4 19 9.7 V25.3 Q16 26.6 13 25.3 Z" fill="${band}" stroke="#04141f" stroke-width=".7"/>`
    : `<path d="M8.2 15 H23.8 V19.5 H8.2 Z" fill="${band}" stroke="#04141f" stroke-width=".8"/>`;
  return `${base}${stripe}`;
}

/**
 * Bifurcation (preferred-channel) marks are a can or a cone divided by a broad
 * white band. They used to be drawn as a sphere, which is the safe-water mark
 * and made the two impossible to tell apart on the chart.
 */
function bifurcation(shape: 'can' | 'cone', main: string, top: string) {
  const body = shape === 'can' ? can(main, top) : cone(main, top);
  return `${body}<path d="M9 18 H23" stroke="${WHITE}" stroke-width="4.5"/>
    <path d="M9 18 H23" stroke="#04141f" stroke-width=".9"/>`;
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
 * Calling-in point: a chart-style plotted point with a radio-wave cue. Keep
 * the radio indication around the actual location rather than drawing a
 * pictorial handheld device.
 */
function callingInSvg() {
  return `<circle cx="16" cy="19" r="7.2" fill="rgba(61,214,255,.14)" stroke="#04141f" stroke-width="2.4"/>
    <circle cx="16" cy="19" r="7.2" fill="none" stroke="#3dd6ff" stroke-width="1.4"/>
    <circle cx="16" cy="19" r="2.2" fill="${WHITE}" stroke="#04141f" stroke-width="1.1"/>
    <path d="M12 10.5 A5.4 5.4 0 0 1 20 10.5" fill="none" stroke="#04141f" stroke-width="3.2" stroke-linecap="round"/>
    <path d="M12 10.5 A5.4 5.4 0 0 1 20 10.5" fill="none" stroke="#3dd6ff" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M9.5 7 A9 9 0 0 1 22.5 7" fill="none" stroke="#3dd6ff" stroke-width="1.4" stroke-linecap="round"/>`;
}

/**
 * Wreck: a hull listing and half under the waterline, with uneven broken
 * timbers standing out of it and a gash in the side. The silhouette says
 * "wrecked boat" rather than "boat", and shares nothing with the hazard sphere
 * or the dangerous-wreck cross.
 */
function wreckSvg(enclosed = false) {
  // Nautical-chart wreck/fishbone: a central wreck spine with broken ribs.
  // The dashed circle denotes the separately classified dangerous wreck.
  const fishbone = `<g fill="none" stroke="#04141f" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M7 16 H25 M9 13 L12 19 M14 12 L17 20 M19 13 L22 19 M7 14 L5 16 L7 18 M25 14 L27 16 L25 18"/>
    </g>
    <g fill="none" stroke="${WHITE}" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round">
      <path d="M7 16 H25 M9 13 L12 19 M14 12 L17 20 M19 13 L22 19 M7 14 L5 16 L7 18 M25 14 L27 16 L25 18"/>
    </g>`;
  return enclosed
    ? `<circle cx="16" cy="16" r="14" fill="rgba(244,247,248,.12)" stroke="#04141f" stroke-width="2" stroke-dasharray="2 2"/>${fishbone}`
    : fishbone;
}

/**
 * Transit (leading) marks use a single light symbol at each mapped position.
 * The line joining the front and rear coordinates is drawn on the map.
 */
function transitSvg() {
  return majorLightSvg();
}

function diamond(fill: string) {
  return outline('<path d="M16 5 L26 16 L16 27 L6 16 Z" fill="{fill}"/>', fill);
}

function cardinalSvg(kind: 'north' | 'east' | 'south' | 'west') {
  // IALA cardinal topmarks and body bands: north = points up, east = bases
  // together, south = points down, west = points together.
  const topmark = {
    north: '<path d="M11 9 L16 2.5 L21 9 Z M11 14 L16 8.5 L21 14 Z"/>',
    east: '<path d="M11 7 L16 2.5 L21 7 Z M11 9.5 L21 9.5 L16 14 Z"/>',
    south: '<path d="M11 3 L16 8.5 L21 3 Z M11 8.5 L16 14 L21 8.5 Z"/>',
    west: '<path d="M11 2.5 L21 2.5 L16 7 Z M11 14 L16 9.5 L21 14 Z"/>',
  }[kind];
  const bands = {
    north: `<rect x="12" y="17" width="8" height="5" fill="${BLACK}"/><rect x="12" y="22" width="8" height="6" fill="${YELLOW}"/>`,
    east: `<rect x="12" y="17" width="8" height="3.7" fill="${BLACK}"/><rect x="12" y="20.7" width="8" height="3.6" fill="${YELLOW}"/><rect x="12" y="24.3" width="8" height="3.7" fill="${BLACK}"/>`,
    south: `<rect x="12" y="17" width="8" height="5" fill="${YELLOW}"/><rect x="12" y="22" width="8" height="6" fill="${BLACK}"/>`,
    west: `<rect x="12" y="17" width="8" height="3.7" fill="${YELLOW}"/><rect x="12" y="20.7" width="8" height="3.6" fill="${BLACK}"/><rect x="12" y="24.3" width="8" height="3.7" fill="${YELLOW}"/>`,
  }[kind];
  return `<path d="M16 14 V18" stroke="#04141f" stroke-width="1.5"/>
    <path d="M16 14 V18" stroke="${WHITE}" stroke-width=".6"/>
    <rect x="12" y="17" width="8" height="11" rx="1" fill="${YELLOW}" stroke="#04141f" stroke-width="1.4"/>
    ${bands}
    <g fill="${BLACK}" stroke="#04141f" stroke-width=".8" stroke-linejoin="round">${topmark}</g>`;
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
  return `${rays}<circle cx="16" cy="16" r="4.2" fill="${WHITE}" stroke="#04141f" stroke-width="1"/><circle cx="16" cy="16" r="2.5" fill="${BLACK}" stroke="${LIGHT_MAJOR}" stroke-width=".8"/>`;
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
  return `${stubs}<circle cx="16" cy="16" r="3.8" fill="${WHITE}" stroke="#04141f" stroke-width="1"/>` +
    `<circle cx="16" cy="16" r="2.2" fill="${BLACK}" stroke="${LIGHT_MINOR}" stroke-width=".8"/>`;
}

export function symbolFor(category: NavaidCategory, region: 'A' | 'B'): SymbolSpec {
  const label = CATEGORY_LABELS[category] ?? 'Mark';
  switch (category) {
    case 'lateral_port': {
      const colours = lateralColours('port', region);
      return { svg: svgWrap(can(colours.main, colours.band)), label };
    }
    case 'lateral_starboard': {
      const colours = lateralColours('starboard', region);
      return { svg: svgWrap(cone(colours.main, colours.band)), label };
    }
    case 'preferred_channel_port': {
      const colours = lateralColours('port', region);
      return { svg: svgWrap(bifurcation('can', colours.main, colours.band)), label };
    }
    case 'preferred_channel_starboard': {
      const colours = lateralColours('starboard', region);
      return { svg: svgWrap(bifurcation('cone', colours.main, colours.band)), label };
    }
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
    case 'transit_rear':
      return { svg: svgWrap(transitSvg()), label };
    case 'major_light':
      return { svg: svgWrap(majorLightSvg()), label };
    case 'light':
      return { svg: svgWrap(minorLightSvg()), label };
    case 'wreck':
      return { svg: svgWrap(wreckSvg()), label };
    case 'hazard':
      return { svg: svgWrap(sphere(WHITE, BLACK)), label };
    case 'hazard_danger':
      return { svg: svgWrap(wreckSvg(true)), label };
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
