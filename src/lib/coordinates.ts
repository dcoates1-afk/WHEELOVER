import type { CoordinateFormat } from './settings';

/**
 * Position formatting for the grid systems offered in Settings.
 *
 * Everything is derived from the WGS84 position the device or cursor reports,
 * using the standard projection parameters published for each grid. The
 * national grids are drawn on their own ellipsoids; the small datum shift
 * between WGS84 and the local datum is not applied, so a national-grid reading
 * here is a chart-quality reference rather than a survey measurement.
 */

type Ellipsoid = { a: number; f: number };

const WGS84: Ellipsoid = { a: 6378137, f: 1 / 298.257223563 };
const GRS80: Ellipsoid = { a: 6378137, f: 1 / 298.257222101 };
const AIRY_MODIFIED: Ellipsoid = { a: 6377340.189, f: 1 / 299.3249646 };
const AUSTRALIAN_NATIONAL: Ellipsoid = { a: 6378160, f: 1 / 298.25 };

const RAD = Math.PI / 180;

function meridionalArc(latRad: number, ellipsoid: Ellipsoid): number {
  const { a, f } = ellipsoid;
  const e2 = f * (2 - f);
  return (
    a *
    ((1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 * e2 * e2) / 256) * latRad -
      ((3 * e2) / 8 + (3 * e2 * e2) / 32 + (45 * e2 * e2 * e2) / 1024) * Math.sin(2 * latRad) +
      ((15 * e2 * e2) / 256 + (45 * e2 * e2 * e2) / 1024) * Math.sin(4 * latRad) -
      ((35 * e2 * e2 * e2) / 3072) * Math.sin(6 * latRad))
  );
}

interface TransverseMercatorParams {
  ellipsoid: Ellipsoid;
  lat0: number;
  lon0: number;
  k0: number;
  falseEasting: number;
  falseNorthing: number;
}

/** Standard Transverse Mercator forward series, accurate to a metre in-zone. */
function transverseMercator(
  lat: number,
  lon: number,
  params: TransverseMercatorParams,
): { easting: number; northing: number } {
  const { ellipsoid, lat0, lon0, k0, falseEasting, falseNorthing } = params;
  const e2 = ellipsoid.f * (2 - ellipsoid.f);
  const ep2 = e2 / (1 - e2);
  const phi = lat * RAD;
  const dLon = (lon - lon0) * RAD;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const tanPhi = Math.tan(phi);
  const n = ellipsoid.a / Math.sqrt(1 - e2 * sinPhi * sinPhi);
  const t = tanPhi * tanPhi;
  const c = ep2 * cosPhi * cosPhi;
  const a = cosPhi * dLon;
  const m = meridionalArc(phi, ellipsoid);
  const m0 = meridionalArc(lat0 * RAD, ellipsoid);

  const easting =
    k0 *
      n *
      (a +
        ((1 - t + c) * a ** 3) / 6 +
        ((5 - 18 * t + t * t + 72 * c - 58 * ep2) * a ** 5) / 120) +
    falseEasting;
  const northing =
    k0 *
      (m -
        m0 +
        n *
          tanPhi *
          (a ** 2 / 2 +
            ((5 - t + 9 * c + 4 * c * c) * a ** 4) / 24 +
            ((61 - 58 * t + t * t + 600 * c - 330 * ep2) * a ** 6) / 720)) +
    falseNorthing;

  return { easting, northing };
}

/** UTM zone letter for a latitude, skipping I and O. */
export function utmBand(lat: number): string {
  if (lat >= 84) return 'X';
  if (lat < -80) return 'C';
  const bands = 'CDEFGHJKLMNPQRSTUVWXX';
  const index = Math.floor((lat + 80) / 8);
  return bands[Math.min(index, bands.length - 1)];
}

/** UTM zone number, with Norway and Svalbard exceptions applied. */
export function utmZone(lat: number, lon: number): number {
  let zone = Math.floor((lon + 180) / 6) + 1;
  if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) zone = 32;
  if (lat >= 72 && lat < 84) {
    if (lon >= 0 && lon < 9) zone = 31;
    else if (lon >= 9 && lon < 21) zone = 33;
    else if (lon >= 21 && lon < 33) zone = 35;
    else if (lon >= 33 && lon < 42) zone = 37;
  }
  return Math.min(60, Math.max(1, zone));
}

export function utmGrid(lat: number, lon: number): { zone: number; band: string; easting: number; northing: number } {
  const zone = utmZone(lat, lon);
  const centralMeridian = zone * 6 - 183;
  const { easting, northing } = transverseMercator(lat, lon, {
    ellipsoid: WGS84,
    lat0: 0,
    lon0: centralMeridian,
    k0: 0.9996,
    falseEasting: 500000,
    falseNorthing: lat < 0 ? 10000000 : 0,
  });
  return { zone, band: utmBand(lat), easting, northing };
}

/** Universal Polar Stereographic grid, used beyond the UTM limits. */
export function polarStereographic(
  lat: number,
  lon: number,
): { hemisphere: 'N' | 'S'; easting: number; northing: number } {
  const { a, f } = WGS84;
  const e = Math.sqrt(f * (2 - f));
  const k0 = 0.994;
  const north = lat >= 0;
  const phi = Math.abs(lat) * RAD;
  const lambda = lon * RAD;

  const ratio = (1 - e * Math.sin(phi)) / (1 + e * Math.sin(phi));
  const t = Math.tan(Math.PI / 4 - phi / 2) / ratio ** (e / 2);
  const rho =
    (2 * a * k0 * t) / Math.sqrt((1 + e) ** (1 + e) * (1 - e) ** (1 - e));
  const x = rho * Math.sin(lambda);
  const y = rho * Math.cos(lambda);
  return {
    hemisphere: north ? 'N' : 'S',
    easting: 2000000 + x,
    northing: 2000000 + (north ? -y : y),
  };
}

const MGRS_COLUMNS = ['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ'];
const MGRS_ROWS = 'ABCDEFGHJKLMNPQRSTUV';
const GEOREF_SERIES = 'ABCDEFGHJKLMNPQ';

/** MGRS 100 km square letter pair for a UTM zone. */
function mgrsSquare(zone: number, band: string, easting: number, northing: number): string {
  const column = Math.floor(easting / 100000);
  const row = Math.floor(northing / 100000);
  // Zone 1 starts the A–H letter set, so the set index runs (zone - 1) % 3.
  const columnLetters = MGRS_COLUMNS[(zone - 1) % 3];
  const bandIndex = 'CDEFGHJKLMNPQRSTUVWX'.indexOf(band);
  const rowOffset = bandIndex % 2 === 0 ? 0 : 5;
  const rowLetter = MGRS_ROWS[(row + rowOffset) % 20];
  return `${columnLetters[column - 1] ?? '?'}${rowLetter}`;
}

export function mgrs(lat: number, lon: number): string {
  const grid = utmGrid(lat, lon);
  const square = mgrsSquare(grid.zone, grid.band, grid.easting, grid.northing);
  const east = Math.floor(grid.easting % 100000);
  const north = Math.floor(grid.northing % 100000);
  return `${grid.zone}${grid.band} ${square} ${String(east).padStart(5, '0')} ${String(north).padStart(5, '0')}`;
}

/**
 * World Geographic Reference System. The 15° quadrangle runs east from 180°
 * for longitude and north from the South Pole for latitude, then the 1°
 * quadrangle is lettered A–Q (I and O omitted) and the minute pair is written
 * easting first.
 */
export function georef(lat: number, lon: number): string {
  // Longitude runs east from the 180° meridian, so the zone letter counts from
  // there rather than from Greenwich.
  const lonEast = (((lon + 180) % 360) + 360) % 360;
  const lonZone = Math.min(23, Math.floor(lonEast / 15));
  const latBand = Math.min(11, Math.max(0, Math.floor((lat + 90) / 15)));
  const zoneLetters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const bandLetters = 'ABCDEFGHJKLM';
  const lonDegrees = lonEast - lonZone * 15;
  const latDegrees = lat + 90 - latBand * 15;
  const column = Math.min(14, Math.floor(lonDegrees));
  const row = Math.min(14, Math.floor(latDegrees));
  const minutes = Math.floor((lonDegrees - column) * 60);
  const northMinutes = Math.floor((latDegrees - row) * 60);
  return `${zoneLetters[lonZone]}${bandLetters[latBand]}${GEOREF_SERIES[column]}${
    GEOREF_SERIES[row]
  }${String(minutes).padStart(2, '0')}${String(northMinutes).padStart(2, '0')}`;
}

/** New Zealand Map Grid: the published sixth-order conformal polynomial. */
const NZMG_B = [
  [0.7557853228, 0],
  [0.249204646, 0.003371507],
  [-0.001541739, 0.04105856],
  [-0.10162907, 0.01727609],
  [-0.26623489, -0.36249218],
  [-0.6870983, -1.1651967],
];

function newZealandMapGrid(lat: number, lon: number): { northing: number; easting: number } {
  // NZGD1949 origin: 41° S, 173° E; false origin 2 519 000 N / 6 023 150 E.
  const dPsi = (lat + 41) * 3600e-5;
  const dLambda = (lon - 173) * 3600e-5;
  let re = 0;
  let im = 0;
  // z = B1·θ + B2·θ² + … , θ = Δψ + iΔλ
  let thetaRe = dPsi;
  let thetaIm = dLambda;
  for (let order = 0; order < NZMG_B.length; order += 1) {
    const [bRe, bIm] = NZMG_B[order];
    const partRe = bRe * thetaRe - bIm * thetaIm;
    const partIm = bRe * thetaIm + bIm * thetaRe;
    re += partRe;
    im += partIm;
    const nextRe = thetaRe * dPsi - thetaIm * dLambda;
    const nextIm = thetaRe * dLambda + thetaIm * dPsi;
    thetaRe = nextRe;
    thetaIm = nextIm;
  }
  return { northing: 6023150 + re, easting: 2510000 + im };
}

function irishTransverseMercator(lat: number, lon: number): { easting: number; northing: number } {
  return transverseMercator(lat, lon, {
    ellipsoid: GRS80,
    lat0: 53.5,
    lon0: -8,
    k0: 0.99982,
    falseEasting: 600000,
    falseNorthing: 750000,
  });
}

function irishGrid(lat: number, lon: number): { easting: number; northing: number } {
  return transverseMercator(lat, lon, {
    ellipsoid: AIRY_MODIFIED,
    lat0: 53.5,
    lon0: -8,
    k0: 1.000035,
    falseEasting: 200000,
    falseNorthing: 250000,
  });
}

function australianMapGrid(
  lat: number,
  lon: number,
): { zone: number; easting: number; northing: number } {
  const zone = utmZone(lat, lon);
  const { easting, northing } = transverseMercator(lat, lon, {
    ellipsoid: AUSTRALIAN_NATIONAL,
    lat0: 0,
    lon0: zone * 6 - 183,
    k0: 0.9996,
    falseEasting: 500000,
    falseNorthing: 10000000,
  });
  return { zone, easting, northing };
}

/** Degrees and decimal minutes, the form printed on the chart itself. */
export function formatLatLon(lat: number, lon: number): string {
  const part = (value: number, positive: string, negative: string) => {
    const hemisphere = value >= 0 ? positive : negative;
    const absolute = Math.abs(value);
    const degrees = Math.floor(absolute);
    const minutes = (absolute - degrees) * 60;
    return `${String(degrees).padStart(2, '0')}° ${minutes.toFixed(3).padStart(6, '0')}′ ${hemisphere}`;
  };
  return `${part(lat, 'N', 'S')}  ${part(lon, 'E', 'W')}`;
}

function metres(value: number): string {
  return Math.round(value).toLocaleString('en-GB').replace(/,/g, ' ');
}

/** A position written in the grid system chosen in Settings. */
export function formatCoordinate(lat: number, lon: number, format: CoordinateFormat): string {
  switch (format) {
    case 'utm': {
      if (Math.abs(lat) > 84) {
        const polar = polarStereographic(lat, lon);
        return `UPS ${polar.hemisphere} ${metres(polar.easting)}E ${metres(polar.northing)}N`;
      }
      const grid = utmGrid(lat, lon);
      return `${grid.zone}${grid.band} ${metres(grid.easting)}E ${metres(grid.northing)}N`;
    }
    case 'mgrs':
      return mgrs(lat, lon);
    case 'georef':
      return georef(lat, lon);
    case 'amg': {
      const grid = australianMapGrid(lat, lon);
      return `AMG ${grid.zone} ${metres(grid.easting)}E ${metres(grid.northing)}N`;
    }
    case 'nzmg': {
      const grid = newZealandMapGrid(lat, lon);
      return `${metres(grid.northing)}N ${metres(grid.easting)}E NZMG`;
    }
    case 'itm': {
      const grid = irishTransverseMercator(lat, lon);
      return `ITM ${metres(grid.easting)}E ${metres(grid.northing)}N`;
    }
    case 'ig': {
      const grid = irishGrid(lat, lon);
      return `IG ${metres(grid.easting)}E ${metres(grid.northing)}N`;
    }
    case 'polar': {
      const polar = polarStereographic(lat, lon);
      return `Polar ${polar.hemisphere} ${metres(polar.easting)}E ${metres(polar.northing)}N`;
    }
    case 'latlon':
    default:
      return formatLatLon(lat, lon);
  }
}

/** Short label for the chosen grid, shown beside the readout. */
export function coordinateFormatLabel(format: CoordinateFormat): string {
  return format === 'latlon'
    ? 'Lat/Long'
    : format === 'utm'
      ? 'UTM/UPS'
      : format === 'mgrs'
        ? 'MGRS'
        : format === 'georef'
          ? 'GEOREF'
          : format === 'amg'
            ? 'AMG'
            : format === 'nzmg'
              ? 'NZMG'
              : format === 'itm'
                ? 'ITM'
                : format === 'ig'
                  ? 'IG'
                  : 'Polar';
}
