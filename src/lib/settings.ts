/**
 * Navigator and vessel settings: the unit conventions the app reads values in,
 * the alerts the navigator wants, and the profile and boat details shown in the
 * menu. Everything is stored on the device only.
 */

export type DistanceUnit = 'nm-ft' | 'nm-yd' | 'ft-sm' | 'yd-sm' | 'ft-yd-sm' | 'm-nm' | 'm-km';
export type SpeedUnit = 'kn' | 'mph' | 'kph' | 'mps';
export type WindSpeedUnit = 'kn' | 'mph' | 'kph';
export type DepthUnit = 'ft' | 'fathoms' | 'm';
export type BearingMode = 'true' | 'magnetic' | 'polar';
export type RelativeBearingMode = 'degrees' | 'red-green';
export type CoordinateFormat =
  | 'latlon'
  | 'utm'
  | 'mgrs'
  | 'georef'
  | 'amg'
  | 'nzmg'
  | 'polar'
  | 'itm'
  | 'ig';
export type FuelUnit = 'gal' | 'l';
export type TemperatureUnit = 'c' | 'f';
export type PressureUnit = 'bar' | 'pa' | 'hpa' | 'kpa' | 'psi' | 'inhg' | 'mmhg' | 'mbar';
export type RateOfTurnUnit = 'degps' | 'degpm' | 'rpm';

export interface UnitSettings {
  distance: DistanceUnit;
  speed: SpeedUnit;
  depth: DepthUnit;
  bearing: BearingMode;
  relativeBearing: RelativeBearingMode;
  coordinates: CoordinateFormat;
  fuel: FuelUnit;
  temperature: TemperatureUnit;
  windSpeed: WindSpeedUnit;
  pressure: PressureUnit;
  rateOfTurn: RateOfTurnUnit;
}

export interface NotificationSettings {
  arrival: boolean;
  anchorDrift: boolean;
  offCourse: boolean;
  shallowWater: boolean;
  aisProximity: boolean;
  sound: boolean;
  vibration: boolean;
}

export interface ProfileSettings {
  name: string;
  homePort: string;
  experience: string;
  emergencyContact: string;
}

export interface BoatSettings {
  name: string;
  type: string;
  lengthM: string;
  beamM: string;
  draughtM: string;
  mmsi: string;
  callSign: string;
}

export interface AppSettings {
  units: UnitSettings;
  notifications: NotificationSettings;
  profile: ProfileSettings;
  boat: BoatSettings;
}

export interface UnitOption<T extends string> {
  value: T;
  label: string;
}

export const DISTANCE_UNITS: UnitOption<DistanceUnit>[] = [
  { value: 'nm-ft', label: 'Nautical miles, feet' },
  { value: 'nm-yd', label: 'Nautical miles, yards' },
  { value: 'ft-sm', label: 'Feet, statute miles' },
  { value: 'yd-sm', label: 'Yards, statute miles' },
  { value: 'ft-yd-sm', label: 'Feet, yards, statute miles' },
  { value: 'm-nm', label: 'Meters, nautical miles' },
  { value: 'm-km', label: 'Meters, kilometers' },
];

export const SPEED_UNITS: UnitOption<SpeedUnit>[] = [
  { value: 'kn', label: 'Knots (kn)' },
  { value: 'mph', label: 'Miles per hour (mph)' },
  { value: 'kph', label: 'Kilometers per hour (kph)' },
  { value: 'mps', label: 'Meters per second (m/s)' },
];

export const WIND_SPEED_UNITS: UnitOption<WindSpeedUnit>[] = [
  { value: 'kn', label: 'Knots (kn)' },
  { value: 'mph', label: 'Miles per hour (mph)' },
  { value: 'kph', label: 'Kilometers per hour (kph)' },
];

export const DEPTH_UNITS: UnitOption<DepthUnit>[] = [
  { value: 'ft', label: 'Feet' },
  { value: 'fathoms', label: 'Fathoms' },
  { value: 'm', label: 'Meters' },
];

export const BEARING_MODES: UnitOption<BearingMode>[] = [
  { value: 'true', label: 'True' },
  { value: 'magnetic', label: 'Magnetic' },
  { value: 'polar', label: 'Polar grid' },
];

export const RELATIVE_BEARING_MODES: UnitOption<RelativeBearingMode>[] = [
  { value: 'degrees', label: '360 degrees' },
  { value: 'red-green', label: 'Red / green' },
];

export const COORDINATE_FORMATS: UnitOption<CoordinateFormat>[] = [
  { value: 'latlon', label: 'Latitude / Longitude' },
  { value: 'utm', label: 'UTM / UPS' },
  { value: 'mgrs', label: 'Military Grid Reference System (MGRS)' },
  { value: 'georef', label: 'Geographic Reference System (GEOREF)' },
  { value: 'amg', label: 'Australian Map Grid (AMG)' },
  { value: 'nzmg', label: 'New Zealand Map Grid (NZMG)' },
  { value: 'polar', label: 'Polar grid' },
  { value: 'itm', label: 'Irish Transverse Mercator (ITM)' },
  { value: 'ig', label: 'Irish Grid (IG)' },
];

export const FUEL_UNITS: UnitOption<FuelUnit>[] = [
  { value: 'gal', label: 'Gallons' },
  { value: 'l', label: 'Liters' },
];

export const TEMPERATURE_UNITS: UnitOption<TemperatureUnit>[] = [
  { value: 'c', label: 'Celsius' },
  { value: 'f', label: 'Fahrenheit' },
];

export const PRESSURE_UNITS: UnitOption<PressureUnit>[] = [
  { value: 'bar', label: 'Bars (bar)' },
  { value: 'pa', label: 'Pascals (Pa)' },
  { value: 'hpa', label: 'Hectopascals (hPa)' },
  { value: 'kpa', label: 'Kilopascals (kPa)' },
  { value: 'psi', label: 'Pounds per square inch (psi)' },
  { value: 'inhg', label: 'Inches of mercury (in Hg)' },
  { value: 'mmhg', label: 'Millimeters of mercury (mm Hg)' },
  { value: 'mbar', label: 'Millibars (mbar)' },
];

export const RATE_OF_TURN_UNITS: UnitOption<RateOfTurnUnit>[] = [
  { value: 'degps', label: 'Degrees per second (°/s)' },
  { value: 'degpm', label: 'Degrees per minute (°/min)' },
  { value: 'rpm', label: 'Revolutions per minute (rpm)' },
];

export const BOAT_TYPES = [
  'Motor yacht',
  'Sailing yacht',
  'Motor sailer',
  'RIB / powerboat',
  'Commercial vessel',
  'Fishing vessel',
  'Kayak / canoe',
  'Other',
] as const;

export const EXPERIENCE_LEVELS = [
  'Coastal',
  'Offshore',
  'Ocean',
  'Instructor',
  'Professional',
] as const;

export const SETTINGS_STORAGE_KEY = 'wheel-over:settings';

export const DEFAULT_SETTINGS: AppSettings = {
  units: {
    distance: 'nm-ft',
    speed: 'kn',
    depth: 'm',
    bearing: 'true',
    relativeBearing: 'degrees',
    coordinates: 'latlon',
    fuel: 'l',
    temperature: 'c',
    windSpeed: 'kn',
    pressure: 'hpa',
    rateOfTurn: 'degpm',
  },
  notifications: {
    arrival: true,
    anchorDrift: false,
    offCourse: true,
    shallowWater: true,
    aisProximity: true,
    sound: true,
    vibration: false,
  },
  profile: {
    name: '',
    homePort: '',
    experience: '',
    emergencyContact: '',
  },
  boat: {
    name: '',
    type: '',
    lengthM: '',
    beamM: '',
    draughtM: '',
    mmsi: '',
    callSign: '',
  },
};

function pick<T extends string>(options: UnitOption<T>[], value: unknown, fallback: T): T {
  return options.some((option) => option.value === value) ? (value as T) : fallback;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, 80) : '';
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function sanitizeSettings(value: unknown): AppSettings {
  const input = (value ?? {}) as Partial<AppSettings>;
  const units = (input.units ?? {}) as Partial<UnitSettings>;
  const notifications = (input.notifications ?? {}) as Partial<NotificationSettings>;
  const profile = (input.profile ?? {}) as Partial<ProfileSettings>;
  const boat = (input.boat ?? {}) as Partial<BoatSettings>;
  const base = DEFAULT_SETTINGS;
  return {
    units: {
      distance: pick(DISTANCE_UNITS, units.distance, base.units.distance),
      speed: pick(SPEED_UNITS, units.speed, base.units.speed),
      depth: pick(DEPTH_UNITS, units.depth, base.units.depth),
      bearing: pick(BEARING_MODES, units.bearing, base.units.bearing),
      relativeBearing: pick(RELATIVE_BEARING_MODES, units.relativeBearing, base.units.relativeBearing),
      coordinates: pick(COORDINATE_FORMATS, units.coordinates, base.units.coordinates),
      fuel: pick(FUEL_UNITS, units.fuel, base.units.fuel),
      temperature: pick(TEMPERATURE_UNITS, units.temperature, base.units.temperature),
      windSpeed: pick(WIND_SPEED_UNITS, units.windSpeed, base.units.windSpeed),
      pressure: pick(PRESSURE_UNITS, units.pressure, base.units.pressure),
      rateOfTurn: pick(RATE_OF_TURN_UNITS, units.rateOfTurn, base.units.rateOfTurn),
    },
    notifications: {
      arrival: flag(notifications.arrival, base.notifications.arrival),
      anchorDrift: flag(notifications.anchorDrift, base.notifications.anchorDrift),
      offCourse: flag(notifications.offCourse, base.notifications.offCourse),
      shallowWater: flag(notifications.shallowWater, base.notifications.shallowWater),
      aisProximity: flag(notifications.aisProximity, base.notifications.aisProximity),
      sound: flag(notifications.sound, base.notifications.sound),
      vibration: flag(notifications.vibration, base.notifications.vibration),
    },
    profile: {
      name: text(profile.name),
      homePort: text(profile.homePort),
      experience: text(profile.experience),
      emergencyContact: text(profile.emergencyContact),
    },
    boat: {
      name: text(boat.name),
      type: text(boat.type),
      lengthM: text(boat.lengthM),
      beamM: text(boat.beamM),
      draughtM: text(boat.draughtM),
      mmsi: text(boat.mmsi),
      callSign: text(boat.callSign),
    },
  };
}

export function readSettings(storage: Pick<Storage, 'getItem'> | null | undefined): AppSettings {
  if (!storage) return sanitizeSettings(null);
  try {
    const raw = storage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return sanitizeSettings(null);
    return sanitizeSettings(JSON.parse(raw));
  } catch {
    return sanitizeSettings(null);
  }
}

export function writeSettings(
  storage: Pick<Storage, 'setItem'> | null | undefined,
  settings: AppSettings,
): void {
  if (!storage) return;
  try {
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage blocked: the choice still applies for this session.
  }
}

const KN_TO_MPH = 1.150779448;
const KN_TO_KPH = 1.852;
const KN_TO_MPS = 0.514444444;

/** A speed given in knots, converted for display. */
export function convertSpeed(knots: number, unit: SpeedUnit): number {
  if (unit === 'mph') return knots * KN_TO_MPH;
  if (unit === 'kph') return knots * KN_TO_KPH;
  if (unit === 'mps') return knots * KN_TO_MPS;
  return knots;
}

export function speedUnitLabel(unit: SpeedUnit): string {
  return unit === 'mph' ? 'mph' : unit === 'kph' ? 'kph' : unit === 'mps' ? 'm/s' : 'kn';
}

export function convertWind(knots: number, unit: WindSpeedUnit): number {
  return convertSpeed(knots, unit);
}

export function windUnitLabel(unit: WindSpeedUnit): string {
  return unit === 'mph' ? 'mph' : unit === 'kph' ? 'kph' : 'kn';
}

/** Wind in knots as the selected pressure-like speed unit reads it. */
export function convertTemperature(celsius: number, unit: TemperatureUnit): number {
  return unit === 'f' ? celsius * 1.8 + 32 : celsius;
}

export function temperatureUnitLabel(unit: TemperatureUnit): string {
  return unit === 'f' ? '°F' : '°C';
}

const METRES_PER_FOOT = 0.3048;
const METRES_PER_YARD = 0.9144;
const METRES_PER_NM = 1852;
const METRES_PER_SM = 1609.344;

function shortValue(value: number): string {
  return value < 10 ? (Math.round(value * 10) / 10).toFixed(1) : String(Math.round(value));
}

/** Hundredths of a mile close in, tenths across a passage, whole miles beyond. */
function milesValue(value: number, suffix: string): string {
  if (value < 1) return `${value.toFixed(2)} ${suffix}`;
  if (value < 100) return `${value.toFixed(1)} ${suffix}`;
  return `${Math.round(value)} ${suffix}`;
}

/**
 * A distance in the convention chosen in Settings. Each option names its short
 * unit first and its long unit last, so the chart switches from feet or yards to
 * miles at the size a navigator would expect to change units.
 */
export function formatDistance(metres: number, unit: DistanceUnit = 'm-nm'): string {
  if (!Number.isFinite(metres) || metres < 0) return '—';
  const nm = metres / METRES_PER_NM;
  const sm = metres / METRES_PER_SM;
  const nmText = milesValue(nm, 'nm');
  const smText = milesValue(sm, 'sm');
  const feet = metres / METRES_PER_FOOT;
  const yards = metres / METRES_PER_YARD;
  switch (unit) {
    case 'nm-ft':
      return feet < 1000 ? `${Math.round(feet)} ft` : nmText;
    case 'nm-yd':
      return yards < 1000 ? `${Math.round(yards)} yd` : nmText;
    case 'ft-sm':
      return feet < 1000 ? `${Math.round(feet)} ft` : smText;
    case 'yd-sm':
      return yards < 1760 ? `${Math.round(yards)} yd` : smText;
    case 'ft-yd-sm':
      if (feet < 300) return `${Math.round(feet)} ft`;
      return yards < 1760 ? `${Math.round(yards)} yd` : smText;
    case 'm-km':
      return metres < 1000 ? `${shortValue(metres)} m` : `${(metres / 1000).toFixed(metres < 10_000 ? 1 : 0)} km`;
    default:
      return metres < 1000 ? `${shortValue(metres)} m` : nmText;
  }
}

export function convertDepth(metres: number, unit: DepthUnit): number {
  if (unit === 'ft') return metres * 3.280839895;
  if (unit === 'fathoms') return metres * 0.546806649;
  return metres;
}

export function depthUnitLabel(unit: DepthUnit): string {
  return unit === 'ft' ? 'ft' : unit === 'fathoms' ? 'fm' : 'm';
}

/** A depth with its unit, for sheets, popups and alerts. */
export function formatDepthWithUnit(metres: number, unit: DepthUnit = 'm'): string {
  const value = convertDepth(metres, unit);
  const shown = value < 10 ? value.toFixed(1) : String(Math.round(value));
  return `${shown} ${depthUnitLabel(unit)}`;
}

/**
 * Vessel dimensions follow the unit choices rather than sitting in metres: the
 * length and beam take the short unit of the chosen distance pair, and the
 * draught takes the depth unit. Everything is still stored in metres so the
 * depth alert compares like with like.
 */
export function vesselLengthUnit(unit: DistanceUnit): { label: string; metres: number } {
  switch (unit) {
    case 'nm-yd':
    case 'yd-sm':
      return { label: 'yd', metres: METRES_PER_YARD };
    case 'm-nm':
    case 'm-km':
      return { label: 'm', metres: 1 };
    default:
      return { label: 'ft', metres: METRES_PER_FOOT };
  }
}

/** The unit a boat's length and beam are typed and read in. */
export function lengthUnitLabel(unit: DistanceUnit): string {
  return vesselLengthUnit(unit).label;
}

/** A length in metres as the selected vessel-length unit reads it. */
export function convertLength(metres: number, unit: DistanceUnit): number {
  return metres / vesselLengthUnit(unit).metres;
}

function parseTypedNumber(text: string): number | null {
  const value = Number.parseFloat(String(text).replace(',', '.').trim());
  return Number.isFinite(value) ? value : null;
}

/** A figure printed for a field: one decimal below 100, whole above it. */
export function formatDimension(value: number): string {
  if (!Number.isFinite(value)) return '';
  if (value >= 100) return String(Math.round(value));
  return String(Math.round(value * 10) / 10);
}

/** A typed length converted back to metres, or null when it is not readable. */
export function parseLength(text: string, unit: DistanceUnit): number | null {
  const value = parseTypedNumber(text);
  if (value === null || value <= 0) return null;
  return Math.round(value * vesselLengthUnit(unit).metres * 100) / 100;
}

/** A typed depth converted back to metres, or null when it is not readable. */
export function parseDepth(text: string, unit: DepthUnit): number | null {
  const value = parseTypedNumber(text);
  if (value === null || value <= 0) return null;
  const factor = unit === 'ft' ? METRES_PER_FOOT : unit === 'fathoms' ? 1 / 0.546806649 : 1;
  return Math.round(value * factor * 100) / 100;
}

const HPA_TO_BAR = 0.001;
const HPA_TO_PSI = 0.0145037738;
const HPA_TO_INHG = 0.0295299831;
const HPA_TO_MMHG = 0.750061683;

/** Barometric pressure given in hectopascals, converted for display. */
export function convertPressure(hectopascals: number, unit: PressureUnit): number {
  if (unit === 'bar') return hectopascals * HPA_TO_BAR;
  if (unit === 'pa') return hectopascals * 100;
  if (unit === 'kpa') return hectopascals * 0.1;
  if (unit === 'psi') return hectopascals * HPA_TO_PSI;
  if (unit === 'inhg') return hectopascals * HPA_TO_INHG;
  if (unit === 'mmhg') return hectopascals * HPA_TO_MMHG;
  return hectopascals;
}

export function pressureUnitLabel(unit: PressureUnit): string {
  return unit === 'bar'
    ? 'bar'
    : unit === 'pa'
      ? 'Pa'
      : unit === 'kpa'
        ? 'kPa'
        : unit === 'psi'
          ? 'psi'
          : unit === 'inhg'
            ? 'inHg'
            : unit === 'mmhg'
              ? 'mmHg'
              : 'hPa';
}

export function pressureDecimals(unit: PressureUnit): number {
  return unit === 'bar' || unit === 'inhg' || unit === 'psi' ? 3 : unit === 'kpa' ? 2 : 0;
}
