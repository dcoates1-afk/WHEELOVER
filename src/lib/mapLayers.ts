import { NOAA_EXPORT_BASE, noaaServiceFor, tileBounds, type TileCoord } from './noaaChart';

/**
 * NOAA raster chart and ENC depth overlays.
 *
 * Every layer here is keyless and public. NOAA's RNC Tile Service was retired
 * in 2022, so "NOAA raster" is the current Maritime Chart Service display (the
 * nearest live replacement) rather than the old raster chart mosaic.
 *
 * The depth overlays render individual ENC layers through the same export
 * endpoint the NOAA base uses. That is the closest open equivalent of the
 * soundings and isobaths on a type-approved ECDIS: charted spot depths and
 * depth contours, at the band matching the current zoom.
 */

export const NOAA_RASTER_EXPORT =
  'https://gis.charttools.noaa.gov/arcgis/rest/services/MCS/NOAAChartDisplay/MapServer/exts/MaritimeChartService/MapServer/export';

export const NOAA_RASTER_ATTRIBUTION = 'NOAA Maritime Chart Service (public domain)';
export const NAUTICAL_ATTRIBUTION = 'Ocean basemap &copy; Esri, Garmin, GEBCO, NOAA NGDC';
export const RELIEF_ATTRIBUTION = 'Relief &copy; Esri, NOAA, USGS';
export const CONTOUR_ATTRIBUTION = 'Depth contours: GEBCO 2023 via NOAA (global), NOAA ENC (US)';
export const ENC_DEPTH_ATTRIBUTION = 'Depth contours: NOAA ENC (public domain)';
export const SOUNDING_ATTRIBUTION = 'Charted soundings: NOAA ENC (public domain)';
export const REPORTING_SYSTEM_ATTRIBUTION = 'Ship-reporting boundaries: 15 CFR part 922, Appendix E (eCFR); IMO MSC.279(85)';

export type EncDepthOverlay = 'contours' | 'soundings';

/**
 * Per-band ENC layer ids, read from each usage band's MapServer directory.
 * Harbour uses the US spelling in its layer names; the ids are what the export
 * request needs.
 */
export const ENC_CONTOUR_LAYERS = {
  enc_harbour: 104,
  enc_coastal: 82,
  enc_general: 64,
} as const;
export const ENC_SOUNDING_LAYERS = {
  enc_harbour: 76,
  enc_coastal: 61,
  enc_general: 50,
} as const;

/** Soundings only become legible (and are only rendered) at harbour scale. */
export const SOUNDING_MIN_ZOOM = 15;
/** The general band's export omits contours, so GEBCO covers the overview. */
export const ENC_CONTOUR_MIN_ZOOM = 9;

function bboxOf(tile: TileCoord): string {
  const [south, west, north, east] = tileBounds(tile);
  const round = (value: number) => Number(value.toFixed(5));
  return [round(west), round(south), round(east), round(north)].join(',');
}

function exportUrl(base: string, tile: TileCoord, extra = ''): string {
  return (
    `${base}?bbox=${bboxOf(tile)}&bboxSR=4326&imageSR=3857&size=256,256` +
    `&format=png32&transparent=true&f=image${extra}`
  );
}

/** One 256 px tile of NOAA's current raster chart display (RNC replacement). */
export function noaaRasterTileUrl(tile: TileCoord): string {
  return exportUrl(NOAA_RASTER_EXPORT, tile);
}

/**
 * One transparent tile of a single ENC layer (depth contours or soundings),
 * taken from the usage band that matches the tile's zoom.
 */
export function encDepthTileUrl(tile: TileCoord, overlay: EncDepthOverlay): string {
  const band = noaaServiceFor(tile.z);
  const layer = overlay === 'contours' ? ENC_CONTOUR_LAYERS[band] : ENC_SOUNDING_LAYERS[band];
  return exportUrl(`${NOAA_EXPORT_BASE}/${band}/MapServer/export`, tile, `&layers=show:${layer}`);
}

/** Transparent isobath tiles; the cache stops at zoom 10. */
export const CONTOUR_TILE_URL =
  'https://tiles.arcgis.com/tiles/C8EMgrsFcRFL6LrL/arcgis/rest/services/GEBCO_contours/MapServer/tile/{z}/{y}/{x}';
export const CONTOUR_MAX_NATIVE_ZOOM = 10;
export const CONTOUR_SOURCE_NOTICE =
  'Contours generated from GEBCO’s global 15-arc-second terrain grid (nominally ~463 m north–south at the equator; actual source detail varies). Smoothed model contours, not chart-grade or for navigation. Vertical references may vary by region.';
