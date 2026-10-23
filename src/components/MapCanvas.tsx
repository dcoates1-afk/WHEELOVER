import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import L from 'leaflet';
import lanes from '../data/lanes.json';
import type { MarineFeature } from '../lib/marineDb';
import { ialaRegion, quickInfo, symbolFor } from '../lib/navaids';
import { vesselLabel } from '../lib/ais';
import { vesselCourse, vesselIconSize, vesselIconSvg, vesselIsMoving, vesselTooltipHtml } from '../lib/aisVessel';
import { loadNoaaTile, noaaTileUrl, tileBounds } from '../lib/noaaChart';
import {
  CONTOUR_ATTRIBUTION,
  CONTOUR_MAX_NATIVE_ZOOM,
  CONTOUR_TILE_URL,
  ENC_CONTOUR_MIN_ZOOM,
  ENC_DEPTH_ATTRIBUTION,
  NAUTICAL_ATTRIBUTION,
  NOAA_RASTER_ATTRIBUTION,
  RELIEF_ATTRIBUTION,
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
  marineFeatures: { ferries: MarineFeature[]; tss: MarineFeature[] } | null;
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
 * practice: ferries in a bright dashed cyan, TSS lanes in magenta with a tinted
 * fill, separation zones in amber. The pane carries a dark halo (see
 * styles.css) because the same stroke has to read over pale NOAA paper, green
 * OSM land and dark satellite water.
 */
export const LANE_ATTRIBUTION = 'Ferry routes & TSS: OpenStreetMap (ODbL)';

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

function tssStyle(type: string): L.PolylineOptions {
  switch (type) {
    case 'separation_lane':
      return {
        color: '#ff7ad1',
        weight: 2.2,
        opacity: 0.95,
        fillColor: '#ff2fa8',
        fillOpacity: 0.24,
        pane: 'lanes',
      };
    case 'separation_zone':
      return {
        color: '#ffd24a',
        weight: 1.9,
        opacity: 0.9,
        dashArray: '4 5',
        fillColor: '#ffd24a',
        fillOpacity: 0.16,
        pane: 'lanes',
      };
    case 'separation_boundary':
      return { color: '#f4faff', weight: 1.8, opacity: 0.9, dashArray: '12 7', pane: 'lanes' };
    case 'separation_line':
      return { color: '#ff7ad1', weight: 1.9, opacity: 0.9, dashArray: '10 6', pane: 'lanes' };
    default:
      return { color: '#e2f2fb', weight: 1.5, opacity: 0.8, dashArray: '2 6', pane: 'lanes' };
  }
}

export const MapCanvas = forwardRef<MapHandle, MapCanvasProps>(function MapCanvas(props, ref) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const basesRef = useRef<Record<string, L.Layer>>({});
  const seaRef = useRef<L.TileLayer | null>(null);
  const depthSyncRef = useRef<(() => void) | null>(null);
  const depthLabelsRef = useRef<L.LayerGroup | null>(null);
  const groupsRef = useRef<Partial<Record<'navaids' | 'ferries' | 'tss' | 'ais' | 'pois', L.LayerGroup>>>({});
  const vesselRef = useRef<L.Marker | null>(null);
  const aisMarkersRef = useRef(
    new Map<number, { marker: L.Marker; vessel: AisVessel; iconHtml: string; label: string }>(),
  );
  const handlers = useRef(props);
  handlers.current = props;
  // Hover card is drawn as our own overlay, not a Leaflet tooltip: Leaflet
  // centres a tooltip on the marker and lets it hang off the screen edge, which
  // is useless on a phone-sized chart. This card is clamped to the map.
  const [hovered, setHovered] = useState<number | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: props.initialCenter ?? [50.76, -1.2],
      zoom: props.initialZoom ?? 11,
      zoomControl: false,
      attributionControl: true,
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
    const depthLabels = L.layerGroup();

    seaRef.current = sea;
    depthLabelsRef.current = depthLabels;
    groupsRef.current = { navaids, ferries, tss, ais, pois };

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
      setWanted(gebcoContours, active.contours && !useEnc);
      setWanted(encContours, active.contours && useEnc);
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
    };

    map.on('moveend', emitView);
    map.on('dragstart', () => handlers.current.onUserMove?.());
    map.on('zoomstart', () => handlers.current.onUserMove?.());
    map.on('movestart zoomstart click', () => setHovered(null));
    map.on('click', (event: L.LeafletMouseEvent) => {
      handlers.current.onMapClick(event.latlng.lat, event.latlng.lng);
    });
    emitView();

    return () => {
      map.off();
      map.remove();
      mapRef.current = null;
      groupsRef.current = {};
      seaRef.current = null;
      depthSyncRef.current = null;
      basesRef.current = {};
      vesselRef.current = null;
      aisMarkersRef.current.clear();
      depthLabelsRef.current = null;
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
        const text = formatDepth(sample.depth);
        const existing = markers.get(key);
        if (!text) {
          if (existing) {
            group.removeLayer(existing);
            markers.delete(key);
          }
          return;
        }
        const source = sample.source === 'emodnet' ? 'EMODnet DTM' : 'GEBCO grid';
        const html = `<span class="marnav-depth-num" title="Modelled depth ${text} m · ${source}">${text}</span>`;
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
  }, [depthLabelsOn]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const key of ['navaids', 'ferries', 'tss', 'ais', 'pois'] as const) {
      const group = groupsRef.current[key];
      if (!group) continue;
      const wanted = overlays[key];
      if (wanted) {
        if (!map.hasLayer(group)) group.addTo(map);
      } else if (map.hasLayer(group)) {
        map.removeLayer(group);
      }
    }
    // The lane geometry is OpenStreetMap data, so its credit follows the
    // toggles rather than sitting on the chart when nothing is drawn.
    const control = map.attributionControl;
    if (control) {
      control.removeAttribution(LANE_ATTRIBUTION);
      if (overlays.ferries || overlays.tss) control.addAttribution(LANE_ATTRIBUTION);
    }
  }, [overlays]);

  // Worldwide marine overlays are viewport-fed, not bundled into the app.
  useEffect(() => {
    const ferries = groupsRef.current.ferries;
    const tss = groupsRef.current.tss;
    if (!ferries || !tss) return;
    ferries.clearLayers();
    tss.clearLayers();
    const fallbackFerries: MarineFeature[] = lanes.ferries.map((feature, index) => ({ ...feature, id: `fallback-ferry-${index}`, type: 'ferry_route', path: feature.path as [number, number][], bounds: featureBounds(feature.path as [number, number][]) }));
    const fallbackTss: MarineFeature[] = lanes.tss.map((feature, index) => ({ ...feature, id: `fallback-tss-${index}`, path: feature.path as [number, number][], bounds: featureBounds(feature.path as [number, number][]) }));
    const source = props.marineFeatures ?? { ferries: fallbackFerries, tss: fallbackTss };
    for (const feature of source.ferries) {
      const line = L.polyline(feature.path, ferryStyle());
      line.bindTooltip(`Ferry route · ${feature.name}`, { sticky: true, className: 'marnav-tip' });
      ferries.addLayer(line);
    }
    for (const feature of source.tss) {
      const path = feature.path;
      const closed = path.length > 3 && path[0][0] === path[path.length - 1][0] && path[0][1] === path[path.length - 1][1];
      const layer = closed ? L.polygon(path, tssStyle(feature.type)) : L.polyline(path, tssStyle(feature.type));
      layer.bindTooltip(`Traffic separation scheme · ${feature.name}`, { sticky: true, className: 'marnav-tip' });
      tss.addLayer(layer);
    }
  }, [props.marineFeatures]);

  // NAVAID markers.
  useEffect(() => {
    const group = groupsRef.current.navaids;
    if (!group) return;
    group.clearLayers();
    if (!props.preferences.overlays.navaids) return;
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
          dashArray: '5 5',
        },
      );
      if (mark.transitBearing !== null) {
        line.bindTooltip(
          `Leading line ${String(mark.transitBearing).padStart(3, '0')}° · ${mark.transitDistanceM ?? 0} m`,
          { sticky: true, className: 'marnav-tip', opacity: 1 },
        );
      }
      line.addTo(group);
    }

    for (const mark of props.marks) {
      // Calling-in points are reporting lines across the channel in OSM, so draw
      // the line itself and keep the radio icon at its centre for tapping.
      if (mark.path && mark.path.length >= 2) {
        L.polyline(mark.path, {
          className: 'marnav-calling-line',
          color: '#3dd6ff',
          weight: 2.2,
          opacity: 0.95,
          dashArray: '7 5',
          interactive: false,
        }).addTo(group);
      }
      const region = ialaRegion(mark.lat, mark.lon);
      const spec = symbolFor(mark.category, region);
      // Major lights read as the more important aid: slightly larger star. A
      // wreck's hull sits low in its box, so it gets a little more room to stay
      // legible beside the hazard spheres it is decluttered against.
      // A transit's two dots have to stay distinguishable, so it gets the
      // same extra room as a wreck rather than shrinking to two specks.
      const size =
        mark.category === 'major_light'
          ? baseSize + 4
          : mark.category === 'wreck' ||
              mark.category === 'transit_front' ||
              mark.category === 'transit_rear'
            ? baseSize + 2
            : baseSize;
      const html = spec.svg.replace('width="32" height="32"', `width="${size}" height="${size}"`);
      // A transit symbol stacks both lights, so its anchor is the dot for this
      // end (front at y 21.5, rear at 9.5 in the 32-unit viewBox), not the
      // centre of the box. Anchoring the middle would plot the light metres
      // off its charted position and spoil the alignment.
      const anchorY =
        mark.category === 'transit_front'
          ? (size * 21.5) / 32
          : mark.category === 'transit_rear'
            ? (size * 9.5) / 32
            : size / 2;
      const marker = L.marker([mark.lat, mark.lon], {
        icon: L.divIcon({
          className: 'marnav-mark-wrap',
          html,
          iconSize: [size, size],
          iconAnchor: [size / 2, anchorY],
        }),
        keyboard: true,
        title: spec.label,
        riseOnHover: true,
      });
      marker.setZIndexOffset(mark.priority * 10);
      marker.bindTooltip(quickInfo(mark, ialaRegion(mark.lat, mark.lon)), {
        direction: 'top',
        offset: [0, -14],
        className: 'marnav-tip',
        opacity: 1,
      });
      marker.on('click', () => handlers.current.onSelectMark(mark));
      group.addLayer(marker);
    }
  }, [props.marks, props.zoom, props.preferences.overlays.navaids]);

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
      const rotation = vesselIsMoving(vessel) ? Math.round(vesselCourse(vessel)) : 0;
      const html = vesselIconSvg(vessel, size);
      const iconHtml = `<span class="marnav-ais" style="--rot:${rotation}deg">${html}</span>`;
      const label = vesselLabel(vessel);
      const existing = aisMarkersRef.current.get(vessel.mmsi);

      if (!existing) {
        const marker = L.marker([vessel.lat, vessel.lon], {
          icon: L.divIcon({
            className: 'marnav-ais-wrap',
            html: iconHtml,
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2],
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
        aisMarkersRef.current.set(vessel.mmsi, { marker, vessel, iconHtml, label });
        continue;
      }

      existing.vessel = vessel;
      existing.marker.setLatLng([vessel.lat, vessel.lon]);
      if (existing.iconHtml !== iconHtml) {
        existing.marker.setIcon(
          L.divIcon({
            className: 'marnav-ais-wrap',
            html: iconHtml,
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2],
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
      {hoverVessel && hoverPoint && mapWidth > 0 && (
        <div
          className={`vessel-hover ${hoverPoint.y < 240 ? 'below' : 'above'}`}
          style={{ left: hoverLeft, top: hoverPoint.y }}
          aria-hidden="true"
        >
          <div dangerouslySetInnerHTML={{ __html: vesselTooltipHtml(hoverVessel) }} />
        </div>
      )}
    </div>
  );
});
