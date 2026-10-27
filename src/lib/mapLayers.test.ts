import { describe, expect, it } from 'vitest';
import {
  CONTOUR_MAX_NATIVE_ZOOM,
  CONTOUR_TILE_URL,
  CONTOUR_SOURCE_NOTICE,
  ENC_CONTOUR_LAYERS,
  ENC_CONTOUR_MIN_ZOOM,
  ENC_SOUNDING_LAYERS,
  SOUNDING_MIN_ZOOM,
  encDepthTileUrl,
  noaaRasterTileUrl,
} from './mapLayers';
import { tileBounds } from './noaaChart';

const HARBOUR = { z: 15, x: 9643, y: 12307 };
const COASTAL = { z: 10, x: 301, y: 384 };
const GENERAL = { z: 7, x: 37, y: 48 };

describe('ENC depth contours', () => {
  it('asks each usage band for its own contour layer', () => {
    expect(encDepthTileUrl(HARBOUR, 'contours')).toContain(
      `/enc_harbour/MapServer/export`,
    );
    expect(encDepthTileUrl(HARBOUR, 'contours')).toContain(
      `layers=show:${ENC_CONTOUR_LAYERS.enc_harbour}`,
    );
    expect(encDepthTileUrl(COASTAL, 'contours')).toContain(
      `layers=show:${ENC_CONTOUR_LAYERS.enc_coastal}`,
    );
    expect(encDepthTileUrl(GENERAL, 'contours')).toContain(
      `layers=show:${ENC_CONTOUR_LAYERS.enc_general}`,
    );
    // The bands must not reuse one band's layer id for another band's service.
    expect(ENC_CONTOUR_LAYERS.enc_harbour).not.toBe(ENC_CONTOUR_LAYERS.enc_coastal);
  });

  it('hands the world overview to GEBCO below zoom 9', () => {
    // The general band answers 200 but with no contours drawn, so using it
    // would make the toggle silently empty at overview zooms.
    expect(ENC_CONTOUR_MIN_ZOOM).toBe(9);
  });

  it('renders one transparent 256 px tile at the tile bbox', () => {
    const [south, west, north, east] = tileBounds(HARBOUR);
    const round = (value: number) => Number(value.toFixed(5));
    const url = encDepthTileUrl(HARBOUR, 'contours');
    expect(url).toContain(`bbox=${round(west)},${round(south)},${round(east)},${round(north)}`);
    expect(url).toContain('bboxSR=4326');
    expect(url).toContain('imageSR=3857');
    expect(url).toContain('size=256,256');
    expect(url).toContain('transparent=true');
    expect(url).toContain('format=png32');
    expect(url).toContain('f=image');
  });
});

describe('ENC spot soundings', () => {
  it('uses the sounding layer for the matching band', () => {
    expect(encDepthTileUrl(HARBOUR, 'soundings')).toContain(
      `layers=show:${ENC_SOUNDING_LAYERS.enc_harbour}`,
    );
    expect(encDepthTileUrl(COASTAL, 'soundings')).toContain(
      `layers=show:${ENC_SOUNDING_LAYERS.enc_coastal}`,
    );
    expect(encDepthTileUrl(GENERAL, 'soundings')).toContain(
      `layers=show:${ENC_SOUNDING_LAYERS.enc_general}`,
    );
    expect(encDepthTileUrl(HARBOUR, 'soundings')).not.toBe(
      encDepthTileUrl(HARBOUR, 'contours'),
    );
  });

  it('only turns on at harbour scale', () => {
    // The service renders no soundings in a 256 px tile below this zoom.
    expect(SOUNDING_MIN_ZOOM).toBe(15);
  });
});

describe('NOAA raster base', () => {
  it('stays separate from the ENC depth layers', () => {
    expect(noaaRasterTileUrl(HARBOUR)).toContain('MaritimeChartService');
    expect(noaaRasterTileUrl(HARBOUR)).not.toContain('layers=show');
    expect(noaaRasterTileUrl(HARBOUR)).not.toBe(encDepthTileUrl(HARBOUR, 'contours'));
  });
});

describe('global contour fallback', () => {
  it('documents source resolution and warns the contours are not chart-grade', () => {
    expect(CONTOUR_SOURCE_NOTICE).toContain('15-arc-second');
    expect(CONTOUR_SOURCE_NOTICE).toContain('not chart-grade');
    expect(CONTOUR_SOURCE_NOTICE).toContain('463 m');
    expect(CONTOUR_SOURCE_NOTICE).toContain('Vertical references may vary');
  });

  it('uses transparent GEBCO contour tiles with a 10-level native cap', () => {
    expect(CONTOUR_TILE_URL).toContain('GEBCO_contours');
    expect(CONTOUR_TILE_URL).toContain('/tile/{z}/{y}/{x}');
    // Leaflet keeps showing (upscaled) level-10 tiles past the cache limit, so
    // the toggle is never silently empty outside NOAA coverage.
    expect(CONTOUR_MAX_NATIVE_ZOOM).toBe(10);
  });
});
