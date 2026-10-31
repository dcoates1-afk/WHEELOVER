import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  convertDepth,
  convertPressure,
  convertSpeed,
  convertTemperature,
  convertWind,
  formatDepthWithUnit,
  formatDistance,
  readSettings,
  sanitizeSettings,
  writeSettings,
} from './settings';
import {
  coordinateFormatLabel,
  formatCoordinate,
  formatLatLon,
  georef,
  mgrs,
  utmBand,
  utmGrid,
} from './coordinates';

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

describe('settings', () => {
  it('fills in defaults for an empty profile', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps known unit choices and rejects unknown ones', () => {
    const settings = sanitizeSettings({
      units: { speed: 'mph', depth: 'fathoms', pressure: 'psi', coordinates: 'mgrs', bearing: 'sideways' },
      notifications: { arrival: false, anchorDrift: true },
      profile: { name: 'Skipper', homePort: 'Portsmouth' },
      boat: { name: 'Wheel Over', draughtM: '1.6' },
    });
    expect(settings.units.speed).toBe('mph');
    expect(settings.units.depth).toBe('fathoms');
    expect(settings.units.pressure).toBe('psi');
    expect(settings.units.coordinates).toBe('mgrs');
    expect(settings.units.bearing).toBe(DEFAULT_SETTINGS.units.bearing);
    expect(settings.notifications.arrival).toBe(false);
    expect(settings.notifications.anchorDrift).toBe(true);
    expect(settings.profile.name).toBe('Skipper');
    expect(settings.boat.draughtM).toBe('1.6');
  });

  it('round-trips through storage', () => {
    const storage = fakeStorage();
    writeSettings(storage, {
      ...DEFAULT_SETTINGS,
      units: { ...DEFAULT_SETTINGS.units, windSpeed: 'kph' },
      boat: { ...DEFAULT_SETTINGS.boat, mmsi: '232000000' },
    });
    const stored = storage.getItem(SETTINGS_STORAGE_KEY);
    expect(stored).toBeTruthy();
    const restored = readSettings(storage);
    expect(restored.units.windSpeed).toBe('kph');
    expect(restored.boat.mmsi).toBe('232000000');
  });

  it('survives corrupt storage', () => {
    const storage = fakeStorage({ [SETTINGS_STORAGE_KEY]: '{not json' });
    expect(readSettings(storage)).toEqual(DEFAULT_SETTINGS);
  });

  it('writes distances in the chosen convention, switching unit at the long end', () => {
    // 30 m is the default anchor swing radius; 926 m is half a nautical mile.
    expect(formatDistance(30, 'nm-ft')).toBe('98 ft');
    expect(formatDistance(30, 'nm-yd')).toBe('33 yd');
    expect(formatDistance(30, 'ft-sm')).toBe('98 ft');
    expect(formatDistance(30, 'yd-sm')).toBe('33 yd');
    expect(formatDistance(30, 'ft-yd-sm')).toBe('98 ft');
    expect(formatDistance(30, 'm-nm')).toBe('30 m');
    expect(formatDistance(30, 'm-km')).toBe('30 m');
    expect(formatDistance(7.5, 'm-km')).toBe('7.5 m');
    expect(formatDistance(926, 'nm-ft')).toBe('0.50 nm');
    expect(formatDistance(926, 'ft-sm')).toBe('0.58 sm');
    expect(formatDistance(3000, 'nm-ft')).toBe('1.6 nm');
    expect(formatDistance(3000, 'ft-sm')).toBe('1.9 sm');
    expect(formatDistance(500_000, 'nm-ft')).toBe('270 nm');
    expect(formatDistance(926, 'm-km')).toBe('926 m');
    expect(formatDistance(1500, 'm-km')).toBe('1.5 km');
    expect(formatDistance(926, 'm-nm')).toBe('926 m');
    expect(formatDistance(400, 'ft-yd-sm')).toBe('437 yd');
    expect(formatDistance(30)).toBe('30 m');
    expect(formatDistance(Number.NaN, 'nm-ft')).toBe('—');
  });

  it('writes a depth with its unit for sheets and alerts', () => {
    expect(formatDepthWithUnit(12.6, 'm')).toBe('13 m');
    expect(formatDepthWithUnit(12.6, 'ft')).toBe('41 ft');
    expect(formatDepthWithUnit(12.6, 'fathoms')).toBe('6.9 fm');
    expect(formatDepthWithUnit(2.4)).toBe('2.4 m');
  });

  it('converts speed, wind, temperature, depth and pressure', () => {
    expect(convertSpeed(10, 'kn')).toBe(10);
    expect(convertSpeed(10, 'mph')).toBeCloseTo(11.5078, 3);
    expect(convertSpeed(10, 'kph')).toBeCloseTo(18.52, 2);
    expect(convertSpeed(10, 'mps')).toBeCloseTo(5.1444, 3);
    expect(convertWind(12, 'kph')).toBeCloseTo(22.224, 2);
    expect(convertTemperature(20, 'c')).toBe(20);
    expect(convertTemperature(20, 'f')).toBe(68);
    expect(convertDepth(10, 'm')).toBe(10);
    expect(convertDepth(10, 'ft')).toBeCloseTo(32.808, 2);
    expect(convertDepth(10, 'fathoms')).toBeCloseTo(5.468, 2);
    expect(convertPressure(1013.25, 'hpa')).toBe(1013.25);
    expect(convertPressure(1013.25, 'bar')).toBeCloseTo(1.013, 3);
    expect(convertPressure(1013.25, 'psi')).toBeCloseTo(14.696, 2);
  });
});

describe('coordinates', () => {
  it('writes degrees and decimal minutes like the chart', () => {
    expect(formatLatLon(50.76, -1.2)).toBe('50° 45.600′ N  01° 12.000′ W');
  });

  it('picks the UTM zone and band for a Solent position', () => {
    const grid = utmGrid(50.76, -1.2);
    expect(grid.zone).toBe(30);
    expect(grid.band).toBe('U');
    // 1.8° east of the zone 30 central meridian, so easting sits well above 500 km.
    expect(grid.easting).toBeGreaterThan(600000);
    expect(grid.easting).toBeLessThan(640000);
    expect(grid.northing).toBeGreaterThan(5600000);
    expect(grid.northing).toBeLessThan(5660000);
  });

  it('uses the Norway and Svalbard zone exceptions', () => {
    expect(utmGrid(60, 5).zone).toBe(32);
    expect(utmGrid(78, 15).zone).toBe(33);
    expect(utmBand(-33.9)).toBe('H');
  });

  it('uses the MGRS 100 km letter set that belongs to the zone', () => {
    // Zones 3, 6, 9 … carry S–Z; zone 30 is in that set.
    expect(mgrs(50.76, -1.2)).toMatch(/^30U [S-Z][A-Z] \d{5} \d{5}$/);
    expect(mgrs(51.5, -0.12)).toMatch(/^30U [S-Z][A-Z] /);
  });

  it('matches the published GEOREF reference for Patuxent River', () => {
    // 38°17′10″N 76°24′42″W is GJPJ3417 to the nearest minute.
    expect(georef(38.286108, -76.4291704)).toBe('GJPJ3417');
  });

  it('formats every grid with its own writing order', () => {
    expect(formatCoordinate(50.76, -1.2, 'utm')).toMatch(/^30U [\d ]+E [\d ]+N$/);
    expect(formatCoordinate(50.76, -1.2, 'mgrs')).toMatch(/^30U [A-Z]{2} \d{5} \d{5}$/);
    expect(formatCoordinate(53.35, -6.26, 'itm')).toMatch(/^ITM [\d ]+E [\d ]+N$/);
    expect(formatCoordinate(53.35, -6.26, 'ig')).toMatch(/^IG [\d ]+E [\d ]+N$/);
    expect(formatCoordinate(-33.86, 151.2, 'amg')).toMatch(/^AMG \d{1,2} [\d ]+E [\d ]+N$/);
    expect(formatCoordinate(-41.29, 174.78, 'nzmg')).toMatch(/^[\d ]+N [\d ]+E NZMG$/);
    expect(formatCoordinate(89, 20, 'polar')).toMatch(/^Polar N [\d ]+E [\d ]+N$/);
    expect(formatCoordinate(50.76, -1.2, 'latlon')).toContain('N');
  });

  it('labels each grid', () => {
    expect(coordinateFormatLabel('latlon')).toBe('Lat/Long');
    expect(coordinateFormatLabel('mgrs')).toBe('MGRS');
  });
});
