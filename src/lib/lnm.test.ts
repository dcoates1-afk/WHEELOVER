import { describe, expect, it } from 'vitest';
import { lnmDateLabel, lnmRepresentativePoint, type LnmFeature } from './lnm';
import {
  extractLnmFilenames,
  geometryBounds,
  lnmCategoryLabel,
  lnmFileBase,
} from '../../server/lnmProxy';

function feature(geometry: LnmFeature['geometry']): LnmFeature {
  return {
    id: 'bridge:1',
    category: 'bridge',
    categoryLabel: 'Bridges',
    title: 'Test',
    waterway: null,
    subCategory: null,
    beginMs: null,
    endMs: null,
    description: '',
    geometry,
  };
}

describe('lnmRepresentativePoint', () => {
  it('returns a point itself, flipping GeoJSON lon/lat order', () => {
    expect(
      lnmRepresentativePoint(feature({ type: 'Point', coordinates: [-123.0, 48.5] })),
    ).toEqual([48.5, -123.0]);
  });

  it('uses the middle coordinate of a line', () => {
    expect(
      lnmRepresentativePoint(
        feature({
          type: 'LineString',
          coordinates: [
            [-123.0, 48.0],
            [-122.0, 49.0],
            [-121.0, 50.0],
          ],
        }),
      ),
    ).toEqual([49.0, -122.0]);
  });

  it('uses the bounding-box centre of a polygon ring', () => {
    expect(
      lnmRepresentativePoint(
        feature({
          type: 'Polygon',
          coordinates: [
            [
              [-123.0, 48.0],
              [-121.0, 48.0],
              [-121.0, 50.0],
              [-123.0, 50.0],
              [-123.0, 48.0],
            ],
          ],
        }),
      ),
    ).toEqual([49.0, -122.0]);
  });

  it('returns null for an empty geometry', () => {
    expect(
      lnmRepresentativePoint(feature({ type: 'Point', coordinates: [] })),
    ).toBeNull();
    expect(
      lnmRepresentativePoint(feature({ type: 'Point', coordinates: null })),
    ).toBeNull();
  });
});

describe('lnmDateLabel', () => {
  it('returns null without a date', () => {
    expect(lnmDateLabel(null)).toBeNull();
  });

  it('formats an epoch-ms date', () => {
    // 2024-09-13 12:00 UTC: the same calendar day in every timezone.
    expect(lnmDateLabel(1726228800000)).toBe('Sep 13, 2024');
  });
});

describe('geometryBounds', () => {
  it('walks nested coordinates and collections', () => {
    expect(
      geometryBounds({
        type: 'MultiPolygon',
        coordinates: [
          [
            [
              [-123.0, 48.0],
              [-121.0, 50.0],
            ],
          ],
        ],
      }),
    ).toEqual([48.0, -123.0, 50.0, -121.0]);
    expect(
      geometryBounds({
        type: 'GeometryCollection',
        geometries: [
          { type: 'Point', coordinates: [-123.0, 48.0] },
          { type: 'Point', coordinates: [-121.0, 50.0] },
        ],
      }),
    ).toEqual([48.0, -123.0, 50.0, -121.0]);
    expect(geometryBounds(null)).toBeNull();
    expect(geometryBounds({ type: 'Point', coordinates: [] })).toBeNull();
  });
});

describe('extractLnmFilenames', () => {
  it('keeps LNM files, drops Light List files, and dedupes', () => {
    const html = [
      '<a href="/sites/default/files/msi/bridge_1.geojson">Bridges</a>',
      '<a href="/sites/default/files/msi/bridge_1.geojson">Bridges</a>',
      '<a href="/sites/default/files/msi/lightListD01_1.geojson">Light List</a>',
      '<a href="/sites/default/files/msi/buoys_12.geojson">Buoys</a>',
    ].join('\n');
    expect(extractLnmFilenames(html)).toEqual(['bridge_1.geojson', 'buoys_12.geojson']);
  });
});

describe('lnm file labels', () => {
  it('strips chunk and geometry suffixes before labelling', () => {
    expect(lnmFileBase('bridgeLine_1.geojson')).toBe('bridge');
    expect(lnmFileBase('marConPoly_2.geojson')).toBe('marCon');
    expect(lnmFileBase('buoys_12.geojson')).toBe('buoys');
    expect(lnmCategoryLabel('bridgeLine_1.geojson')).toBe('Bridges');
    expect(lnmCategoryLabel('marConPoly_2.geojson')).toBe('Marine Construction');
    expect(lnmCategoryLabel('tessAdvPoly_1.geojson')).toBe('TESS Advisory');
    expect(lnmCategoryLabel('discFedAidCor_1.geojson')).toBe(
      'Discrepant Federal Aids Corrected',
    );
  });
});
