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

export interface Navaid {
  id: string;
  lat: number;
  lon: number;
  category: NavaidCategory;
  form: NavaidForm;
  name: string | null;
  light: string | null;
  colour: string | null;
  shape: string | null;
  height: string | null;
  range: string | null;
  path: [number, number][] | null;
  /** Separate geometry paths, used for multipart reporting areas when present. */
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
