import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import L from 'leaflet';
import lanes from '../data/lanes.json';
import { SHIP_REPORTING_SYSTEMS } from '../lib/shipReportingSystems';
import type { Pin } from '../lib/pins';
import type { Track } from '../lib/tracks';
import type { RouteWaypoint } from '../lib/routes';
import type { MobRecord } from '../lib/mob';
import type { TideStation } from '../lib/tides';
import type { NotmarWarning } from '../lib/notmars';
import { notmarAreaName } from '../lib/notmars';
import type { LnmFeature } from '../lib/lnm';
import { lnmDateLabel } from '../lib/lnm';
import { escapeXml } from '../lib/gpx';
import { describeTssFeature, tssGeometryParts, TSS_SOURCE_ATTRIBUTION, type MarineFeature } from '../lib/marineDb';
import { describeBridge, type BridgeRow } from '../lib/bridges';
import { clearancesForFeature, loadClearanceDatasets, type ClearanceDatasets } from '../lib/clearances';
import { coalesceBridges, type ChartFeature } from '../lib/overpass';
import { MARINE_AREA_GROUP_META } from '../lib/marineAreas';
import { markDetailLabel } from '../../shared/mark-detail-core.mjs';
import { distanceMeters, lightSectorArc, lightSectorDisplayRadius, lightSectorDrawLimits, mirrorLightSectorBearings } from '../../shared/navaid-core.mjs';
import type { ProtectedAreaFeature } from '../lib/protectedAreas';
import { ialaRegion, quickInfo, symbolForMark } from '../lib/navaids';
import { vesselLabel } from '../lib/ais';
import {
  selectedVesselLabelHtml,
  vesselIconHeight,
  vesselIconSize,
  vesselIconSvg,
  vesselMarkerRotation,
  vesselTooltipHtml,
} from '../lib/aisVessel';
import { loadNoaaTile, noaaTileUrl, tileBounds } from '../lib/noaaChart';
import { contourManifestCoversBounds, loadContoursForBounds, readContourManifest, type ContourManifest } from '../lib/marineContours';
import {
  CONTOUR_ATTRIBUTION,
  CONTOUR_MAX_NATIVE_ZOOM,
  CONTOUR_TILE_URL,
  ENC_CONTOUR_MIN_ZOOM,
  ENC_DEPTH_ATTRIBUTION,
  NAUTICAL_ATTRIBUTION,
  NOAA_RASTER_ATTRIBUTION,
  RELIEF_ATTRIBUTION,
  REPORTING_SYSTEM_ATTRIBUTION,
  SOUNDING_ATTRIBUTION,
  SOUNDING_MIN_ZOOM,
  encDepthTileUrl,
  noaaRasterTileUrl,
} from '../lib/mapLayers';
import type { Navaid } from '../lib/navaids';
import type { Poi } from '../lib/pois';
import { POI_GROUPS } from '../lib/poiGroups';
import { poiIconSvg, poiPopupContent, visiblePois } from '../lib/pois';
import {
  DEPTH_LABEL_ATTRIBUTION,
  DEPTH_LABEL_MIN_ZOOM,
  fetchDepthSamples,
  formatDepth,
  sampleOffsets,
} from '../lib/depthLabels';
import type { ChartPreferences } from '../lib/chartPreferences';
import type { VoyageWatch } from '../lib/voyageWatch';
import { formatCoordinate } from '../lib/coordinates';
import { depthUnitLabel, formatDistance } from '../lib/settings';
import type { CoordinateFormat, DepthUnit, DistanceUnit } from '../lib/settings';
import type { GeoFix } from '../hooks/useGeolocation';
import type { AisVessel } from '../lib/ais';

export interface MapHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  flyTo: (lat: number, lon: number, zoom?: number) => void;
  getCenter: () => [number, number] | null;
  getBounds: () => [number, number, number, number] | null;
  /** Ask the active base to re-request its tiles (e.g. after a chart download). */
  refreshBase: () => void;
}

const TRANSPARENT_TILE =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

function escapePopupText(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]!);
}

function pointInRing(lon: number, lat: number, ring: GeoJSON.Position[]): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[previous];
    if ((y1 > lat) !== (y2 > lat) && lon < ((x2 - x1) * (lat - y1)) / (y2 - y1) + x1) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInProtectedGeometry(lon: number, lat: number, geometry: GeoJSON.Geometry): boolean {
  const polygons = geometry.type === 'Polygon'
    ? [geometry.coordinates]
    : geometry.type === 'MultiPolygon'
      ? geometry.coordinates
      : [];
  return polygons.some((rings) =>
    rings.length > 0 && pointInRing(lon, lat, rings[0]) && !rings.slice(1).some((hole) => pointInRing(lon, lat, hole)),
  );
}

function sectorColour(value?: string): string {
  const colour = value?.split(/[;,]/)[0]?.trim().toLowerCase();
  if (colour === 'red') return '#e23b3b';
  if (colour === 'green') return '#26a65b';
  // A white light is drawn yellow, the way OSM nautical styles do: white
  // sectors would otherwise disappear into the chart and read as no sector.
  if (colour === 'white') return '#ffe066';
  if (colour === 'yellow') return '#f4c531';
  if (colour === 'orange') return '#f28c28';
  if (colour === 'blue') return '#3d9bff';
  if (colour === 'magenta') return '#e14bd1';
  if (colour === 'amber') return '#ffbf00';
  return '#d9a6ff';
}

function addLightSectors(group: L.LayerGroup, mark: Navaid, zoom: number): void {
  for (const sector of mark.lightSectors ?? []) {
    // Charted limits define a sector; a directional light defines only an
    // orientation and is drawn as a narrow beam. Mark shards store the raw
    // records, so this is resolved here rather than only when parsing OSM.
    const limits = lightSectorDrawLimits(sector);
    if (!limits) continue;
    const [start, end] = limits;
    const span = Math.abs(end - start) === 360 ? 360 : (end - start + 360) % 360;
    if (span <= 0 || span > 360) continue;
    const metresPerPixel = 40_075_016.686 * Math.max(0.01, Math.cos(mark.lat * Math.PI / 180)) / (256 * 2 ** zoom);
    const displayRadius = lightSectorDisplayRadius(zoom, metresPerPixel);
    const rangeNm = Number(sector.range);
    const radius = Number.isFinite(rangeNm) && rangeNm > 0 ? Math.min(displayRadius, rangeNm * 1852) : displayRadius;
    // Flip the sector limits east-to-west (left-right) only: a sector
    // charted north-east draws north-west, and one charted south-east
    // draws south-west. North and south are untouched — this is a mirror,
    // not a 180-degree rotation, so the latitude is never flipped.
    const mirrored = mirrorLightSectorBearings(start, end);
    if (!mirrored) continue;
    const arc = lightSectorArc(mark.lat, mark.lon, mirrored[0], mirrored[1], radius);
    if (arc.length < 2) continue;
    const colour = sectorColour(sector.colour ?? mark.lightColour ?? undefined);
    L.polygon([[mark.lat, mark.lon], ...arc], {
      color: colour,
      weight: 0,
      fillColor: colour,
      fillOpacity: 0.1,
      interactive: false,
      className: 'marnav-light-sector-fill',
    }).addTo(group);
    L.polyline([[mark.lat, mark.lon], arc[0]], {
      color: colour, weight: 1.15, opacity: 0.78, interactive: false, className: 'marnav-light-sector-edge',
    }).addTo(group);
    L.polyline(arc, {
      color: colour, weight: 1.2, opacity: 0.82, interactive: false, className: 'marnav-light-sector-arc',
    }).addTo(group);
    L.polyline([[mark.lat, mark.lon], arc.at(-1)!], {
      color: colour, weight: 1.15, opacity: 0.78, interactive: false, className: 'marnav-light-sector-edge',
    }).addTo(group);
  }
}

export interface MapCanvasProps {
  preferences: ChartPreferences;
  initialCenter?: [number, number];
  initialZoom?: number;
  marks: Navaid[];
  pois: Poi[];
  zoom: number;
  onSelectMark: (mark: Navaid) => void;
  onSelectVessel: (vessel: AisVessel) => void;
  onViewChange: (bounds: [number, number, number, number], zoom: number, center: [number, number]) => void;
  /** The navigator panned or zoomed; automatic centring must stand down. */
  onUserMove?: () => void;
  onNoaaCoverageChange: (covered: boolean) => void;
  onMapClick: (lat: number, lon: number) => void;
  fix: GeoFix | null;
  aisVessels: AisVessel[];
  /** AIS target the navigator picked, kept picked out on the chart. */
  selectedVesselMmsi?: number | null;
  /** Place picked from destination search, pinned on the chart. */
  searchPin?: { lat: number; lon: number; name: string } | null;
  /** The search pin was tapped; the app clears it. */
  onSearchPinClear?: () => void;
  /** The navigator's own place pins, kept on this device. */
  pins?: Pin[];
  /** Pin whose details the panel is editing. */
  selectedPinId?: string | null;
  /** A pin was tapped on the chart. */
  onSelectPin?: (pin: Pin) => void;
  /** The track currently being recorded, drawn in orange. */
  activeTrack?: Track | null;
  /** A saved track the user chose to show, drawn in cyan. */
  shownTrack?: Track | null;
  /** Manual route waypoints, drawn as a dashed line with numbered dots. */
  routeWaypoints?: RouteWaypoint[];
  /** A route waypoint was dragged to a new position. */
  onRouteWaypointMove?: (index: number, lat: number, lon: number) => void;
  /** Man overboard position, drawn as a red marker with a line from own ship. */
  mob?: MobRecord | null;
  /** NOAA harmonic stations for the tide layer; null when the layer is off. */
  tideStations?: TideStation[] | null;
  /** A tide station marker was tapped. */
  onSelectTideStation?: (station: TideStation) => void;
  /** In-force NGA broadcast warnings; one marker per parsed position. */
  warnings?: NotmarWarning[] | null;
  /** USCG Local Notices to Mariners in the current view; null when the layer is off. */
  lnm?: LnmFeature[] | null;
  /** Anchor circle and course to steer, set from the menu. */
  watch: VoyageWatch;
  /** Grid the cursor readout is written in. */
  coordinateFormat?: CoordinateFormat;
  /** Unit the anchor circle's radius label is written in. */
  distanceUnit?: DistanceUnit;
  /** Unit the depth numbers and contour readouts are written in. */
  depthUnit?: DepthUnit;
  marineFeatures: { ferries: MarineFeature[]; bridges: MarineFeature[]; tss: MarineFeature[] } | null;
  chartFeatures: ChartFeature[];
  protectedAreaFeatures: ProtectedAreaFeature[];
}

const US_REGIONS: [number, number, number, number][] = [
  [-125.5, 24.0, -66.0, 50.0], // CONUS
  [-171.0, 51.0, -129.0, 72.0], // Alaska
  [-161.5, 18.5, -154.0, 23.0], // Hawaii
  [-68.0, 17.0, -64.5, 19.0], // Puerto Rico / USVI
];

export function isUsWaters(lat: number, lon: number): boolean {
  return US_REGIONS.some(
    ([west, south, east, north]) => lat >= south && lat <= north && lon >= west && lon <= east,
  );
}

/**
 * NOAA ENC Direct renders raster charts through ArcGIS MapServer/export. The
 * service is split into scale bands, so each tile asks the band appropriate to
 * the zoom level. (The retired MCS/NOAAChartDisplay endpoint still answers 200
 * with a blank image, which is why it is not used here.)
 */
/**
 * One ENC Direct raster band. The bands are usage bands, not plain scales, so
 * the chart is drawn as a stack: coarse opaque coverage underneath, finer bands
 * transparent on top. That way a harbour chart adds detail where it exists
 * without blacking out the rest of the area.
 */
export const NOAA_ATTRIBUTION = 'NOAA ENC Direct (public domain)';

const NoaaChartLayer = L.GridLayer.extend({
  createTile(this: L.GridLayer, coords: L.Coords): HTMLElement {
    const tile = document.createElement('img');
    tile.alt = '';
    tile.setAttribute('role', 'presentation');
    // Chart paper shows through until the tile resolves, so a slow export reads
    // as "not drawn yet" rather than a broken image.
    tile.src = TRANSPARENT_TILE;
    const [south, west, north, east] = tileBounds(coords);
    if (!isUsWaters((south + north) / 2, (west + east) / 2)) {
      // Outside NOAA coverage there is nothing to draw, and the export service
      // answers with a non-image body that the browser blocks. Skip the request.
      return tile;
    }
    loadNoaaTile(noaaTileUrl(coords))
      .then((objectUrl) => {
        tile.src = objectUrl;
        tile.addEventListener(
          'load',
          () => URL.revokeObjectURL(objectUrl),
          { once: true },
        );
      })
      .catch(() => {
        // Leave the chart paper: a failed tile is not an error state.
      });
    return tile;
  },
}) as unknown as new (options?: L.GridLayerOptions) => L.GridLayer;

export function createNoaaChart(): L.GridLayer {
  return new NoaaChartLayer({ zIndex: 3, attribution: NOAA_ATTRIBUTION });
}

interface ExportChartOptions {
  urlFor: (tile: { z: number; x: number; y: number }) => string;
  covered: (lat: number, lon: number) => boolean;
  attribution: string;
  /** Overlays join an existing pane; base charts keep the tile pane. */
  pane?: string;
  opacity?: number;
  minZoom?: number;
  zIndex?: number;
}

/**
 * A chart rendered by an ArcGIS export endpoint, one image per tile. NOAA's
 * raster display and its individual ENC layers all work this way; none offers
 * an XYZ cache, so each tile is drawn on demand.
 */
function createExportChart(options: ExportChartOptions): L.GridLayer {
  const { urlFor, covered, attribution, pane, opacity, minZoom, zIndex = 3 } = options;
  const ExportChartLayer = L.GridLayer.extend({
    createTile(this: L.GridLayer, coords: L.Coords): HTMLElement {
      const tile = document.createElement('img');
      tile.alt = '';
      tile.setAttribute('role', 'presentation');
      tile.src = TRANSPARENT_TILE;
      const [south, west, north, east] = tileBounds(coords);
      if (!covered((south + north) / 2, (west + east) / 2)) return tile;
      // One retry, then hide the tile so a failed export reads as chart paper
      // rather than a broken-image glyph.
      tile.onerror = () => {
        if (!tile.dataset.retried) {
          tile.dataset.retried = '1';
          setTimeout(() => {
            tile.src = urlFor(coords);
          }, 1200);
        } else {
          tile.style.visibility = 'hidden';
        }
      };
      tile.src = urlFor(coords);
      return tile;
    },
  });
  return new (ExportChartLayer as unknown as new (options?: L.GridLayerOptions) => L.GridLayer)({
    zIndex,
    attribution,
    pane,
    opacity,
    minZoom,
  });
}

/**
 * Ferry routes and traffic separation schemes, drawn in their own pane above
 * the chart and its depth layers but below the marks.
 *
 * These are thin, dashed lines over busy water, so the ink follows paper-chart
 * practice: ferries in a bright dashed cyan, TSS lanes in magenta, separation
 * zones in amber. TSS geometry is drawn as outlines only — the same scheme is
 * mapped as lanes in one place and as areas in another, so any fill tinted
 * some schemes and left others plain. The pane carries a dark halo (see
 * styles.css) because the same stroke has to read over pale NOAA paper, green
 * OSM land and dark satellite water.
 */
export const LANE_ATTRIBUTION = 'Ferry routes: OpenStreetMap (ODbL) · TSS: OpenStreetMap (ODbL), Shom, Fisheries and Oceans Canada, Hong Kong Marine Department';

function featureBounds(path: [number, number][]): [number, number, number, number] {
  const lats = path.map(([lat]) => lat);
  const lons = path.map(([, lon]) => lon);
  return [Math.min(...lats), Math.min(...lons), Math.max(...lats), Math.max(...lons)];
}

function ferryStyle(): L.PolylineOptions {
  return {
    color: '#8ff0ff',
    weight: 2.6,
    opacity: 0.95,
    dashArray: '9 7',
    lineCap: 'round',
    pane: 'lanes',
  };
}

/** TSS is drawn as ink: every scheme type is an outline, never a filled area. */
function tssStyle(type: string): L.PolylineOptions {
  return { ...tssStroke(type), fill: false, pane: 'lanes' };
}

function tssStroke(type: string): L.PolylineOptions {
  switch (type) {
    case 'separation_lane':
      return {
        color: '#ff7ad1',
        weight: 2.2,
        opacity: 0.95,
      };
    case 'separation_zone':
      return {
        color: '#ffd24a',
        weight: 1.9,
        opacity: 0.9,
        dashArray: '4 5',
      };
    case 'separation_boundary':
      return { color: '#f4faff', weight: 1.8, opacity: 0.9, dashArray: '12 7' };
    case 'separation_line':
      return { color: '#ff7ad1', weight: 1.9, opacity: 0.9, dashArray: '10 6' };
    // Crossing and roundabout features used to fall through to the pale default
    // below, which is all but invisible over a light chart, so these mapped
    // schemes read as missing lanes.
    case 'separation_crossing':
      return {
        color: '#9ef27a',
        weight: 2,
        opacity: 0.95,
        dashArray: '6 4',
      };
    case 'separation_roundabout':
      return {
        color: '#7ad9ff',
        weight: 2,
        opacity: 0.95,
        dashArray: '8 5',
      };
    default:
      return { color: '#e2f2fb', weight: 1.5, opacity: 0.8, dashArray: '2 6' };
  }
}

export const MapCanvas = forwardRef<MapHandle, MapCanvasProps>(function MapCanvas(props, ref) {
  // Units the overlays and watch readouts are written in, read by several effects.
  const distanceUnit = props.distanceUnit;
  const depthUnit = props.depthUnit;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const basesRef = useRef<Record<string, L.Layer>>({});
  const seaRef = useRef<L.TileLayer | null>(null);
  const depthSyncRef = useRef<(() => void) | null>(null);
  const depthLabelsRef = useRef<L.LayerGroup | null>(null);
  const contourVectorsRef = useRef<L.LayerGroup | null>(null);
  const contourCoverageRef = useRef(false);
  const contourRequestRef = useRef<AbortController | null>(null);
  const groupsRef = useRef<Partial<Record<'navaids' | 'ferries' | 'tss' | 'ais' | 'pois' | 'reportingSystems' | 'bridges' | 'protectedAreas', L.LayerGroup>>>({});
  const vesselRef = useRef<L.Marker | null>(null);
  const searchPinRef = useRef<L.CircleMarker | null>(null);
  const pinsGroupRef = useRef<L.LayerGroup | null>(null);
  const watchRef = useRef<L.LayerGroup | null>(null);
  const aisMarkersRef = useRef(
    new Map<
      number,
      { marker: L.Marker; vessel: AisVessel; iconHtml: string; label: string; labelHtml: string }
    >(),
  );
  const handlers = useRef(props);
  handlers.current = props;
  // Hover card is drawn as our own overlay, not a Leaflet tooltip: Leaflet
  // centres a tooltip on the marker and lets it hang off the screen edge, which
  // is useless on a phone-sized chart. This card is clamped to the map.
  const [hovered, setHovered] = useState<number | null>(null);
  // Credits live on the disclaimer page now, so the corner the attribution
  // control used to hold reads out the scale and the cursor instead.
  const [cursor, setCursor] = useState<{ lat: number; lon: number } | null>(null);
  const [liveZoom, setLiveZoom] = useState(props.initialZoom ?? 11);
  const [clearanceDatasets, setClearanceDatasets] = useState<ClearanceDatasets | null>(null);
  /** Current view bounds, tracked so the tide layer draws only visible stations. */
  const [tideBounds, setTideBounds] = useState<[number, number, number, number] | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: props.initialCenter ?? [50.76, -1.2],
      zoom: props.initialZoom ?? 11,
      zoomControl: false,
      // Attribution is carried by the disclaimer page rather than a chart
      // overlay; the bottom-right corner is used for the scale/cursor readout.
      attributionControl: false,
      doubleClickZoom: true,
      touchZoom: true,
      worldCopyJump: true,
    });
    mapRef.current = map;

    const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    });
    const satellite = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 19, attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics' },
    );
    const nautical = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 19, maxNativeZoom: 16, attribution: NAUTICAL_ATTRIBUTION },
    );
    const relief = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 19, maxNativeZoom: 16, attribution: RELIEF_ATTRIBUTION },
    );
    const noaa = createNoaaChart();
    const rnc = createExportChart({
      urlFor: noaaRasterTileUrl,
      covered: isUsWaters,
      attribution: NOAA_RASTER_ATTRIBUTION,
    });
    basesRef.current = { osm, satellite, nautical, relief, noaa, rnc };
    osm.addTo(map);

    const sea = L.tileLayer('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', {
      maxZoom: 18,
      opacity: 1,
      zIndex: 400,
      attribution: 'Seamarks &copy; OpenSeaMap (CC-BY-SA)',
    });
    // Depth is an overlay, not a base. Contours and soundings get their own
    // panes so they sit above the chart and below the seamark raster and marks.
    map.createPane('contours').style.zIndex = '260';
    map.createPane('contour-vectors').style.zIndex = '265';
    map.createPane('soundings').style.zIndex = '270';
    map.createPane('depth-labels').style.zIndex = '280';
    // Routes sit above every chart layer and below the marks, so a ferry line
    // or lane edge is never buried under an ENC isobath or a depth number.
    map.createPane('lanes').style.zIndex = '450';
    // Global fallback: the GEBCO contour cache stops at zoom 10, so Leaflet
    // upscales those tiles at closer zooms instead of hiding the overlay.
    const gebcoContours = L.tileLayer(CONTOUR_TILE_URL, {
      maxNativeZoom: CONTOUR_MAX_NATIVE_ZOOM,
      opacity: 0.85,
      pane: 'contours',
      errorTileUrl: TRANSPARENT_TILE,
      attribution: CONTOUR_ATTRIBUTION,
    });
    // US waters get the charted ENC isobaths and spot soundings instead: this
    // is the same source an ECDIS reads, with the contour interval of the
    // harbour/coastal/general band rather than a global 10 m grid.
    const encContours = createExportChart({
      urlFor: (tile) => encDepthTileUrl(tile, 'contours'),
      covered: isUsWaters,
      attribution: ENC_DEPTH_ATTRIBUTION,
      pane: 'contours',
      opacity: 0.9,
    });
    const localContourVectors = L.layerGroup();
    contourVectorsRef.current = localContourVectors;
    const soundings = createExportChart({
      urlFor: (tile) => encDepthTileUrl(tile, 'soundings'),
      covered: isUsWaters,
      attribution: SOUNDING_ATTRIBUTION,
      pane: 'soundings',
      opacity: 0.95,
      minZoom: SOUNDING_MIN_ZOOM,
    });
    const navaids = L.layerGroup();
    const ferries = L.layerGroup();
    const tss = L.layerGroup();
    const ais = L.layerGroup();
    const pois = L.layerGroup();
    const reportingSystems = L.layerGroup();
    const bridges = L.layerGroup();
    const protectedAreas = L.layerGroup();
    const depthLabels = L.layerGroup();

    seaRef.current = sea;
    depthLabelsRef.current = depthLabels;
    groupsRef.current = { navaids, ferries, tss, ais, pois, reportingSystems, bridges, protectedAreas };

    // ENC contours replace GEBCO inside US waters; the global layer would only
    // double-draw the same water with a coarser interval. The choice follows
    // the chart centre on every settled view. Below zoom 9 the ENC export omits
    // contours entirely, so the global layer carries the overview.
    const syncDepth = () => {
      const active = handlers.current.preferences.overlays;
      const centre = map.getCenter();
      const useEnc =
        isUsWaters(centre.lat, centre.lng) && map.getZoom() >= ENC_CONTOUR_MIN_ZOOM;
      const setWanted = (layer: L.Layer, wanted: boolean) => {
        if (wanted) {
          if (!map.hasLayer(layer)) layer.addTo(map);
        } else if (map.hasLayer(layer)) {
          map.removeLayer(layer);
        }
      };
      setWanted(gebcoContours, active.contours && !useEnc && !contourCoverageRef.current);
      setWanted(encContours, active.contours && useEnc);
      setWanted(localContourVectors, active.contours && contourCoverageRef.current && !useEnc);
      setWanted(soundings, active.soundings);
    };
    depthSyncRef.current = syncDepth;
    map.on('moveend', syncDepth);

    const emitView = () => {
      const centre = map.getCenter();
      const bounds = map.getBounds();
      const bbox: [number, number, number, number] = [
        bounds.getSouth(),
        bounds.getWest(),
        bounds.getNorth(),
        bounds.getEast(),
      ];
      handlers.current.onViewChange(bbox, map.getZoom(), [centre.lat, centre.lng]);
      handlers.current.onNoaaCoverageChange(isUsWaters(centre.lat, centre.lng));
      setTideBounds(bbox);
    };

    map.on('moveend', emitView);
    map.on('dragstart', () => handlers.current.onUserMove?.());
    map.on('zoomstart', () => handlers.current.onUserMove?.());
    map.on('movestart zoomstart click', () => setHovered(null));
    map.on('click', (event: L.LeafletMouseEvent) => {
      handlers.current.onMapClick(event.latlng.lat, event.latlng.lng);
    });
    emitView();

    // If the stylesheets were still loading when the map was created, the
    // container can read as zero-sized and Leaflet never recovers on its
    // own. One sizing pass on the next frame covers slow first loads.
    requestAnimationFrame(() => {
      map.invalidateSize();
    });

    return () => {
      map.off();
      map.remove();
      mapRef.current = null;
      groupsRef.current = {};
      seaRef.current = null;
      depthSyncRef.current = null;
      basesRef.current = {};
      vesselRef.current = null;
      watchRef.current = null;
      aisMarkersRef.current.clear();
      depthLabelsRef.current = null;
      contourVectorsRef.current = null;
      contourCoverageRef.current = false;
      contourRequestRef.current?.abort();
      contourRequestRef.current = null;
    };
  }, []);

  // Base map selection.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const layer of Object.values(basesRef.current)) {
      if (map.hasLayer(layer)) map.removeLayer(layer);
    }
    const next = basesRef.current[props.preferences.base];
    if (next && !map.hasLayer(next)) {
      next.addTo(map);
      if (next instanceof L.GridLayer) next.setZIndex(3);
    }
    // Chart bands cover ports and approaches, not every square mile of water.
    // Show blank chart paper rather than a black hole where a band has no tile.
    const paper = ['noaa', 'rnc'].includes(props.preferences.base);
    map.getContainer().classList.toggle('noaa-base', paper);
  }, [props.preferences.base]);

  // Overlay toggles.
  const overlays = props.preferences.overlays;
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const sea = seaRef.current;
    if (!sea) return;
    if (overlays.openseamap) {
      if (!map.hasLayer(sea)) sea.addTo(map);
    } else if (map.hasLayer(sea)) {
      map.removeLayer(sea);
    }
  }, [overlays.openseamap]);

  // Contours switch source by coverage, so the whole depth stack re-syncs.
  useEffect(() => {
    depthSyncRef.current?.();
  }, [overlays.contours, overlays.soundings]);

  // Crisp local vector contours from the locally generated GEBCO/EMODnet archive.
  // If no archive is installed, or the current view is outside its coverage, the
  // existing GEBCO tiled fallback remains active.
  const contoursOn = props.preferences.overlays.contours;
  useEffect(() => {
    const map = mapRef.current;
    const group = contourVectorsRef.current;
    if (!map || !group) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let requestId = 0;
    let manifest: ContourManifest | null = null;

    const refresh = async () => {
      const current = ++requestId;
      contourRequestRef.current?.abort();
      contourRequestRef.current = null;
      if (!contoursOn) {
        group.clearLayers();
        if (map.hasLayer(group)) map.removeLayer(group);
        contourCoverageRef.current = false;
        depthSyncRef.current?.();
        return;
      }
      if (!manifest) {
        contourCoverageRef.current = false;
        depthSyncRef.current?.();
        return;
      }
      const view = map.getBounds();
      const bounds: [number, number, number, number] = [
        Math.max(-90, view.getSouth()),
        view.getWest(),
        Math.min(90, view.getNorth()),
        view.getEast(),
      ];
      const clippedView: [number, number, number, number] = [
        bounds[0],
        Math.max(-180, bounds[1]),
        bounds[2],
        Math.min(180, bounds[3]),
      ];
      const hasLocalCoverage =
        bounds[0] < bounds[2] &&
        clippedView[1] < clippedView[3] &&
        contourManifestCoversBounds(manifest, clippedView);
      contourCoverageRef.current = hasLocalCoverage;
      if (hasLocalCoverage) {
        const overlapsNoaa = isUsWaters(bounds[0], clippedView[1]) || isUsWaters(bounds[0], clippedView[3]) ||
          isUsWaters(bounds[2], clippedView[1]) || isUsWaters(bounds[2], clippedView[3]) ||
          isUsWaters((bounds[0] + bounds[2]) / 2, (clippedView[1] + clippedView[3]) / 2);
        if (overlapsNoaa && map.getZoom() >= ENC_CONTOUR_MIN_ZOOM) {
          contourCoverageRef.current = false;
          depthSyncRef.current?.();
          group.clearLayers();
          if (map.hasLayer(group)) map.removeLayer(group);
          return;
        }
      }
      depthSyncRef.current?.();
      if (!hasLocalCoverage) {
        group.clearLayers();
        if (map.hasLayer(group)) map.removeLayer(group);
        return;
      }
      const center = map.getCenter();
      const useEnc = isUsWaters(center.lat, center.lng) && map.getZoom() >= ENC_CONTOUR_MIN_ZOOM;
      if (useEnc) {
        group.clearLayers();
        if (map.hasLayer(group)) map.removeLayer(group);
        contourCoverageRef.current = false;
        depthSyncRef.current?.();
        return;
      }
      const controller = new AbortController();
      contourRequestRef.current = controller;
      try {
        const features = await loadContoursForBounds(manifest, clippedView, undefined, controller.signal);
        if (disposed || current !== requestId || controller.signal.aborted) return;
        group.clearLayers();
        for (const feature of features) {
          const depth = Math.abs(feature.properties.elev_m);
          const source = String(feature.properties._source ?? 'bathymetry grid');
          const major = depth <= 30 || Math.round(depth) >= 100 && Math.round(depth) % 100 === 0;
          const layer = L.geoJSON(feature as GeoJSON.Feature, {
            pane: 'contour-vectors',
            style: {
              color: source.includes('EMODnet') ? '#00b8d4' : '#00b889',
              // Keep the painted stroke crisp but expand the SVG hit target,
              // so mouse/touch hover doesn't require pixel-perfect aiming.
              weight: major ? 2 : 1.5,
              opacity: 1,
              lineCap: 'round',
              lineJoin: 'round',
              interactive: false,
              className: 'contour-stroke',
            },
          });
          const hitTarget = L.geoJSON(feature as GeoJSON.Feature, {
            pane: 'contour-vectors',
            style: {
              color: '#000000',
              weight: 16,
              opacity: 0,
              fill: false,
              interactive: true,
              className: 'contour-hit-target',
            },
          });
          const contourText = `${formatDepth(depth, depthUnit)} ${depthUnitLabel(depthUnit ?? 'm')}`;
          hitTarget.bindTooltip(contourText, {
            sticky: true,
            direction: 'top',
            className: 'contour-label',
          });
          // A click/tap opens the same concise depth label as a popup too,
          // since hover tooltips are not a reliable interaction on touchscreens.
          hitTarget.bindPopup(contourText, {
            className: 'contour-depth-popup',
            closeButton: false,
            autoPan: false,
          });
          group.addLayer(layer);
          group.addLayer(hitTarget);
        }
        if (features.length > 0 && !map.hasLayer(group)) group.addTo(map);
        if (features.length === 0) contourCoverageRef.current = false;
        depthSyncRef.current?.();
      } catch (error) {
        if (!disposed && current === requestId && !controller.signal.aborted) {
          group.clearLayers();
          if (map.hasLayer(group)) map.removeLayer(group);
          contourCoverageRef.current = false;
          console.warn('[WHEELOVER] local contour query failed; using GEBCO tile fallback', error);
          depthSyncRef.current?.();
        }
      }
    };

    const schedule = () => {
      contourRequestRef.current?.abort();
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 180);
    };
    map.on('moveend zoomend', schedule);
    void readContourManifest()
      .then((loaded) => {
        if (disposed) return;
        manifest = loaded;
        void refresh();
      })
      .catch(() => {
        // No local archive is the expected state before the user builds it.
      });
    void refresh();

    return () => {
      disposed = true;
      requestId += 1;
      contourRequestRef.current?.abort();
      contourRequestRef.current = null;
      if (timer) clearTimeout(timer);
      map.off('moveend zoomend', schedule);
      group.clearLayers();
      if (map.hasLayer(group)) map.removeLayer(group);
      contourCoverageRef.current = false;
      depthSyncRef.current?.();
    };
  }, [contoursOn, depthUnit]);

  // Numeric depth labels, sampled from the seabed grid for the current view.
  // GEBCO answers in one batch; inside EMODnet coverage the finer European DTM
  // replaces the coarse values as each point resolves.
  const depthLabelsOn = props.preferences.overlays.depthLabels;
  useEffect(() => {
    const map = mapRef.current;
    const group = depthLabelsRef.current;
    if (!map || !group) return;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const markers = new Map<string, L.Marker>();

    const clear = () => {
      group.clearLayers();
      markers.clear();
    };

    const refresh = () => {
      clear();
      if (!handlers.current.preferences.overlays.depthLabels) return;
      if (map.getZoom() < DEPTH_LABEL_MIN_ZOOM) return;
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      const size = map.getSize();
      const points = sampleOffsets(size.x, size.y).map(([x, y]) => {
        const latlng = map.containerPointToLatLng(L.point(x, y));
        return { lat: latlng.lat, lon: latlng.lng };
      });
      void fetchDepthSamples(points, map.getZoom(), signal, (point, sample) => {
        if (signal.aborted) return;
        const key = `${point.lat.toFixed(5)}:${point.lon.toFixed(5)}`;
        const text = formatDepth(sample.depth, depthUnit);
        const existing = markers.get(key);
        if (!text) {
          if (existing) {
            group.removeLayer(existing);
            markers.delete(key);
          }
          return;
        }
        const source = sample.source === 'emodnet' ? 'EMODnet DTM' : 'GEBCO grid';
        const unitText = depthUnitLabel(depthUnit ?? 'm');
        const html = `<span class="marnav-depth-num" title="Modelled depth ${text} ${unitText} · ${source}">${text}</span>`;
        const icon = L.divIcon({
          className: 'marnav-depth-wrap',
          html,
          iconSize: [46, 18],
          iconAnchor: [23, 9],
        });
        if (existing) {
          existing.setIcon(icon);
        } else {
          const marker = L.marker([point.lat, point.lon], {
            icon,
            interactive: false,
            keyboard: false,
            pane: 'depth-labels',
          });
          marker.addTo(group);
          markers.set(key, marker);
        }
      });
    };

    const debounced = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(refresh, 260);
    };

    if (depthLabelsOn) {
      group.addTo(map);
      map.attributionControl?.addAttribution(DEPTH_LABEL_ATTRIBUTION);
      map.on('moveend', debounced);
      map.on('zoomend', debounced);
      refresh();
    } else {
      clear();
      if (map.hasLayer(group)) map.removeLayer(group);
      map.attributionControl?.removeAttribution(DEPTH_LABEL_ATTRIBUTION);
    }

    return () => {
      if (timer) clearTimeout(timer);
      controller?.abort();
      map.off('moveend', debounced);
      map.off('zoomend', debounced);
      clear();
      if (map.hasLayer(group)) map.removeLayer(group);
      map.attributionControl?.removeAttribution(DEPTH_LABEL_ATTRIBUTION);
    };
  }, [depthLabelsOn, depthUnit]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const key of ['ferries', 'tss', 'ais', 'pois'] as const) {
      const group = groupsRef.current[key];
      if (!group) continue;
      const wanted = overlays[key];
      if (wanted) {
        if (!map.hasLayer(group)) group.addTo(map);
      } else if (map.hasLayer(group)) {
        map.removeLayer(group);
      }
    }
    // Navaids and the curated reporting systems have no master switch any
    // more: they are always drawn, with navaids filtered per type by the
    // Legend & mark filters.
    const navaids = groupsRef.current.navaids;
    if (navaids && !map.hasLayer(navaids)) navaids.addTo(map);
    const reportingSystems = groupsRef.current.reportingSystems;
    if (reportingSystems && !map.hasLayer(reportingSystems)) reportingSystems.addTo(map);
    // The lane geometry is OpenStreetMap data, so its credit follows the
    // toggles rather than sitting on the chart when nothing is drawn.
    const control = map.attributionControl;
    if (control) {
      control.removeAttribution(LANE_ATTRIBUTION);
      control.removeAttribution(REPORTING_SYSTEM_ATTRIBUTION);
      if (overlays.ferries || overlays.tss) control.addAttribution(LANE_ATTRIBUTION);
      if (SHIP_REPORTING_SYSTEMS.features.length > 0) {
        control.addAttribution(REPORTING_SYSTEM_ATTRIBUTION);
      }
    }
  }, [overlays]);

  // Curated official ship-reporting geometries. Render only systems and line
  // positions supported by cited authorities; unknown or unmapped systems are
  // never inferred or synthesized from OSM features.
  useEffect(() => {
    const group = groupsRef.current.reportingSystems;
    if (!group) return;
    group.clearLayers();
    for (const feature of SHIP_REPORTING_SYSTEMS.features) {
      const role = feature.properties.role;
      const line = L.geoJSON(feature as GeoJSON.Feature, {
        pane: 'lanes',
        style: {
          color: role === 'outer_boundary' ? '#ffb84d' : role === 'reporting_line' ? '#65e7a5' : role === 'partial_boundary' ? '#f4d35e' : '#ff6f91',
          weight: role === 'outer_boundary' ? 2.4 : role === 'reporting_line' ? 2 : role === 'partial_boundary' ? 1.8 : 1.8,
          opacity: 0.95,
          dashArray: role === 'outer_boundary' ? '12 7' : role === 'reporting_line' ? '3 6' : role === 'partial_boundary' ? '2 6' : '5 5',
          lineCap: 'round',
          lineJoin: 'round',
          interactive: true,
        },
      });
      line.bindTooltip(feature.properties.label, { sticky: true, className: 'marnav-tip' });
      line.bindPopup(
        `<strong>${feature.properties.system}</strong><br>${feature.properties.label}<br><small>${feature.properties.sourceCitation} · ${feature.properties.datum} · verified ${feature.properties.verifiedAsOf}</small><br><small>${feature.properties.geometryNote}</small>`,
        { className: 'reporting-system-popup', maxWidth: 340 },
      );
      group.addLayer(line);
    }
  }, []);

  // Worldwide marine overlays are viewport-fed, not bundled into the app.
  useEffect(() => {
    const map = mapRef.current;
    const ferries = groupsRef.current.ferries;
    const tss = groupsRef.current.tss;
    if (!map || !ferries || !tss) return;
    ferries.clearLayers();
    tss.clearLayers();
    const fallbackFerries: MarineFeature[] = lanes.ferries.map((feature, index) => ({ ...feature, id: `fallback-ferry-${index}`, type: 'ferry_route', path: feature.path as [number, number][], bounds: featureBounds(feature.path as [number, number][]) }));
    const fallbackTss: MarineFeature[] = lanes.tss.map((feature, index) => ({ ...feature, id: feature.id ?? `fallback-tss-${index}`, type: feature.type ?? 'separation_zone', name: feature.name || 'Traffic separation scheme', path: feature.path as [number, number][], bounds: featureBounds(feature.path as [number, number][]) }) as MarineFeature);
    const source = props.marineFeatures ?? { ferries: fallbackFerries, bridges: [], tss: fallbackTss };
    for (const feature of source.ferries) {
      const line = L.polyline(feature.path, ferryStyle());
      line.bindTooltip(`Ferry route · ${feature.name}`, { sticky: true, className: 'marnav-tip' });
      ferries.addLayer(line);
    }
    if (props.preferences.overlays.ferries && source.ferries.length > 0 && !map.hasLayer(ferries)) {
      ferries.addTo(map);
    }
    for (const feature of source.tss) {
      const info = describeTssFeature(feature);
      const rows = info.details.map(([label, value]) => `<div><strong>${escapePopupText(label)}:</strong> ${escapePopupText(value)}</div>`).join('');
      const sourceLink = info.sourceUrl
        ? `<a href="${escapePopupText(info.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapePopupText(info.sourceName ?? 'Source details')} ↗</a>`
        : escapePopupText(info.sourceName ?? 'Source attribution');
      const popup = `<strong>${escapePopupText(info.title)}</strong><br><span>${escapePopupText(info.type)}</span>${rows ? `<hr>${rows}` : ''}<hr><small>${sourceLink}<br>${TSS_SOURCE_ATTRIBUTION}</small>`;
      for (const part of tssGeometryParts(feature)) {
        const layer = part.kind === 'polygon'
          ? L.polygon(part.coordinates, tssStyle(feature.type))
          : L.polyline(part.coordinates, tssStyle(feature.type));
        layer.bindTooltip(`${info.title} · ${info.type}`, { sticky: true, className: 'marnav-tip' });
        layer.bindPopup(popup, { className: 'reporting-system-popup', maxWidth: 340 });
        tss.addLayer(layer);
      }
    }
    if (props.preferences.overlays.tss && source.tss.length > 0 && !map.hasLayer(tss)) {
      tss.addTo(map);
    }
  }, [props.marineFeatures, props.preferences.overlays.ferries, props.preferences.overlays.tss]);

  // The clearance dataset is fetched once, the first time a bridge is drawn,
  // and cached in the module — cards then rebuild with authority figures.
  useEffect(() => {
    const hasBridges = props.chartFeatures.some((entry) => entry.type === 'bridge')
      || (props.marineFeatures?.bridges?.length ?? 0) > 0;
    if (!hasBridges || clearanceDatasets) return;
    let cancelled = false;
    void loadClearanceDatasets().then((data) => {
      if (!cancelled) setClearanceDatasets(data);
    });
    return () => {
      cancelled = true;
    };
  }, [props.chartFeatures, props.marineFeatures?.bridges, clearanceDatasets]);

  useEffect(() => {
    const map = mapRef.current;
    const group = groupsRef.current.bridges;
    if (!map || !group) return;
    // A rebuild must not eat a card the user is reading. A card that opens
    // near an edge autopans the chart, the pan re-fetches, and the refetch
    // rebuilds these markers — without this, the card closes about a second
    // after it opens. Remember which bridge was open and put its card back.
    let openBridgeId: string | null = null;
    for (const layer of group.getLayers()) {
      const popup = (layer as L.CircleMarker).getPopup?.();
      if (popup?.isOpen()) {
        openBridgeId = (layer as L.CircleMarker & { bridgeFeatureId?: string }).bridgeFeatureId ?? null;
        break;
      }
    }
    group.clearLayers();
    if (!props.preferences.overlays.bridges) {
      if (map.hasLayer(group)) map.removeLayer(group);
      return;
    }
    const archiveBridges: ChartFeature[] = (props.marineFeatures?.bridges ?? []).map((feature) => {
      const centre = feature.path[Math.floor(feature.path.length / 2)] ?? [
        (feature.bounds[0] + feature.bounds[2]) / 2,
        (feature.bounds[1] + feature.bounds[3]) / 2,
      ];
      return {
        id: feature.id,
        type: 'bridge',
        waterCrossing: true,
        name: feature.name,
        lat: centre[0],
        lon: centre[1],
        path: feature.path,
        paths: feature.paths ?? [],
        properties: feature.details ?? {},
        sourceUrl: feature.sourceUrl ?? '',
      };
    });
    // One overlay and one card per physical crossing: records of the same
    // bridge from the live query and the archive fold together here, so a
    // bridge mapped as several ways is drawn once with all its information.
    const bridges = coalesceBridges([...props.chartFeatures.filter((entry) => entry.type === 'bridge'), ...archiveBridges]);
    for (const feature of bridges) {
      const details = feature.properties;
      const marker = L.circleMarker([feature.lat, feature.lon], {
        radius: 4.5,
        color: '#152c3a',
        weight: 1.8,
        fillColor: '#fff4bb',
        fillOpacity: 1,
        pane: 'lanes',
      }) as L.CircleMarker & { bridgeFeatureId: string };
      marker.bridgeFeatureId = feature.id;
      marker.bindTooltip(feature.name, { sticky: true, className: 'marnav-tip' });
      const card = describeBridge(
        {
          name: feature.name,
          properties: details,
          sourceUrl: feature.sourceUrl,
          sourceUrls: feature.sourceUrls,
          clearances: clearanceDatasets ? clearancesForFeature(feature, clearanceDatasets) : [],
        },
        { depth: props.depthUnit ?? 'm', distance: props.distanceUnit ?? 'm-nm' },
      );
      const section = (title: string, rows: BridgeRow[]) => rows.length === 0
        ? ''
        : `<section><h4>${escapePopupText(title)}</h4><dl>${rows
          .map((row) => `<div><dt>${escapePopupText(row.label)}</dt><dd>${escapePopupText(row.value)}</dd></div>`)
          .join('')}</dl></section>`;
      const links = card.links
        .map((link) => `<a href="${escapePopupText(link.url)}" target="_blank" rel="noopener noreferrer">${escapePopupText(link.label)} ↗</a>`)
        .join('');
      marker.bindPopup(
        `<article class="bridge-card">` +
          `<header><h3>${escapePopupText(card.title)}</h3><p>${escapePopupText(card.subtitle)}</p></header>` +
          section('', card.facts) +
          card.sections.map((entry) => section(entry.title, entry.rows)).join('') +
          `<footer><p>${links}</p></footer>` +
          `</article>`,
        { className: 'reporting-system-popup bridge-popup', maxWidth: 560 },
      );
      group.addLayer(marker);
    }
    if (bridges.length > 0) group.addTo(map);
    else if (map.hasLayer(group)) map.removeLayer(group);
    if (openBridgeId !== null && bridges.length > 0) {
      for (const layer of group.getLayers()) {
        const candidate = layer as L.CircleMarker & { bridgeFeatureId?: string };
        if (candidate.bridgeFeatureId !== openBridgeId) continue;
        const popup = candidate.getPopup();
        if (!popup) break;
        // Restoring must not pan again: the chart already moved for this
        // card, and another pan would re-fetch, rebuild, and loop the
        // restore. The flag is put back at once, so a later tap on this
        // marker still pans normally.
        popup.options.autoPan = false;
        candidate.openPopup();
        popup.options.autoPan = true;
        break;
      }
    }
  }, [props.chartFeatures, props.marineFeatures?.bridges, props.preferences.overlays.bridges, clearanceDatasets]);

  useEffect(() => {
    const map = mapRef.current;
    const group = groupsRef.current.protectedAreas;
    if (!map || !group) return;
    group.clearLayers();
    const hiddenAreas = props.preferences.hiddenAreaGroups ?? [];
    // Worldwide OSM areas: protected and conservation designations, reefs,
    // banks, restricted areas and military ranges, each with its own toggle.
    for (const feature of props.chartFeatures) {
      if (feature.type !== 'protected_area') continue;
      const meta = MARINE_AREA_GROUP_META[feature.areaGroup ?? 'protected'];
      if (!meta || hiddenAreas.includes(meta.id)) continue;
      const style: L.PathOptions = {
        color: meta.colour,
        weight: 2,
        opacity: 0.92,
        dashArray: '7 5',
        fillColor: meta.fill,
        fillOpacity: 0.08,
      };
      const rings = feature.rings ?? [];
      const lines = feature.lines ?? [];
      const layer = rings.length > 0
        ? L.polygon(rings, style)
        : L.polyline(lines.length > 0 ? lines : [feature.path], { ...style, fill: false });
      const rows = Object.entries(feature.properties)
        .filter(([key]) => key !== 'name' && key !== 'seamark:name')
        .map(([key, value]) => `<div><strong>${escapePopupText(markDetailLabel(key))}:</strong> ${escapePopupText(value)}</div>`)
        .join('');
      layer.bindTooltip(feature.name, { sticky: true, className: 'marnav-tip' });
      layer.bindPopup(`<strong>${escapePopupText(feature.name)}</strong><div>${escapePopupText(feature.areaLabel ?? meta.label)}</div>${rows ? `<hr>${rows}` : ''}<hr><small>OpenStreetMap (ODbL) · <a href="/disclaimer">Data sources &amp; disclaimer</a> · <a href="${escapePopupText(feature.sourceUrl)}" target="_blank" rel="noopener noreferrer">Source feature ↗</a></small>`, { className: 'reporting-system-popup', maxWidth: 360 });
      group.addLayer(layer);
    }
    // European Natura 2000 sites arrive as complete GeoJSON boundaries from
    // EMODnet and belong to the conservation group.
    const showConservation = !hiddenAreas.includes('conservation');
    for (const feature of showConservation ? props.protectedAreaFeatures : []) {
      const layer = L.geoJSON(feature.geometry as GeoJSON.GeoJsonObject, {
        pane: 'lanes',
        style: { color: MARINE_AREA_GROUP_META.conservation.colour, weight: 2, opacity: 0.92, dashArray: '7 5', fillColor: MARINE_AREA_GROUP_META.conservation.fill, fillOpacity: 0.08 },
      });
      const rows = Object.entries(feature.properties).map(([key, value]) => `<div><strong>${escapePopupText(key.replace(/_/g, ' '))}:</strong> ${escapePopupText(value)}</div>`).join('');
      const candidateWrecks = props.marks
        .filter((mark) => (mark.category === 'wreck' || mark.category === 'hazard_danger') &&
          pointInProtectedGeometry(mark.lon, mark.lat, feature.geometry))
        .sort((a, b) => distanceMeters(a.lat, a.lon, (feature.bounds[0] + feature.bounds[2]) / 2, (feature.bounds[1] + feature.bounds[3]) / 2) - distanceMeters(b.lat, b.lon, (feature.bounds[0] + feature.bounds[2]) / 2, (feature.bounds[1] + feature.bounds[3]) / 2));
      const nearbyWrecks = candidateWrecks.slice(0, 8).map((mark) => {
        const title = mark.name ?? mark.wreckInventoryName ?? `Wreck ${mark.id}`;
        const metres = distanceMeters(mark.lat, mark.lon, (feature.bounds[0] + feature.bounds[2]) / 2, (feature.bounds[1] + feature.bounds[3]) / 2);
        return `<div>${escapePopupText(title)} · approximately ${formatDistance(metres, distanceUnit)} from site's bounding-box centre</div>`;
      }).join('');
      layer.bindTooltip(feature.name, { sticky: true, className: 'marnav-tip' });
      layer.bindPopup(`<strong>${escapePopupText(feature.name)}</strong>${rows ? `<hr>${rows}` : ''}${nearbyWrecks ? `<hr><strong>Charted wrecks within mapped site geometry (possible association)</strong>${nearbyWrecks}` : ''}<hr><small>Protected-site designation only; it does not establish a boating prohibition. Check site-specific rules with the responsible authority. EMODnet Human Activities / EEA, CC BY 4.0. <a href="${escapePopupText(feature.sourceUrl)}" target="_blank" rel="noopener noreferrer">Dataset information ↗</a></small>`, { className: 'reporting-system-popup', maxWidth: 360 });
      group.addLayer(layer);
    }
    if (group.getLayers().length > 0) group.addTo(map);
    else if (map.hasLayer(group)) map.removeLayer(group);
  }, [props.marks, props.chartFeatures, props.protectedAreaFeatures, props.preferences.hiddenAreaGroups]);

  // NAVAID markers.
  useEffect(() => {
    const group = groupsRef.current.navaids;
    if (!group) return;
    group.clearLayers();
    // Symbols shrink at small scales so a dense harbour does not turn into a
    // wall of icons; the mark is still tappable at 16 px.
    const baseSize = props.zoom >= 15 ? 28 : props.zoom >= 13 ? 24 : props.zoom >= 11 ? 20 : 16;

    // Leading line between the pair of transit lights, drawn once per pair so
    // the bearing is visible on the chart and not just in the reference sheet.
    const marksById = new Map(props.marks.map((mark) => [mark.id, mark]));
    const paired = new Set<string>();
    for (const mark of props.marks) {
      if (!mark.transitPartner) continue;
      const partner = marksById.get(mark.transitPartner);
      if (!partner) continue;
      const key = [mark.id, partner.id].sort().join('|');
      if (paired.has(key)) continue;
      paired.add(key);
      const line = L.polyline(
        [
          [mark.lat, mark.lon],
          [partner.lat, partner.lon],
        ],
        {
          className: 'marnav-transit-line',
          color: '#ff43d0',
          weight: 1.8,
          opacity: 0.9,
        },
      );
      if (mark.transitBearing != null) {
        line.bindTooltip(
          `Leading line ${String(mark.transitBearing).padStart(3, '0')}° · ${formatDistance(mark.transitDistanceM ?? 0, distanceUnit)}`,
          { sticky: true, className: 'marnav-tip', opacity: 1 },
        );
      }
      line.addTo(group);
    }

    for (const mark of props.marks) {
      // Calling-in features may be reporting lines; communication areas may
      // have one or more mapped boundary paths. Keep these as outlines because
      // OSM geometry alone does not certify the official system boundary.
      // Wind-farm areas draw their boundary in the farm glyph's yellow, from
      // the way ring or the relation members alike. The generic line branch
      // below must not also draw a way farm in calling-line cyan.
      // Overhead cables draw their own orange line below, not cyan either.
      if (mark.category === 'wind_farm') {
        for (const boundary of [...(mark.path ? [mark.path] : []), ...(mark.paths ?? [])]) {
          if (boundary.length < 2) continue;
          L.polyline(boundary, {
            className: 'marnav-wind-farm',
            color: '#f4c531',
            weight: 2,
            opacity: 0.85,
            dashArray: '5 5',
            interactive: false,
          }).addTo(group);
        }
      } else if (mark.category === 'cable_overhead' && mark.path && mark.path.length >= 2) {
        // Overhead cables draw in safety orange, not calling-line cyan: the
        // wire is a clearance constraint, not a reporting line.
        L.polyline(mark.path, {
          className: 'marnav-cable-line',
          color: '#ff8a3d',
          weight: 2.2,
          opacity: 0.95,
          dashArray: '7 5',
          interactive: false,
        }).addTo(group);
      } else if (mark.path && mark.path.length >= 2) {
        L.polyline(mark.path, {
          className: 'marnav-calling-line',
          color: '#3dd6ff',
          weight: 2.2,
          opacity: 0.95,
          dashArray: '7 5',
          interactive: false,
        }).addTo(group);
      }
      if (mark.category === 'communication_area') {
        for (const boundary of mark.paths ?? []) {
          if (boundary.length < 2) continue;
          L.polyline(boundary, {
            className: 'marnav-reporting-area',
            color: '#3dd6ff',
            weight: 2,
            opacity: 0.85,
            dashArray: '5 5',
            interactive: false,
          }).addTo(group);
        }
      }
      // Sector boundaries and the coloured fan sit beneath the familiar aid
      // symbol. Sector bearings are source data; no missing limit is inferred.
      addLightSectors(group, mark, props.zoom);
      const region = ialaRegion(mark.lat, mark.lon);
      const spec = symbolForMark(mark, region);
      // Major lights read as the more important aid: slightly larger star. A
      // wreck's hull sits low in its box, so it gets a little more room to stay
      // legible beside the hazard spheres it is decluttered against.
      // A transit's two dots have to stay distinguishable, so it gets the
      // same extra room as a wreck rather than shrinking to two specks.
      // Minor lights and cardinal marks read small at harbour scales, so
      // they render at twice the base size; the beam and other annotations
      // scale with the icon, since iconPx scales from the same size.
      const size =
        mark.category === 'light' || mark.category.startsWith('cardinal')
          ? baseSize * 2
          : mark.category === 'major_light'
            ? baseSize + 4
            : mark.category === 'wreck' ||
                mark.category === 'transit_front' ||
                mark.category === 'transit_rear'
              ? baseSize + 2
              : baseSize;
      // A mark carrying a light flare, sound beam or racon ring needs a wider
      // box than the aid itself; the aid stays the same size on screen and the
      // extra room holds the chart cues.
      const iconPx = Math.round((size * spec.units) / 32);
      const html = spec.svg.replace(
        /(<svg[^>]*?)width="\d+" height="\d+"/,
        `$1width="${iconPx}" height="${iconPx}"`,
      );
      // Each leading-light symbol represents one mapped light at its own
      // feature coordinate; the connecting line shows their alignment.
      const marker = L.marker([mark.lat, mark.lon], {
        icon: L.divIcon({
          className: 'marnav-mark-wrap',
          html,
          iconSize: [iconPx, iconPx],
          iconAnchor: [iconPx / 2, iconPx / 2],
        }),
        keyboard: true,
        title: spec.label,
        riseOnHover: true,
      });
      marker.setZIndexOffset(mark.priority * 10);
      marker.bindTooltip(quickInfo(mark, ialaRegion(mark.lat, mark.lon)), {
        direction: 'top',
        offset: [0, -(Math.round(size / 2) + 2)],
        className: 'marnav-tip',
        opacity: 1,
      });
      marker.on('click', () => handlers.current.onSelectMark(mark));
      group.addLayer(marker);
    }
  }, [props.marks, props.zoom]);

  // Public places: one pin per marina, fuel berth, chandlery, ramp, meal or
  // facility in view. Names and details open on tap, so the chart stays clean.
  useEffect(() => {
    const map = mapRef.current;
    const group = groupsRef.current.pois;
    if (!map || !group) return;
    group.clearLayers();
    if (!props.preferences.overlays.pois) return;
    const visible = visiblePois(props.pois, props.zoom, props.preferences.hiddenPoiGroups);
    const rank = new Map(POI_GROUPS.map((entry, index) => [entry.id, index]));
    // Marine services win a collision with a café, so the fuel berth and the
    // marina survive even when the waterfront is crowded.
    const ordered = [...visible].sort(
      (a, b) => (rank.get(a.group) ?? 99) - (rank.get(b.group) ?? 99),
    );
    const perGroup = new Map<string, number>();
    const accepted: L.Point[] = [];
    for (const poi of ordered) {
      const count = perGroup.get(poi.group) ?? 0;
      // A dense city can hold hundreds of cafés. Cap each class so the pins
      // never bury the channel, and keep the marine classes first.
      if (count >= 80) continue;
      perGroup.set(poi.group, count + 1);
      const spec = POI_GROUPS.find((entry) => entry.id === poi.group);
      const size = props.zoom >= 15 ? 22 : 19;
      // Screen-space declutter: one pin per patch of chart. Without this, a
      // marina row stacks ten discs on top of each other and hides the marks.
      const point = map.latLngToContainerPoint([poi.lat, poi.lon]);
      if (accepted.some((other) => other.distanceTo(point) < size * 0.8)) continue;
      accepted.push(point);
      const html = `<span class="marnav-poi" style="--poi-colour:${spec?.colour ?? '#3b8a5a'}">${poiIconSvg(
        poi.group,
        Math.max(12, size - 6),
      )}</span>`;
      const title = poi.name ?? poi.kind;
      const marker = L.marker([poi.lat, poi.lon], {
        icon: L.divIcon({
          className: 'marnav-poi-wrap',
          html,
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        }),
        title,
        riseOnHover: true,
        keyboard: true,
      });
      marker.setZIndexOffset(700);
      marker.bindTooltip(`${poi.kind}${poi.name ? ` · ${poi.name}` : ''}`, {
        direction: 'top',
        offset: [0, -12],
        className: 'marnav-tip',
      });
      marker.bindPopup(() => poiPopupContent(poi), {
        className: 'marnav-poi-popup',
        maxWidth: 280,
        minWidth: 190,
      });
      group.addLayer(marker);
    }
  }, [
    props.pois,
    props.zoom,
    props.preferences.overlays.pois,
    props.preferences.hiddenPoiGroups,
  ]);

  // AIS targets.
  //
  // Markers are reconciled rather than rebuilt: snapshots land every 2.5 s and
  // recreating every icon closed the hover card and could swallow a tap that
  // straddled a refresh. Position, rotation and tooltip are updated in place.
  useEffect(() => {
    const group = groupsRef.current.ais;
    if (!group) return;
    const seen = new Set<number>();
    if (!props.preferences.overlays.ais) {
      for (const entry of aisMarkersRef.current.values()) group.removeLayer(entry.marker);
      aisMarkersRef.current.clear();
      return;
    }

    for (const vessel of props.aisVessels) {
      seen.add(vessel.mmsi);
      const size = vesselIconSize(vessel, props.zoom);
      const height = vesselIconHeight(size);
      const rotation = vesselMarkerRotation(vessel);
      const html = vesselIconSvg(vessel, size);
      const iconHtml = `<span class="marnav-ais" style="--rot:${rotation}deg">${html}</span>`;
      const label = vesselLabel(vessel);
      const existing = aisMarkersRef.current.get(vessel.mmsi);

      if (!existing) {
        const marker = L.marker([vessel.lat, vessel.lon], {
          icon: L.divIcon({
            className: 'marnav-ais-wrap',
            html: iconHtml,
            iconSize: [size, height],
            iconAnchor: [size / 2, height / 2],
          }),
          title: label,
          riseOnHover: true,
          keyboard: true,
        });
        // Live traffic sits above the charted marks: a target that overlaps a
        // buoy must still be tappable in its own right.
        marker.setZIndexOffset(1200);
        marker.on('mouseover', () => setHovered(vessel.mmsi));
        marker.on('focus', () => setHovered(vessel.mmsi));
        marker.on('mouseout', () => setHovered((current) => (current === vessel.mmsi ? null : current)));
        marker.on('blur', () => setHovered((current) => (current === vessel.mmsi ? null : current)));
        marker.on('click', () => {
          const entry = aisMarkersRef.current.get(vessel.mmsi);
          handlers.current.onSelectVessel(entry?.vessel ?? vessel);
        });
        group.addLayer(marker);
        aisMarkersRef.current.set(vessel.mmsi, { marker, vessel, iconHtml, label, labelHtml: '' });
        continue;
      }

      existing.vessel = vessel;
      existing.marker.setLatLng([vessel.lat, vessel.lon]);
      if (existing.iconHtml !== iconHtml) {
        existing.marker.setIcon(
          L.divIcon({
            className: 'marnav-ais-wrap',
            html: iconHtml,
            iconSize: [size, height],
            iconAnchor: [size / 2, height / 2],
          }),
        );
        existing.iconHtml = iconHtml;
      }
      if (existing.label !== label) {
        existing.label = label;
        existing.marker.options.title = label;
        existing.marker.getElement()?.setAttribute('title', label);
      }
    }

    for (const [mmsi, entry] of aisMarkersRef.current) {
      if (seen.has(mmsi)) continue;
      group.removeLayer(entry.marker);
      aisMarkersRef.current.delete(mmsi);
    }
  }, [props.aisVessels, props.zoom, props.preferences.overlays.ais]);

  // The picked target stays ringed after the drawer and sheet close, so a
  // vessel heard once in a crowded channel is still findable on the chart, with
  // its name and course pinned beside it. The class lives on the marker's icon
  // element, which is replaced whenever the icon is redrawn, hence the
  // dependency on the snapshot and zoom. The label is only re-written when its
  // text changes, so a live update does not make the pill flash.
  useEffect(() => {
    for (const [mmsi, entry] of aisMarkersRef.current) {
      const selected = mmsi === props.selectedVesselMmsi;
      entry.marker.getElement()?.classList.toggle('ais-selected', selected);
      entry.marker.setZIndexOffset(selected ? 1600 : 1200);
      if (!selected) {
        if (entry.marker.getTooltip()) {
          entry.marker.closeTooltip();
          entry.marker.unbindTooltip();
          entry.labelHtml = '';
        }
        continue;
      }
      // The label carries the range off this boat, so it is rebuilt as the fix
      // and the target move, not just when the target changes.
      const html = selectedVesselLabelHtml(entry.vessel, props.fix, props.distanceUnit);
      if (!entry.marker.getTooltip()) {
        entry.marker.bindTooltip(html, {
          permanent: true,
          direction: 'right',
          offset: [13, 0],
          className: 'ais-selected-label',
          interactive: false,
          opacity: 1,
        });
        entry.labelHtml = html;
        entry.marker.openTooltip();
      } else if (entry.labelHtml !== html) {
        entry.marker.setTooltipContent(html);
        entry.labelHtml = html;
      }
      if (!entry.marker.isTooltipOpen()) entry.marker.openTooltip();
    }
  }, [
    props.selectedVesselMmsi,
    props.aisVessels,
    props.zoom,
    props.preferences.overlays.ais,
    props.fix,
    props.distanceUnit,
  ]);

  // Own vessel.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!props.fix) {
      if (vesselRef.current) {
        map.removeLayer(vesselRef.current);
        vesselRef.current = null;
      }
      return;
    }
    const rotation = props.fix.compass ?? 0;
    const icon = L.divIcon({
      className: 'marnav-vessel-wrap',
      html: `<span class="marnav-vessel" style="--rot:${rotation}deg">
        <svg viewBox="0 0 32 32" width="34" height="34" aria-hidden="true">
          <circle cx="16" cy="16" r="13" fill="rgba(61,214,255,0.16)" stroke="#3dd6ff" stroke-width="1.5"/>
          <path d="M16 4 L23 26 L16 21 L9 26 Z" fill="#3dd6ff" stroke="#04141f" stroke-width="1.2"/>
        </svg>
      </span>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
    });
    if (!vesselRef.current) {
      vesselRef.current = L.marker([props.fix.lat, props.fix.lon], { icon, interactive: false, zIndexOffset: 5000 });
      vesselRef.current.addTo(map);
    } else {
      vesselRef.current.setLatLng([props.fix.lat, props.fix.lon]);
      vesselRef.current.setIcon(icon);
    }
  }, [props.fix]);

  // Destination search pin. Tapping the pin itself, or tapping open water,
  // clears it; a new search replaces it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!props.searchPin) {
      if (searchPinRef.current) {
        map.removeLayer(searchPinRef.current);
        searchPinRef.current = null;
      }
      return;
    }
    if (!searchPinRef.current) {
      searchPinRef.current = L.circleMarker([props.searchPin.lat, props.searchPin.lon], {
        radius: 10,
        color: '#f2a65a',
        weight: 2,
        fillColor: '#f2a65a',
        fillOpacity: 0.9,
      });
      searchPinRef.current.addTo(map);
    } else {
      searchPinRef.current.setLatLng([props.searchPin.lat, props.searchPin.lon]);
    }
    searchPinRef.current.bindTooltip(props.searchPin.name, {
      sticky: true,
      className: 'marnav-tip',
      direction: 'top',
    });
    searchPinRef.current.off('click');
    searchPinRef.current.on('click', () => {
      props.onSearchPinClear?.();
    });
  }, [props.searchPin, props.onSearchPinClear]);

  // The navigator's own pins. The group is rebuilt when the list changes;
  // there are only ever a handful, so a rebuild is cheaper than diffing.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!pinsGroupRef.current) {
      pinsGroupRef.current = L.layerGroup().addTo(map);
    }
    const group = pinsGroupRef.current;
    group.clearLayers();
    for (const pin of props.pins ?? []) {
      const selected = pin.id === props.selectedPinId;
      const size = selected ? 36 : 28;
      const icon = L.divIcon({
        className: 'marnav-pin-wrap',
        html: `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path d="M12 1.5 C7.5 1.5 4 5 4 9.5 C4 15 12 22.5 12 22.5 C12 22.5 20 15 20 9.5 C20 5 16.5 1.5 12 1.5 Z" fill="${selected ? '#3dd6ff' : '#f2a65a'}" stroke="#04141f" stroke-width="1.2"/><circle cx="12" cy="9.5" r="3.5" fill="#04141f"/></svg>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size],
      });
      const marker = L.marker([pin.lat, pin.lon], { icon });
      marker.bindTooltip(pin.title, { sticky: true, className: 'marnav-tip', direction: 'top' });
      marker.on('click', () => {
        props.onSelectPin?.(pin);
      });
      marker.addTo(group);
    }
  }, [props.pins, props.selectedPinId, props.onSelectPin]);

  // Recorded tracks: the live recording in orange, a saved track the user
  // chose to show in cyan. Both are device-only, like pins.
  const tracksGroupRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!tracksGroupRef.current) {
      tracksGroupRef.current = L.layerGroup().addTo(map);
    }
    const group = tracksGroupRef.current;
    group.clearLayers();
    const draw = (track: Track | null, color: string) => {
      if (!track || track.points.length < 2) return;
      L.polyline(
        track.points.map((point) => [point.lat, point.lon] as [number, number]),
        { color, weight: 3, opacity: 0.9 },
      ).addTo(group);
    };
    draw(props.activeTrack ?? null, '#f2a65a');
    draw(props.shownTrack ?? null, '#3dd6ff');
  }, [props.activeTrack, props.shownTrack]);

  // Manual route: a dashed line through the waypoints, each with a numbered,
  // draggable dot. Dragging a dot moves that waypoint; the panel's leg list
  // and totals recompute from the same waypoint array.
  const routeGroupRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!routeGroupRef.current) {
      routeGroupRef.current = L.layerGroup().addTo(map);
    }
    const group = routeGroupRef.current;
    group.clearLayers();
    const points = props.routeWaypoints ?? [];
    if (points.length >= 2) {
      L.polyline(
        points.map((point) => [point.lat, point.lon] as [number, number]),
        { color: '#3dd6ff', weight: 3, opacity: 0.9, dashArray: '8 6' },
      ).addTo(group);
    }
    points.forEach((point, index) => {
      const icon = L.divIcon({
        className: 'marnav-route-wrap',
        html: `<div class="marnav-route-dot">${index + 1}</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      });
      const marker = L.marker([point.lat, point.lon], { icon, draggable: true });
      marker.bindTooltip(`Waypoint ${index + 1}`, { sticky: true, className: 'marnav-tip', direction: 'top' });
      marker.on('dragend', () => {
        const moved = marker.getLatLng();
        props.onRouteWaypointMove?.(index, moved.lat, moved.lng);
      });
      marker.addTo(group);
    });
  }, [props.routeWaypoints, props.onRouteWaypointMove]);

  // Man overboard: a red marker on the recorded position, with a dashed line
  // back from own ship while a GPS fix exists. No fix, no line — the marker
  // alone is still the position to steer for.
  const mobGroupRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!mobGroupRef.current) {
      mobGroupRef.current = L.layerGroup().addTo(map);
    }
    const group = mobGroupRef.current;
    group.clearLayers();
    const mob = props.mob ?? null;
    if (!mob) return;
    L.circleMarker([mob.lat, mob.lon], {
      radius: 10,
      color: '#ff6b5e',
      weight: 3,
      fillColor: '#ff6b5e',
      fillOpacity: 0.5,
    }).bindTooltip('MOB', { sticky: true, className: 'marnav-tip', direction: 'top' }).addTo(group);
    const fix = props.fix;
    if (fix) {
      L.polyline(
        [
          [fix.lat, fix.lon],
          [mob.lat, mob.lon],
        ],
        { color: '#ff6b5e', weight: 2, opacity: 0.9, dashArray: '6 4' },
      ).addTo(group);
    }
  }, [props.mob, props.fix]);

  // Tide stations: small markers for the stations in the current view, at
  // harbour zoom and above. Drawing all 3,500 worldwide would swamp the
  // chart, so the layer stays empty until the view is tight enough.
  const tideGroupRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!tideGroupRef.current) {
      tideGroupRef.current = L.layerGroup().addTo(map);
    }
    const group = tideGroupRef.current;
    group.clearLayers();
    const stations = props.tideStations ?? null;
    if (!stations || !tideBounds || props.zoom < 8) return;
    const [south, west, north, east] = tideBounds;
    for (const station of stations) {
      if (station.lat < south || station.lat > north || station.lon < west || station.lon > east) continue;
      const marker = L.circleMarker([station.lat, station.lon], {
        radius: 4,
        color: '#7be0a3',
        weight: 2,
        fillColor: '#7be0a3',
        fillOpacity: 0.6,
      });
      marker.bindTooltip(station.name, { sticky: true, className: 'marnav-tip', direction: 'top' });
      marker.on('click', () => {
        handlers.current.onSelectTideStation?.(station);
      });
      marker.addTo(group);
    }
  }, [props.tideStations, tideBounds, props.zoom]);

  // NAVAREA warnings: one marker per parsed position, all markers of a
  // warning opening the same full text. Position-less warnings have no
  // marker; they are readable in the menu list.
  const warningsGroupRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!warningsGroupRef.current) {
      warningsGroupRef.current = L.layerGroup().addTo(map);
    }
    const group = warningsGroupRef.current;
    group.clearLayers();
    for (const warning of props.warnings ?? []) {
      for (const position of warning.positions) {
        const marker = L.circleMarker([position.lat, position.lon], {
          radius: 6,
          color: '#ff8a7a',
          weight: 2,
          fillColor: '#ff8a7a',
          fillOpacity: 0.4,
        });
        marker.bindTooltip(warning.id, { sticky: true, className: 'marnav-tip', direction: 'top' });
        marker.bindPopup(
          `<div style="white-space: pre-wrap; max-height: 300px; overflow-y: auto;"><strong>${escapeXml(warning.id)}</strong> · ${escapeXml(notmarAreaName(warning.navArea))}${warning.issueDate ? ` · issued ${escapeXml(warning.issueDate)}` : ''}\n\n${escapeXml(warning.text)}</div>`,
          { maxWidth: 360 },
        );
        marker.addTo(group);
      }
    }
  }, [props.warnings]);

  // USCG Local Notices: points, lines and polygons from the NAVCEN files,
  // drawn in amber so they read apart from the salmon NAVAREA warnings.
  const lnmGroupRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!lnmGroupRef.current) {
      lnmGroupRef.current = L.layerGroup().addTo(map);
    }
    const group = lnmGroupRef.current;
    group.clearLayers();
    const features = props.lnm ?? [];
    if (features.length === 0) return;
    const collection = {
      type: 'FeatureCollection',
      features: features.map((feature) => ({
        type: 'Feature',
        id: feature.id,
        geometry: feature.geometry,
        properties: {
          title: feature.title,
          waterway: feature.waterway,
          beginMs: feature.beginMs,
          endMs: feature.endMs,
          description: feature.description,
        },
      })),
    } as GeoJSON.FeatureCollection;
    const layer = L.geoJSON(collection, {
      style: { color: '#f5b942', weight: 2, fillColor: '#f5b942', fillOpacity: 0.25 },
      pointToLayer: (_feature, latlng) =>
        L.circleMarker(latlng, {
          radius: 6,
          color: '#f5b942',
          weight: 2,
          fillColor: '#f5b942',
          fillOpacity: 0.4,
        }),
      onEachFeature: (geoFeature, sublayer) => {
        const properties = (geoFeature.properties ?? {}) as Record<string, unknown>;
        const title = typeof properties.title === 'string' ? properties.title : 'Local notice';
        const waterway = typeof properties.waterway === 'string' ? properties.waterway : null;
        const beginMs = typeof properties.beginMs === 'number' ? properties.beginMs : null;
        const endMs = typeof properties.endMs === 'number' ? properties.endMs : null;
        const description =
          typeof properties.description === 'string' ? properties.description : '';
        const dates =
          beginMs !== null || endMs !== null
            ? ` · ${lnmDateLabel(beginMs) ?? '—'} — ${lnmDateLabel(endMs) ?? 'open'}`
            : '';
        sublayer.bindTooltip(title, { sticky: true, className: 'marnav-tip', direction: 'top' });
        sublayer.bindPopup(
          `<div style="white-space: pre-wrap; max-height: 300px; overflow-y: auto;"><strong>${escapeXml(title)}</strong>${waterway ? ` · ${escapeXml(waterway)}` : ''}${escapeXml(dates)}\n\n${escapeXml(description)}</div>`,
          { maxWidth: 360 },
        );
      },
    });
    layer.addTo(group);
  }, [props.lnm]);

  // Anchor swing circle and course to steer. Both are set by the navigator on
  // this device, so they are drawn whatever the overlay switches are doing. The
  // course ray is a screen length rather than a fixed distance, so it reads the
  // same at harbour zoom and at passage zoom.
  const watchAnchor = props.watch.anchor;
  const watchCourse = props.watch.course;
  const fixLat = props.fix?.lat ?? null;
  const fixLon = props.fix?.lon ?? null;

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!watchRef.current) {
      if (!map.getPane('watch')) {
        const pane = map.createPane('watch');
        pane.style.zIndex = '460';
      }
      watchRef.current = L.layerGroup().addTo(map);
    }
    const group = watchRef.current;
    group.clearLayers();

    if (watchAnchor) {
      L.circle([watchAnchor.lat, watchAnchor.lon], {
        radius: watchAnchor.radiusM,
        color: '#ffd24a',
        weight: 1.5,
        opacity: 0.9,
        dashArray: '6 5',
        fillColor: '#ffd24a',
        fillOpacity: 0.06,
        pane: 'watch',
        interactive: false,
        className: 'marnav-anchor-circle',
      }).addTo(group);
      const anchorIcon = L.divIcon({
        className: 'marnav-watch-icon',
        html: `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <circle cx="12" cy="4.6" r="2" fill="none" stroke="#ffd24a" stroke-width="1.8"/>
          <path d="M12 6.8v13.4" stroke="#ffd24a" stroke-width="1.8" stroke-linecap="round"/>
          <path d="M7.4 10h9.2" stroke="#ffd24a" stroke-width="1.8" stroke-linecap="round"/>
          <path d="M4.2 13.6c0 4.2 3.5 6.6 7.8 6.6s7.8-2.4 7.8-6.6" fill="none" stroke="#ffd24a" stroke-width="1.8" stroke-linecap="round"/>
        </svg>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      });
      L.marker([watchAnchor.lat, watchAnchor.lon], {
        icon: anchorIcon,
        interactive: false,
        keyboard: false,
        pane: 'watch',
      }).addTo(group);
      // The radius, written on the circle's northern edge so the circle can be
      // read without opening the menu.
      const radiusLabel = L.divIcon({
        className: 'marnav-anchor-label-wrap',
        html: `<span class="marnav-anchor-label">${formatDistance(watchAnchor.radiusM, distanceUnit)}</span>`,
        iconSize: undefined,
        iconAnchor: [0, 0],
      });
      L.marker([watchAnchor.lat + watchAnchor.radiusM / 111_320, watchAnchor.lon], {
        icon: radiusLabel,
        interactive: false,
        keyboard: false,
        pane: 'watch',
      }).addTo(group);
    }

    if (watchCourse && fixLat !== null && fixLon !== null) {
      const size = map.getSize();
      const start = L.latLng(fixLat, fixLon);
      const from = map.latLngToContainerPoint(start);
      const radians = (watchCourse.bearingDeg * Math.PI) / 180;
      const length = Math.max(90, Math.min(size.x, size.y) * 0.36);
      const end = map.containerPointToLatLng(
        L.point(from.x + Math.sin(radians) * length, from.y - Math.cos(radians) * length),
      );
      L.polyline([start, end], {
        color: '#3dd6ff',
        weight: 2,
        opacity: 0.85,
        dashArray: '10 7',
        pane: 'watch',
        interactive: false,
        className: 'marnav-course-line',
      }).addTo(group);
      const arrowIcon = L.divIcon({
        className: 'marnav-watch-icon',
        html: `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" style="transform:rotate(${watchCourse.bearingDeg}deg)">
          <path d="M12 3 19 21 12 16.5 5 21Z" fill="#3dd6ff" stroke="#04141f" stroke-width="1.2"/>
        </svg>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });
      L.marker(end, { icon: arrowIcon, interactive: false, keyboard: false, pane: 'watch' }).addTo(group);
    }
  }, [watchAnchor, watchCourse, fixLat, fixLon, props.zoom, distanceUnit]);

  // Chart scale and cursor position: the readout that replaces the on-map credit line.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const onMove = (event: L.LeafletMouseEvent) =>
      setCursor({ lat: event.latlng.lat, lon: event.latlng.lng });
    const onLeave = () => setCursor(null);
    const onZoom = () => setLiveZoom(map.getZoom());
    setLiveZoom(map.getZoom());
    map.on('mousemove', onMove);
    map.on('mouseout', onLeave);
    map.on('zoom', onZoom);
    map.on('zoomend', onZoom);
    return () => {
      map.off('mousemove', onMove);
      map.off('mouseout', onLeave);
      map.off('zoom', onZoom);
      map.off('zoomend', onZoom);
    };
  }, []);

  useImperativeHandle(ref, () => ({
    zoomIn: () => mapRef.current?.zoomIn(),
    zoomOut: () => mapRef.current?.zoomOut(),
    flyTo: (lat, lon, zoom) => mapRef.current?.flyTo([lat, lon], zoom ?? Math.max(13, mapRef.current.getZoom())),
    getCenter: () => {
      const centre = mapRef.current?.getCenter();
      return centre ? [centre.lat, centre.lng] : null;
    },
    getBounds: () => {
      const bounds = mapRef.current?.getBounds();
      if (!bounds) return null;
      return [bounds.getSouth(), bounds.getWest(), bounds.getNorth(), bounds.getEast()];
    },
    refreshBase: () => {
      const layer = basesRef.current[handlers.current.preferences.base] as L.GridLayer | undefined;
      layer?.redraw?.();
    },
  }));

  const hoverVessel =
    hovered === null ? null : (props.aisVessels.find((vessel) => vessel.mmsi === hovered) ?? null);
  const mapWidth = containerRef.current?.clientWidth ?? 0;
  const hoverPoint =
    hoverVessel && mapRef.current
      ? mapRef.current.latLngToContainerPoint([hoverVessel.lat, hoverVessel.lon])
      : null;
  // The card grows with the number of fields a target reports, so its height is
  // measured rather than assumed when deciding whether it fits above.
  const hoverCardRef = useRef<HTMLDivElement | null>(null);
  const [hoverCardHeight, setHoverCardHeight] = useState(300);
  useLayoutEffect(() => {
    const height = hoverCardRef.current?.offsetHeight;
    if (height) setHoverCardHeight(height);
  }, [hovered]);

  // Keep the whole card on screen: half its widest size plus a margin, then
  // flip below the target when there is no room above it.
  const halfCard = Math.min(272, Math.max(200, mapWidth - 24)) / 2;
  const hoverLeft = hoverPoint
    ? Math.min(Math.max(hoverPoint.x, halfCard + 12), Math.max(halfCard + 12, mapWidth - halfCard - 12))
    : 0;

  return (
    <div className="map-shell">
      <div
        ref={containerRef}
        className="marnav-map"
        aria-label="Interactive marine chart"
        data-zoom={props.zoom}
      />
      <div className="chart-readout" data-testid="chart-readout">
        <span className="chart-readout-zoom">Zoom {liveZoom}</span>
        <span className="chart-readout-coords">
          {cursor ? formatCoordinate(cursor.lat, cursor.lon, props.coordinateFormat ?? 'latlon') : '— · —'}
        </span>
      </div>
      {hoverVessel && hoverPoint && mapWidth > 0 && (
        <div
          ref={hoverCardRef}
          className={`vessel-hover ${hoverPoint.y < hoverCardHeight + 20 ? 'below' : 'above'}`}
          style={{ left: hoverLeft, top: hoverPoint.y }}
          aria-hidden="true"
        >
          <div
            dangerouslySetInnerHTML={{
              __html: vesselTooltipHtml(hoverVessel, Date.now(), distanceUnit, depthUnit),
            }}
          />
        </div>
      )}
    </div>
  );
});
