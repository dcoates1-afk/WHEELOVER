export type NavaidCategory =
  | 'lateral_port'
  | 'lateral_starboard'
  | 'preferred_channel_port'
  | 'preferred_channel_starboard'
  | 'lateral_other'
  | 'cardinal_north'
  | 'cardinal_east'
  | 'cardinal_south'
  | 'cardinal_west'
  | 'cardinal_unspecified'
  | 'safe_water'
  | 'isolated_danger'
  | 'special_purpose'
  | 'range'
  | 'transit_front'
  | 'transit_rear'
  | 'major_light'
  | 'light'
  | 'wreck'
  | 'hazard'
  | 'hazard_danger'
  | 'landmark'
  | 'marina'
  | 'facility'
  | 'mooring'
  | 'anchorage'
  | 'anchor_berth'
  | 'calling_in_point'
  | 'communication_area'
  | 'notice'
  | 'gate'
  | 'other';

export type NavaidForm = 'buoy' | 'beacon' | 'light' | 'landmark' | 'mark';

export interface NavaidTagMap {
  [key: string]: string | undefined;
}

export interface Navaid {
  id: string;
  lat: number;
  lon: number;
  category: NavaidCategory;
  form: NavaidForm;
  name: string | null;
  /** Source seamark object type, e.g. buoy_lateral, beacon_cardinal, wreck. */
  markType?: string | null;
  /** Source category on the object, distinct from the renderer's symbol category. */
  markCategory?: string | null;
  light: string | null;
  /** Exact source light-character code, e.g. F, Fl, Iso; missing is not assumed steady. */
  lightCharacter?: string | null;
  /** Separate numbered light sectors, including any encoded bearing limits. */
  lightSectors?: { sector: number; character?: string; colour?: string; group?: string; period?: string; sequence?: string; start?: string; end?: string; range?: string }[];
  /** Encoded buoyage system (e.g. IALA-A/B), when supplied by the source. */
  buoyageSystem?: string | null;
  /** Cautious plain-language surface-navigation effect from wreck tags only. */
  wreckBoatingEffect?: string | null;
  /** Painted physical colour of the buoy/beacon, not the emitted light colour. */
  colour: string | null;
  colourPattern?: string | null;
  lightColour?: string | null;
  topmarkColour?: string | null;
  shape: string | null;
  topmarkShape?: string | null;
  lightCategory?: string | null;
  lightGroup?: string | null;
  lightPeriod?: string | null;
  lightSequence?: string | null;
  verticalDatum?: string | null;
  positionQuality?: string | null;
  sourceCitation?: string | null;
  sourceDate?: string | null;
  sourceUrl?: string | null;
  wreckType?: string | null;
  wreckDateSunk?: string | null;
  wreckCategory?: string | null;
  wreckWaterLevel?: string | null;
  wreckSoundingDepth?: string | null;
  wreckReportedDepth?: string | null;
  wreckClearance?: string | null;
  wreckLength?: string | null;
  wreckWidth?: string | null;
  diveSite?: boolean;
  diveDepth?: string | null;
  diveMaxDepth?: string | null;
  diveEntry?: string | null;
  diveHazard?: string | null;
  driftDive?: boolean;
  height: string | null;
  range: string | null;
  path: [number, number][] | null;
  paths?: [number, number][][] | null;
  transitBearing: number | null;
  transitDistanceM: number | null;
  transitPartner: string | null;
  transitPartnerName: string | null;
  channel: string | null;
  callsign?: string | null;
  description: string | null;
  lit: boolean | null;
  priority: number;
  source: string;
  updated: string | null;
  region: string | null;
}

export interface ClassifiedMark {
  category: NavaidCategory;
  form: NavaidForm;
  priority: number;
  lit: boolean | null;
}

export const DEFAULT_CELL_SIZE: number;
export const DEDUPE_DISTANCE_M: number;
export const SHOW_ALL_LIMIT: number;
export const DEFAULT_MARK_LIMIT: number;

export function ialaRegion(lat: number, lon: number): 'A' | 'B';
export function classifyTags(tags: NavaidTagMap): ClassifiedMark | null;
export function lightText(tags: NavaidTagMap): string | null;
export function normalizeElement(
  element: unknown,
  regionId?: string | null,
  source?: string,
): Navaid | null;
export function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number;
export function bearingDegrees(fromLat: number, fromLon: number, toLat: number, toLon: number): number;
export function annotateTransits(
  items: Navaid[],
  options?: { maxDistanceM?: number },
): Navaid[];
export function dedupeNavaids(
  items: Navaid[],
  options?: { distanceM?: number },
): { navaids: Navaid[]; removed: number };
export function cellKey(lat: number, lon: number, size?: number): string;
export function cellBounds(key: string, size?: number): [number, number, number, number];
export function minZoomFor(category: NavaidCategory): number;
export function priorityFor(category: NavaidCategory): number;
export function selectVisibleNavaids(
  navaids: Navaid[],
  options: {
    zoom: number;
    bounds: [number, number, number, number];
    showAll?: boolean;
    limit?: number;
    center?: [number, number];
  },
): Navaid[];
export const CATEGORY_LABELS: Record<NavaidCategory, string>;
