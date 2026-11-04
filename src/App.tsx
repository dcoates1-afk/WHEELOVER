import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { selectVisibleNavaids } from '../shared/navaid-core.mjs';
import type { Navaid } from './lib/navaidTypes';
import type { SeedExtract } from './lib/navaidDb';
import { isUsWaters } from './components/MapCanvas';
import type { MapHandle } from './components/MapCanvas';
import type { DbInfo } from './components/LayerControl';
import { GpsWidget } from './components/GpsWidget';
import { LocateButton } from './components/LocateButton';
import { DestinationSearch } from './components/DestinationSearch';
import { PinsPanel } from './components/PinsPanel';
import { BoatPanel } from './components/BoatPanel';
import RoutePanel from './components/RoutePanel';
import MobPanel from './components/MobPanel';
import NavStrip from './components/NavStrip';
import TideStationPanel from './components/TideStationPanel';
import type { DestinationResult } from './lib/destinationSearch';
import { createPin, loadPins, removePin, updatePin, writePins, type Pin } from './lib/pins';
import {
  loadRoute,
  loadRouteSpeed,
  writeRoute,
  writeRouteSpeed,
  type RouteWaypoint,
} from './lib/routes';
import {
  createSavedRoute,
  loadSavedRoutes,
  writeSavedRoutes,
  type SavedRoute,
} from './lib/savedRoutes';
import {
  clearMob,
  createMobRecord,
  loadMob,
  mobRangeFromFix,
  writeMob,
  type MobRecord,
} from './lib/mob';
import {
  loadChecklist,
  loadFuel,
  loadFuelTankCapacity,
  loadLogbook,
  loadMaintenance,
  writeChecklist,
  writeFuel,
  writeFuelTankCapacity,
  writeLogbook,
  writeMaintenance,
  type FuelFill,
  type LogEntry,
  type MaintenanceTask,
} from './lib/boatLog';
import {
  advanceNavTarget,
  navTarget,
  shouldFollowPan,
} from './lib/navigation';
import { loadTideStations, type TideStation } from './lib/tides';
import {
  appendPoint,
  createTrack,
  loadTracks,
  writeTracks,
  type Track,
} from './lib/tracks';
import {
  fetchNotmarWarnings,
  type NotmarWarning,
} from './lib/notmars';
import { ZoomControls } from './components/ZoomControls';

const MapCanvas = lazy(() => import('./components/MapCanvas').then((module) => ({ default: module.MapCanvas })));
const LayerControl = lazy(() => import('./components/LayerControl').then((module) => ({ default: module.LayerControl })));
const NavaidSheet = lazy(() => import('./components/NavaidSheet').then((module) => ({ default: module.NavaidSheet })));
const VesselSheet = lazy(() => import('./components/VesselSheet').then((module) => ({ default: module.VesselSheet })));
const StationDrawer = lazy(() => import('./components/StationDrawer').then((module) => ({ default: module.StationDrawer })));
const WeatherMenu = lazy(() => import('./components/WeatherMenu').then((module) => ({ default: module.WeatherMenu })));
import type { AisVessel } from './lib/ais';
import { useAis } from './hooks/useAis';
import { useChartAlerts } from './hooks/useChartAlerts';
import { useGeolocation } from './hooks/useGeolocation';
import { ChartAlerts } from './components/ChartAlerts';
import {
  readChartPreferences,
  writeChartPreferences,
} from './lib/chartPreferences';
import type { ChartPreferences } from './lib/chartPreferences';
import { filterNavaidsByGroups } from './lib/navaidGroups';
import { annotateTransits, reconcileLightRank } from './lib/navaids';
import {
  formatBytes,
  noaaCacheStats,
  planNoaaTiles,
  prefetchNoaaTiles,
} from './lib/noaaChart';
import { openingView, readLastFix, shouldAutoCentre, writeLastFix } from './lib/locate';
import { readGpsMode, writeGpsMode } from './lib/gpsPreference';
import { readSettings, writeSettings } from './lib/settings';
import type { AppSettings } from './lib/settings';
import { readVoyageWatch, writeVoyageWatch } from './lib/voyageWatch';
import type { VoyageWatch } from './lib/voyageWatch';
import type { GpsMode } from './lib/gpsPreference';
import { navaidDatabase, regionForPoint } from './lib/navaidDb';
import { ialaRegion } from './lib/navaids';
import type { NavaidManifest } from './lib/navaidDb';
import { queryChartFeaturePart, queryNavaids, type ChartFeature, type ChartFeaturePart } from './lib/overpass';
import { loadMarineData, type MarineFeature } from './lib/marineDb';
import {
  applyLightSectorIndex,
  loadLightSectors,
  standaloneLightMarks,
  type LightSectorEntry,
} from './lib/lightSectors';
import { applyMarkSignals, loadMarkSignals, type SignalEntry } from './lib/markSignals';
import { applyMarkDetailIndex, loadMarkDetails, type MarkDetailEntry } from './lib/markDetails';
import { loadNatura2000, type ProtectedAreaFeature } from './lib/protectedAreas';
import { POI_MIN_ZOOM, queryPois } from './lib/pois';
import type { Poi } from './lib/pois';
import type { StationTab } from './lib/station';

interface ViewState {
  bounds: [number, number, number, number];
  zoom: number;
  center: [number, number];
}

interface DbReport {
  manifest: NavaidManifest | null;
  checkedAt: number | null;
}

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export default function App() {
  const storage = useMemo(safeStorage, []);
  const mapRef = useRef<MapHandle | null>(null);

  const [preferences, setPreferences] = useState<ChartPreferences>(() =>
    readChartPreferences(typeof window === 'undefined' ? null : safeStorage()),
  );
  const [gpsMode, setGpsMode] = useState<GpsMode>(() =>
    readGpsMode(typeof window === 'undefined' ? null : safeStorage()),
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [weatherOpen, setWeatherOpen] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(() =>
    readSettings(typeof window === 'undefined' ? null : safeStorage()),
  );
  const [watch, setWatch] = useState<VoyageWatch>(() =>
    readVoyageWatch(typeof window === 'undefined' ? null : safeStorage()),
  );
  const [station, setStation] = useState<StationTab | null>(null);
  const [selectedMark, setSelectedMark] = useState<Navaid | null>(null);
  const [selectedVessel, setSelectedVessel] = useState<AisVessel | null>(null);
  // The target picked from the AIS list or the chart. It survives closing the
  // sheet so the vessel is still ringed on the chart afterwards.
  const [highlightedVessel, setHighlightedVessel] = useState<number | null>(null);
  // Place picked from destination search, pinned on the chart until it is
  // tapped away or a new search replaces it.
  const [searchPin, setSearchPin] = useState<DestinationResult | null>(null);
  const clearSearchPin = useCallback(() => setSearchPin(null), []);
  // The navigator's own place pins, kept on this device only.
  const [pins, setPins] = useState<Pin[]>(() => loadPins(safeStorage()));
  const [pinsOpen, setPinsOpen] = useState(false);
  const [placingPin, setPlacingPin] = useState(false);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const selectPin = useCallback((pin: Pin) => {
    setSelectedPinId(pin.id);
    setPinsOpen(true);
  }, []);
  // The boat's own records, kept on this device only.
  const [logbook, setLogbook] = useState<LogEntry[]>(() => loadLogbook(safeStorage()));
  const [checked, setChecked] = useState<Record<string, boolean>>(() => loadChecklist(safeStorage()));
  const [maintenance, setMaintenance] = useState<MaintenanceTask[]>(() => loadMaintenance(safeStorage()));
  const [fuel, setFuel] = useState<FuelFill[]>(() => loadFuel(safeStorage()));
  const [boatOpen, setBoatOpen] = useState(false);
  // Own track recording, sampled from the GPS fix and kept on this device.
  const [tracks, setTracks] = useState<Track[]>(() => loadTracks(safeStorage()));
  const [recording, setRecording] = useState<Track | null>(null);
  const [shownTrackId, setShownTrackId] = useState<string | null>(null);
  // Manual route, kept on this device only. Adding stays armed across taps
  // so a route can be tapped out in one go; Done or closing the panel disarms.
  const [routeWaypoints, setRouteWaypoints] = useState<RouteWaypoint[]>(() => loadRoute(safeStorage()));
  const [routeOpen, setRouteOpen] = useState(false);
  const [routeAdding, setRouteAdding] = useState(false);
  const [speedKnots, setSpeedKnots] = useState<number>(() => loadRouteSpeed(safeStorage()));
  // Named saved routes, kept on this device only. Loading one replaces the
  // active route; the builder always works on a single route.
  const [savedRoutes, setSavedRoutes] = useState<SavedRoute[]>(() => loadSavedRoutes(safeStorage()));
  // Man overboard: at most one recorded position, kept on this device only.
  const [mob, setMob] = useState<MobRecord | null>(() => loadMob(safeStorage()));
  const [mobOpen, setMobOpen] = useState(false);
  // Active navigation along the route, driven by the GPS fix. navIndex is
  // the waypoint being aimed at (starting at the second waypoint); follow
  // pauses when the navigator moves the chart by hand.
  const [navigating, setNavigating] = useState(false);
  const [navIndex, setNavIndex] = useState(1);
  const [followPaused, setFollowPaused] = useState(false);
  // Tide stations for the layer, loaded once when the layer is switched on.
  const [tideStations, setTideStations] = useState<TideStation[] | null>(null);
  const [selectedTideStation, setSelectedTideStation] = useState<TideStation | null>(null);
  // Fuel tank capacity in litres, kept on this device only.
  const [tankCapacityL, setTankCapacityL] = useState<number | null>(() => loadFuelTankCapacity(safeStorage()));
  // In-force NGA broadcast warnings, fetched through the app's own relay
  // (the NGA API sends no CORS headers). Kept after first load so toggling
  // the layer back on is instant; toggle off/on refetches on next mount.
  const [warnings, setWarnings] = useState<NotmarWarning[] | null>(null);
  const [warningsError, setWarningsError] = useState<string | null>(null);
  // Tracking info keeps the target it was given and follows the live snapshot,
  // so a page left open keeps reading as the transponder reports again.
  const [trackingVessel, setTrackingVessel] = useState<AisVessel | null>(null);
  // Deep link first, then the last known position, then the Solent default.
  const deepLink = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const lat = Number.parseFloat(params.get('lat') ?? '');
    const lon = Number.parseFloat(params.get('lon') ?? '');
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const zoomParam = Number.parseFloat(params.get('z') ?? '');
    return {
      lat,
      lon,
      zoom: Number.isFinite(zoomParam) ? Math.min(18, Math.max(2, zoomParam)) : null,
    };
  }, []);
  const cachedFix = useMemo(
    () => (gpsMode === 'on' ? readLastFix(storage) : null),
    [gpsMode, storage],
  );
  const initialView = useMemo(() => {
    const start = openingView(deepLink, cachedFix);
    const center: [number, number] = start ? [start.lat, start.lon] : [50.76, -1.2];
    const zoom = deepLink?.zoom ?? (cachedFix ? 14 : 11);
    const span = 360 / 2 ** zoom;
    return {
      center,
      zoom,
      bounds: [center[0] - span / 2, center[1] - span / 2, center[0] + span / 2, center[1] + span / 2] as [
        number,
        number,
        number,
        number,
      ],
    };
  }, [deepLink, cachedFix]);

  const [view, setView] = useState<ViewState>(initialView);
  /** Where the weather forecast point comes from: the GPS fix, or the centre of the screen. */
  const [weatherMode, setWeatherMode] = useState<'gps' | 'center'>('gps');
  const [noaaCovered, setNoaaCovered] = useState(false);
  const [marks, setMarks] = useState<Navaid[]>([]);
  const [worldwideNavaids, setWorldwideNavaids] = useState<Navaid[] | null>(null);
  // Sector bearings for the worldwide archive marks, loaded by viewport.
  const [lightSectorIndex, setLightSectorIndex] = useState<Map<string, LightSectorEntry>>(new Map());
  // Sound signals and racons, which the archive snapshot did not carry.
  const [markSignalIndex, setMarkSignalIndex] = useState<Map<string, SignalEntry>>(new Map());
  // The rest of each mark's charted detail, which the archive dropped too.
  const [markDetailIndex, setMarkDetailIndex] = useState<Map<string, MarkDetailEntry>>(new Map());
  const [pois, setPois] = useState<Poi[]>([]);
  const [marineFeatures, setMarineFeatures] = useState<{ ferries: MarineFeature[]; bridges: MarineFeature[]; tss: MarineFeature[] } | null>(null);
  const [chartFeatures, setChartFeatures] = useState<ChartFeature[]>([]);
  const [protectedAreaFeatures, setProtectedAreaFeatures] = useState<ProtectedAreaFeature[]>([]);
  const [markSource, setMarkSource] = useState<{ live: boolean; cached: boolean }>({ live: false, cached: true });
  const [db, setDb] = useState<DbReport>({ manifest: null, checkedAt: null });
  const [checking, setChecking] = useState(false);
  const [checkMessage, setCheckMessage] = useState<string | null>(null);
  const [chartCache, setChartCache] = useState<{ tiles: number; bytes: number } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const geo = useGeolocation(gpsMode);
  const aisEnabled = station === 'ais' || station === 'tracking' || preferences.overlays.ais;
  const ais = useAis(aisEnabled, view.bounds);
  // Depth, traffic, anchor and course alerts follow the fix, the latest AIS
  // snapshot and the watch set from the menu.
  const alerts = useChartAlerts({ fix: geo.fix, vessels: ais.vessels, settings, watch });

  // Keep an open vessel sheet on the latest snapshot: speed, course and status
  // move while the sheet is open, and a target that drops out of range keeps
  // its last known detail rather than blinking shut.
  useEffect(() => {
    setSelectedVessel((current) =>
      current ? (ais.vessels.find((vessel) => vessel.mmsi === current.mmsi) ?? current) : current,
    );
    setTrackingVessel((current) =>
      current ? (ais.vessels.find((vessel) => vessel.mmsi === current.mmsi) ?? current) : current,
    );
  }, [ais.vessels]);

  // The chart opens on the vessel: the first live fix recentres once, unless the
  // link named a position or the navigator has already panned somewhere.
  const autoCentred = useRef(false);
  const userMoved = useRef(false);
  useEffect(() => {
    const fix = geo.fix;
    if (!fix) return;
    writeLastFix(storage, fix);
    const decided = shouldAutoCentre({
      hasFix: true,
      hasDeepLink: Boolean(deepLink),
      userMoved: userMoved.current,
      alreadyCentred: autoCentred.current,
    });
    if (!decided) return;
    autoCentred.current = true;
    mapRef.current?.flyTo(fix.lat, fix.lon, Math.max(14, view.zoom));
  }, [geo.fix, storage, deepLink, view.zoom]);

  // "Centre on me": recentre on the fix, or explain why there isn't one.
  const [locateNote, setLocateNote] = useState<string | null>(null);
  const pendingLocate = useRef(false);
  useEffect(() => {
    if (!locateNote) return;
    const timer = setTimeout(() => setLocateNote(null), 5200);
    return () => clearTimeout(timer);
  }, [locateNote]);

  // The position panel covers the bottom-right corner, so the chart controls
  // step aside rather than sitting on top of its close button.
  const chartControlsHidden =
    menuOpen ||
    Boolean(station) ||
    Boolean(selectedMark) ||
    Boolean(selectedVessel) ||
    preferences.showPosition;
  // The pins and boat panels cover the bottom-left corner, so the other
  // chart controls step aside while either is open; the panel buttons stay.
  const chartControlsHiddenWithPanels = chartControlsHidden || pinsOpen || boatOpen || routeOpen || mobOpen || selectedTideStation !== null;

  const locateMe = useCallback(() => {
    if (gpsMode === 'off') {
      setLocateNote('Position is switched off. Turn GPS on in the menu to centre the chart.');
      return;
    }
    if (geo.fix) {
      mapRef.current?.flyTo(geo.fix.lat, geo.fix.lon, Math.max(15, view.zoom));
      setLocateNote(null);
      return;
    }
    if (geo.status === 'error') {
      setLocateNote(geo.error ?? 'No position fix yet.');
      return;
    }
    pendingLocate.current = true;
    setLocateNote('Finding your position…');
  }, [gpsMode, geo.fix, geo.status, geo.error, view.zoom]);

  useEffect(() => {
    if (!pendingLocate.current || !geo.fix) return;
    pendingLocate.current = false;
    mapRef.current?.flyTo(geo.fix.lat, geo.fix.lon, Math.max(15, view.zoom));
    setLocateNote(null);
  }, [geo.fix, view.zoom]);

  useEffect(() => {
    writeChartPreferences(storage, preferences);
  }, [preferences, storage]);

  useEffect(() => {
    writeGpsMode(storage, gpsMode);
  }, [gpsMode, storage]);

  useEffect(() => {
    writeSettings(storage, settings);
  }, [settings, storage]);

  useEffect(() => {
    writeVoyageWatch(storage, watch);
  }, [watch, storage]);

  useEffect(() => {
    writePins(storage, pins);
  }, [pins, storage]);

  useEffect(() => {
    writeLogbook(storage, logbook);
  }, [logbook, storage]);

  useEffect(() => {
    writeChecklist(storage, checked);
  }, [checked, storage]);

  useEffect(() => {
    writeMaintenance(storage, maintenance);
  }, [maintenance, storage]);

  useEffect(() => {
    writeFuel(storage, fuel);
  }, [fuel, storage]);

  useEffect(() => {
    writeTracks(storage, tracks);
  }, [tracks, storage]);

  useEffect(() => {
    writeRoute(storage, routeWaypoints);
  }, [routeWaypoints, storage]);

  useEffect(() => {
    writeRouteSpeed(storage, speedKnots);
  }, [speedKnots, storage]);

  useEffect(() => {
    writeSavedRoutes(storage, savedRoutes);
  }, [savedRoutes, storage]);

  useEffect(() => {
    if (mob) writeMob(storage, mob);
    else clearMob(storage);
  }, [mob, storage]);

  useEffect(() => {
    writeFuelTankCapacity(storage, tankCapacityL);
  }, [tankCapacityL, storage]);

  // Tide stations load once, when the layer is switched on.
  useEffect(() => {
    if (!preferences.overlays.tideStations || tideStations !== null) return;
    let cancelled = false;
    loadTideStations().then((stations) => {
      if (!cancelled) setTideStations(stations);
    });
    return () => {
      cancelled = true;
    };
  }, [preferences.overlays.tideStations, tideStations]);

  // Navigation target from the fix, advanced as waypoints are reached.
  const navTargetValue = useMemo(
    () => (navigating ? navTarget(geo.fix, routeWaypoints, navIndex) : null),
    [navigating, geo.fix, routeWaypoints, navIndex],
  );
  const navCompleteValue = useMemo(() => {
    if (!navigating) return false;
    return advanceNavTarget(geo.fix, routeWaypoints, navIndex).complete;
  }, [navigating, geo.fix, routeWaypoints, navIndex]);
  useEffect(() => {
    if (!navigating || !geo.fix) return;
    const next = advanceNavTarget(geo.fix, routeWaypoints, navIndex);
    if (next.index !== navIndex) setNavIndex(next.index);
  }, [navigating, geo.fix, routeWaypoints, navIndex]);
  useEffect(() => {
    if (navigating && routeWaypoints.length < 2) setNavigating(false);
  }, [navigating, routeWaypoints]);


  // Sample the GPS fix into the live track. appendPoint drops fixes within
  // 25 m of the last point, so the effect is quiet while at anchor.
  useEffect(() => {
    const fix = geo.fix;
    if (!recording || !fix) return;
    setRecording((current) => (current ? appendPoint(current, fix) : current));
  }, [geo.fix, recording]);

  // Load NGA warnings when the layer is switched on. A failure leaves a
  // note in the menu instead of a broken layer; switching the layer off
  // clears the error so switching it back on retries.
  useEffect(() => {
    if (!preferences.overlays.warnings && warningsError !== null) {
      setWarningsError(null);
    }
  }, [preferences.overlays.warnings, warningsError]);

  useEffect(() => {
    if (!preferences.overlays.warnings || warnings !== null || warningsError !== null) return;
    let cancelled = false;
    fetchNotmarWarnings()
      .then((loaded) => {
        if (!cancelled) setWarnings(loaded);
      })
      .catch(() => {
        if (!cancelled) setWarningsError('NGA warnings could not be loaded — try switching the layer off and on again.');
      });
    return () => {
      cancelled = true;
    };
  }, [preferences.overlays.warnings, warnings, warningsError]);

  // Manifest + weekly revalidation, once per session.
  useEffect(() => {
    let cancelled = false;
    void navaidDatabase.init().then((report) => {
      if (cancelled) return;
      setDb({
        manifest: report.manifest,
        checkedAt: report.checked ? Date.now() : navaidDatabase.getCheckedAt(),
      });
      if (!report.manifest) {
        void import('./data/solentNavaids.json').then(({ default: seedExtract }) => {
          if (!cancelled) setMarks((seedExtract as SeedExtract).navaids);
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load marks for the current view: built shards first, live query otherwise.
  const requestId = useRef(0);
  useEffect(() => {
    const id = ++requestId.current;
    let cancelled = false;
    const manifest = db.manifest;
    const region = manifest ? regionForPoint(manifest, view.center[0], view.center[1]) : null;

    const timer = setTimeout(() => {
      void (async () => {
        if (region) {
          const result = await navaidDatabase.load(view.bounds);
          if (cancelled || id !== requestId.current) return;
          if (result.navaids.length > 0) {
            setMarks(result.navaids);
            setMarkSource({ live: false, cached: result.fetched === 0 });
            return;
          }
        }

        const [south, west, north, east] = view.bounds;
        const span = Math.max(north - south, east - west);
        if (view.zoom < 8 || span > 3) {
          if (!cancelled && id === requestId.current) setMarks([]);
          return;
        }

        try {
          const live = await queryNavaids(view.bounds);
          if (cancelled || id !== requestId.current) return;
          setMarks(live.navaids);
          setMarkSource({ live: true, cached: live.cached });
        } catch {
          // An aborted or failed live query must not blank a chart that already
          // has marks on it: keep the last set and let the next pan retry. The
          // marks are geo-positioned, so stale ones cannot move under the boat.
        }
      })();
    }, 320);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [view, db.manifest, reloadKey]);

  // Ferry routes and TSS load from the versioned archive by visible bounds.
  // Retain the last successful set while the next viewport is fetched, so a
  // slow shard request cannot blank the overlay and make lanes appear missing.
  const marineRequestId = useRef(0);
  useEffect(() => {
    const id = ++marineRequestId.current;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void loadMarineData(view.bounds, { signal: controller.signal })
        .then((features) => {
          if (id === marineRequestId.current) {
            setMarineFeatures({ ferries: features.ferries, bridges: features.bridges, tss: features.tss });
            setWorldwideNavaids(features.navaids);
          }
        })
        .catch(() => {
          // Keep the last successful overlay or checked-in regional bundle on
          // fetch failures; never replace useful chart geometry with emptiness.
        });
      // Sector bearings are a separate index because the worldwide archive was
      // built without them. A failure leaves the marks drawn without sectors,
      // never without the marks.
      void loadLightSectors(view.bounds, { signal: controller.signal })
        .then((sectors) => {
          if (id === marineRequestId.current) setLightSectorIndex(sectors);
        })
        .catch(() => {});
      // Sound signals and racons are indexed separately for the same reason:
      // the archive snapshot dropped them. A failure leaves the marks without
      // their bell or racon, never without the mark itself.
      void loadMarkSignals(view.bounds, { signal: controller.signal })
        .then((signals) => {
          if (id === marineRequestId.current) setMarkSignalIndex(signals);
        })
        .catch(() => {});
      // The remaining charted detail — topmark, shape, colours, structure,
      // heights, light references — is indexed the same way.
      void loadMarkDetails(view.bounds, { signal: controller.signal })
        .then((details) => {
          if (id === marineRequestId.current) setMarkDetailIndex(details);
        })
        .catch(() => {});
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [view.bounds]);

  // Bridges and protected-area outlines are OSM context overlays; marine
  // areas are always fetched and filtered per type in the Legend & mark filters.
  const chartFeatureRequestId = useRef(0);
  // The view an answer arrived for, per half. A mirror dropping mid-refresh used
  // to blank an overlay that was already drawn for this same view; keeping the
  // matching answer means a failed re-fetch no longer removes what is on screen.
  const chartFeatureAnswerFor = useRef('');
  const chartFeatureHalves = useRef<{ bridges: ChartFeature[]; areas: ChartFeature[] }>({ bridges: [], areas: [] });
  useEffect(() => {
    const parts: ChartFeaturePart[] = [];
    if (preferences.overlays.bridges) parts.push('bridges');
    parts.push('areas');
    const [south, west, north, east] = view.bounds;
    const viewKey = view.bounds.map((value) => value.toFixed(3)).join(',');
    if (parts.length === 0 || view.zoom < 8 || north - south > 2 || east - west > 2) {
      // Drop any answer still in flight, so it cannot refill a cleared overlay.
      chartFeatureRequestId.current += 1;
      chartFeatureAnswerFor.current = '';
      chartFeatureHalves.current = { bridges: [], areas: [] };
      setChartFeatures([]);
      return;
    }
    const timer = setTimeout(() => {
      // Not aborted on a view change: the map settles in several steps, and an
      // abort on each one left the overlay with no reply at all. Stale answers
      // are dropped by request id instead, and the proxy caches the query. The
      // id is taken when the query fires, not when it is scheduled: a render
      // during the debounce otherwise superseded the reply and left the overlay
      // empty even though the request had succeeded.
      const id = ++chartFeatureRequestId.current;
      // A new view starts with empty halves; the previous view's marks must not
      // linger over water they do not belong to.
      if (chartFeatureAnswerFor.current !== viewKey) {
        chartFeatureHalves.current = { bridges: [], areas: [] };
        chartFeatureAnswerFor.current = viewKey;
      }
      const publish = () => {
        if (id !== chartFeatureRequestId.current) return;
        const { bridges, areas } = chartFeatureHalves.current;
        setChartFeatures([...areas, ...bridges]);
      };
      for (const part of parts) {
        void queryChartFeaturePart(view.bounds, part)
          .then(({ features }) => {
            if (id !== chartFeatureRequestId.current) return;
            // Each half draws on its own arrival: bridges no longer wait for the
            // larger protected-area reply.
            chartFeatureHalves.current = { ...chartFeatureHalves.current, [part]: features };
            publish();
          })
          .catch(() => {
            if (id !== chartFeatureRequestId.current) return;
            // A dead mirror says nothing about this view, so a half already
            // drawn for the same view stays put.
          });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [preferences.overlays.bridges, view]);

  const protectedAreaRequestId = useRef(0);
  useEffect(() => {
    if (view.zoom < 6) {
      // Drop any answer still in flight, so it cannot refill a cleared overlay.
      protectedAreaRequestId.current += 1;
      setProtectedAreaFeatures([]);
      return;
    }
    const [south, west, north, east] = view.bounds;
    if (north - south > 2 || east - west > 2) {
      protectedAreaRequestId.current += 1;
      setProtectedAreaFeatures([]);
      return;
    }
    const timer = setTimeout(() => {
      // Same rule as the bridge overlay: the id is taken when the query fires
      // and only a newer query supersedes an answer. Scheduling the id instead
      // let a render during the debounce cancel the reply, and aborting on every
      // re-run lost requests outright, so a successful fetch could leave the
      // overlay empty. A superseded answer is dropped by id, not aborted.
      const id = ++protectedAreaRequestId.current;
      void loadNatura2000(view.bounds)
        .then((features) => {
          if (id === protectedAreaRequestId.current) setProtectedAreaFeatures(features);
        })
        .catch(() => {
          if (id === protectedAreaRequestId.current) setProtectedAreaFeatures([]);
        });
    }, 450);
    return () => clearTimeout(timer);
  }, [view]);

  // Public places follow the viewport and only load once a harbour-scale view
  // is on screen. A stale answer for an older view is discarded by request id.
  const poiRequestId = useRef(0);
  useEffect(() => {
    if (!preferences.overlays.pois || view.zoom < POI_MIN_ZOOM) {
      setPois([]);
      return;
    }
    const id = ++poiRequestId.current;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void queryPois(view.bounds, { signal: controller.signal })
        .then((result) => {
          if (id === poiRequestId.current) setPois(result.pois);
        })
        .catch(() => {
          // A failed place query leaves the last set on the chart; the pins are
          // geo-positioned, so they cannot drift under a pan.
        });
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [preferences.overlays.pois, view]);

  // Warm the active region once the first shard load settles.
  useEffect(() => {
    if (!db.manifest) return;
    const region = regionForPoint(db.manifest, view.center[0], view.center[1]);
    if (!region) return;
    const timer = setTimeout(() => {
      void navaidDatabase.prefetchRegion(region.id);
    }, 1500);
    return () => clearTimeout(timer);
  }, [db.manifest, view.center, reloadKey]);

  // Legend filters apply before declutter, so a switched-off class never eats
  // into the marker budget that the marks still on screen need.
  // Pair the front and rear lights of each transit before declutter, so both
  // ends carry the leading line's bearing even if only one survives on screen.
  const chartedMarks = useMemo(() => {
    const merged = new Map((worldwideNavaids ?? marks).map((mark) => [mark.id, mark]));
    // Preserve richer regional source metadata when the worldwide archive has
    // a matching mark but an older or less-complete record.
    for (const local of marks) {
      const global = merged.get(local.id);
      if (!global) {
        merged.set(local.id, local);
        continue;
      }
      const enriched = { ...global } as Navaid;
      for (const [key, value] of Object.entries(local)) {
        const current = (enriched as unknown as Record<string, unknown>)[key];
        if ((current === null || current === undefined || current === '') && value !== null && value !== undefined && value !== '') {
          (enriched as unknown as Record<string, unknown>)[key] = value;
        }
      }
      if (!global.lightSectors?.length && local.lightSectors?.length) enriched.lightSectors = local.lightSectors;
      // Booleans are not empty strings, so the field sweep above skips them.
      if (!global.fogSignal && local.fogSignal) enriched.fogSignal = local.fogSignal;
      if (!global.radarReflector && local.radarReflector) enriched.radarReflector = local.radarReflector;
      // A light the archive does not record must take the regional class, or it
      // keeps the archive's unlit rank and stays hidden at low zoom.
      merged.set(local.id, reconcileLightRank(enriched, local));
    }
    // Attach worldwide sector bearings last, so a regional record that already
    // carries checked sectors keeps them.
    const withSectors = applyLightSectorIndex([...merged.values()], lightSectorIndex);
    // A few charted lights have no archive mark at all; their sectors come in
    // with the index, so the mark is drawn from the index too.
    const withStandalone = [...withSectors, ...standaloneLightMarks(lightSectorIndex, withSectors)];
    // Sound signals and racons last, filling only what the mark still lacks.
    const withSignals = applyMarkSignals(withStandalone, markSignalIndex);
    // Charted detail fills whatever the mark still has blank.
    const withDetails = applyMarkDetailIndex(withSignals, markDetailIndex);
    return annotateTransits(filterNavaidsByGroups(withDetails, preferences.hiddenGroups));
  }, [marks, worldwideNavaids, lightSectorIndex, markSignalIndex, markDetailIndex, preferences.hiddenGroups]);

  const marksInView = useMemo(() => {
    const [south, west, north, east] = view.bounds;
    return chartedMarks.filter(
      (mark) => mark.lat >= south && mark.lat <= north && mark.lon >= west && mark.lon <= east,
    );
  }, [chartedMarks, view.bounds]);

  const visibleMarks = useMemo(
    () =>
      selectVisibleNavaids(chartedMarks, {
        zoom: view.zoom,
        bounds: view.bounds,
        center: view.center,
      }),
    [chartedMarks, view],
  );

  const dbInfo: DbInfo | null = useMemo(() => {
    const manifest = db.manifest;
    if (!manifest) return null;
    return {
      version: manifest.version,
      builtAt: manifest.generatedAt,
      count: manifest.stats.uniqueAids,
      duplicates: manifest.stats.duplicatesRemoved,
      sources: manifest.sources.map((source) => source.name),
      checkedAt: db.checkedAt,
    };
  }, [db]);

  const configure = useCallback((next: ChartPreferences) => {
    setPreferences(next);
  }, []);

  const changeGpsMode = useCallback((mode: GpsMode) => {
    setGpsMode(mode);
  }, []);

  const centreOn = useCallback((lat: number, lon: number, zoom = 14) => {
    mapRef.current?.flyTo(lat, lon, zoom);
  }, []);

  // Follow: recentre only when the fix nears the edge of the view, so
  // following does not refetch the overlay on every fix.
  useEffect(() => {
    if (!navigating || !geo.fix || followPaused) return;
    const spanDeg = 360 / 2 ** view.zoom;
    if (shouldFollowPan(geo.fix.lat, geo.fix.lon, view.center[0], view.center[1], spanDeg)) {
      centreOn(geo.fix.lat, geo.fix.lon, view.zoom);
    }
  }, [navigating, geo.fix, followPaused, view, centreOn]);

  const checkForUpdates = useCallback(async () => {
    setChecking(true);
    setCheckMessage('Checking NAVAID database…');
    const result = await navaidDatabase.ensureFresh(true);
    setDb({
      manifest: navaidDatabase.getManifest(),
      checkedAt: navaidDatabase.getCheckedAt(),
    });
    if (result.updated) setReloadKey((key) => key + 1);
    const dbNote = result.updated
      ? 'New database version downloaded — chart marks refreshed.'
      : result.checked
        ? 'Database is up to date.'
        : 'Update check could not reach the server.';

    // The same check keeps the NOAA chart pack for this area on the device.
    let chartNote = '';
    if (preferences.base !== 'noaa') {
      chartNote = ' Chart tiles are cached when NOAA ENC is the active base.';
    } else if (!isUsWaters(view.center[0], view.center[1])) {
      chartNote = ' NOAA charts cover US waters only, so no tiles were cached.';
    } else {
      const zooms = [Math.round(view.zoom), Math.round(view.zoom) + 1, Math.round(view.zoom) + 2];
      const tiles = planNoaaTiles(view.bounds, zooms, { max: 48, isCovered: isUsWaters });
      const stats = await prefetchNoaaTiles(tiles, {
        onProgress: (done, total) => {
          if (done % 4 === 0 || done === total) setCheckMessage(`Saving chart tiles ${done}/${total}…`);
        },
      });
      const reused = stats.cached > 0 ? `, ${stats.cached} already cached` : '';
      chartNote = ` Chart pack: ${stats.saved} new tiles (${formatBytes(stats.bytes)})${reused}`;
      if (stats.failed > 0) chartNote += `, ${stats.failed} unavailable`;
      chartNote += '.';
    }

    mapRef.current?.refreshBase();
    setChartCache(await noaaCacheStats());
    setChecking(false);
    setCheckMessage(`${dbNote}${chartNote}`);
  }, [preferences.base, view.bounds, view.center, view.zoom]);

  useEffect(() => {
    let cancelled = false;
    void noaaCacheStats().then((stats) => {
      if (!cancelled) setChartCache(stats);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const onViewChange = useCallback(
    (bounds: [number, number, number, number], zoom: number, center: [number, number]) => {
      setView({ bounds, zoom, center });
    },
    [],
  );

  // The weather forecast point follows the toggle: the live GPS fix when one
  // exists, otherwise the centre of the screen (which only updates once the
  // user stops panning, so the forecast refetches once per settled view).
  const weatherAt: [number, number] =
    weatherMode === 'gps' && geo.fix ? [geo.fix.lat, geo.fix.lon] : view.center;

  return (
    <div className={`app theme-${preferences.theme}`}>
      <Suspense fallback={<div className="app-loading" role="status">Loading chart tools…</div>}>
      <MapCanvas
        ref={mapRef}
        initialCenter={initialView.center}
        initialZoom={initialView.zoom}
        preferences={preferences}
        marks={visibleMarks}
        pois={pois}
        zoom={view.zoom}
        marineFeatures={marineFeatures}
        chartFeatures={chartFeatures}
        protectedAreaFeatures={protectedAreaFeatures}
        onSelectMark={(mark) => {
          setSelectedVessel(null);
          setSelectedMark(mark);
        }}
        onSelectVessel={(vessel) => {
          setSelectedMark(null);
          setSelectedVessel(vessel);
          setHighlightedVessel(vessel.mmsi);
        }}
        onViewChange={onViewChange}
        onUserMove={() => {
          userMoved.current = true;
          // Moving the chart by hand pauses follow; the strip offers Resume.
          if (navigating) setFollowPaused(true);
        }}
        onNoaaCoverageChange={setNoaaCovered}
        onMapClick={(_lat, _lon) => {
          if (placingPin) {
            // Placing mode: the tap drops a pin instead of clearing anything.
            const pin = createPin(_lat, _lon);
            setPins((current) => [...current, pin]);
            setPlacingPin(false);
            setSelectedPinId(pin.id);
            setPinsOpen(true);
            return;
          }
          if (routeAdding) {
            // Route adding stays armed across taps so a route can be tapped
            // out in one go; Done or closing the panel disarms it.
            setRouteWaypoints((current) => [...current, { lat: _lat, lon: _lon }]);
            return;
          }
          // Tapping open water puts the picked target down again.
          setHighlightedVessel(null);
          setSearchPin(null);
        }}
        searchPin={searchPin}
        onSearchPinClear={clearSearchPin}
        pins={pins}
        selectedPinId={selectedPinId}
        onSelectPin={selectPin}
        activeTrack={recording}
        shownTrack={tracks.find((track) => track.id === shownTrackId) ?? null}
        routeWaypoints={routeWaypoints}
        mob={mob}
        tideStations={preferences.overlays.tideStations ? tideStations : null}
        onSelectTideStation={(station) => {
          setSelectedTideStation(station);
          setPinsOpen(false);
          setBoatOpen(false);
          setRouteOpen(false);
          setMobOpen(false);
        }}
        onRouteWaypointMove={(index, lat, lon) =>
          setRouteWaypoints((current) => current.map((point, i) => (i === index ? { lat, lon } : point)))
        }
        warnings={preferences.overlays.warnings ? warnings : null}
        fix={geo.fix}
        aisVessels={ais.vessels}
        selectedVesselMmsi={highlightedVessel}
        watch={watch}
        coordinateFormat={settings.units.coordinates}
        distanceUnit={settings.units.distance}
        depthUnit={settings.units.depth}
      />

      {preferences.theme === 'red' && <div className="red-tint" aria-hidden="true" />}

      <h1 className="chart-brand" aria-label="@ Wheel-over — Maritime Navigation and Planning">
        @ Wheel-over
      </h1>

      <Suspense fallback={null}>
        <WeatherMenu
          open={weatherOpen}
          onOpen={setWeatherOpen}
          lat={weatherAt[0]}
          lon={weatherAt[1]}
          mode={weatherMode}
          onModeChange={setWeatherMode}
          hasFix={Boolean(geo.fix)}
          units={settings.units}
          hidden={Boolean(station || selectedMark || selectedVessel)}
        />
      </Suspense>

      <ZoomControls
        hidden={chartControlsHiddenWithPanels}
        onZoomIn={() => mapRef.current?.zoomIn()}
        onZoomOut={() => mapRef.current?.zoomOut()}
      />

      <LocateButton
        fix={geo.fix}
        status={geo.status}
        hidden={chartControlsHiddenWithPanels}
        onLocate={locateMe}
      />

      <DestinationSearch
        hidden={chartControlsHiddenWithPanels}
        onSelect={(result) => {
          setSearchPin(result);
          centreOn(result.lat, result.lon, 14);
        }}
      />

      <button
        type="button"
        className={`pins-button ${chartControlsHidden ? 'is-hidden' : ''}`}
        onClick={() => {
          setPinsOpen((open) => !open);
          setBoatOpen(false);
          setRouteOpen(false);
          setMobOpen(false);
          setSelectedTideStation(null);
        }}
        aria-label="Place pins"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path
            d="M12 1.5 C7.5 1.5 4 5 4 9.5 C4 15 12 22.5 12 22.5 C12 22.5 20 15 20 9.5 C20 5 16.5 1.5 12 1.5 Z"
            fill="#f2a65a"
            stroke="#04141f"
            strokeWidth="1.2"
          />
          <circle cx="12" cy="9.5" r="3.5" fill="#04141f" />
        </svg>
        <span>Pins{pins.length > 0 ? ` (${pins.length})` : ''}</span>
      </button>

      <button
        type="button"
        className={`boat-button ${chartControlsHidden ? 'is-hidden' : ''}`}
        onClick={() => {
          setBoatOpen((open) => !open);
          setPinsOpen(false);
          setRouteOpen(false);
          setMobOpen(false);
          setSelectedTideStation(null);
        }}
        aria-label="Boat log"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <rect x="4" y="3" width="16" height="18" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <line x1="8" y1="8" x2="16" y2="8" stroke="currentColor" strokeWidth="1.8" />
          <line x1="8" y1="12" x2="16" y2="12" stroke="currentColor" strokeWidth="1.8" />
          <line x1="8" y1="16" x2="13" y2="16" stroke="currentColor" strokeWidth="1.8" />
        </svg>
        <span>Boat log</span>
        {recording && <span className="boat-recording-dot" aria-label="Recording track" />}
      </button>

      <button
        type="button"
        className={`route-button ${chartControlsHidden ? 'is-hidden' : ''}`}
        onClick={() => {
          setRouteOpen((open) => !open);
          setPinsOpen(false);
          setBoatOpen(false);
          setMobOpen(false);
          setSelectedTideStation(null);
        }}
        aria-label="Route builder"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path
            d="M4 20 L9 14 L13 17 L20 4"
            fill="none"
            stroke="#3dd6ff"
            strokeWidth="1.8"
            strokeDasharray="3 2"
          />
          <circle cx="4" cy="20" r="2.5" fill="#3dd6ff" />
          <circle cx="20" cy="4" r="2.5" fill="#3dd6ff" />
        </svg>
        <span>Route{routeWaypoints.length > 0 ? ` (${routeWaypoints.length})` : ''}</span>
      </button>

      <button
        type="button"
        className={`mob-button ${chartControlsHidden ? 'is-hidden' : ''}`}
        onClick={() => {
          if (!mob) {
            const fix = geo.fix;
            const record = fix
              ? createMobRecord(fix.lat, fix.lon, true)
              : createMobRecord(view.center[0], view.center[1], false);
            setMob(record);
            setMobOpen(true);
          } else {
            setMobOpen((open) => !open);
          }
          setPinsOpen(false);
          setBoatOpen(false);
          setRouteOpen(false);
          setSelectedTideStation(null);
        }}
        aria-label="Man overboard"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <circle cx="12" cy="12" r="9" fill="none" stroke="#ff6b5e" strokeWidth="2.4" />
          <circle cx="12" cy="12" r="3" fill="#ff6b5e" />
        </svg>
        <span>MOB</span>
      </button>

      {pinsOpen && (
        <PinsPanel
          pins={pins}
          selectedId={selectedPinId}
          placing={placingPin}
          onClose={() => {
            setPinsOpen(false);
            setPlacingPin(false);
          }}
          onAdd={() => setPlacingPin(true)}
          onCancelPlacing={() => setPlacingPin(false)}
          onSelect={(pin) => {
            setSelectedPinId(pin.id);
            centreOn(pin.lat, pin.lon, 14);
          }}
          onUpdate={(id, patch) => setPins((current) => updatePin(current, id, patch))}
          onDelete={(id) => {
            setPins((current) => removePin(current, id));
            setSelectedPinId((current) => (current === id ? null : current));
          }}
        />
      )}

      {boatOpen && (
        <BoatPanel
          logbook={logbook}
          onAddLog={(entry) =>
            setLogbook((current) => [...current, entry].sort((a, b) => (a.date < b.date ? 1 : -1)))
          }
          onDeleteLog={(id) => setLogbook((current) => current.filter((entry) => entry.id !== id))}
          checked={checked}
          onToggleCheck={(id) =>
            setChecked((current) => {
              const next = { ...current };
              if (next[id]) delete next[id];
              else next[id] = true;
              return next;
            })
          }
          onResetChecklist={() => setChecked({})}
          maintenance={maintenance}
          onAddMaintenance={(task) => setMaintenance((current) => [...current, task])}
          onDoneMaintenance={(id, date) =>
            setMaintenance((current) =>
              current.map((task) => (task.id === id ? { ...task, lastDone: date } : task)),
            )
          }
          onDeleteMaintenance={(id) =>
            setMaintenance((current) => current.filter((task) => task.id !== id))
          }
          fuel={fuel}
          onAddFuel={(fill) =>
            setFuel((current) => [...current, fill].sort((a, b) => (a.date < b.date ? 1 : -1)))
          }
          onDeleteFuel={(id) => setFuel((current) => current.filter((fill) => fill.id !== id))}
          tankCapacityL={tankCapacityL}
          onTankCapacityChange={setTankCapacityL}
          tracks={tracks}
          recording={recording}
          hasFix={Boolean(geo.fix)}
          shownTrackId={shownTrackId}
          onStartRecording={() => setRecording(createTrack())}
          onStopRecording={() => {
            if (!recording) return;
            const finished: Track = { ...recording, endedAt: Date.now() };
            setTracks((current) => [finished, ...current]);
            setRecording(null);
          }}
          onShowTrack={(id) => {
            setShownTrackId(id);
            if (id) {
              const track = tracks.find((candidate) => candidate.id === id);
              const middle = track?.points[Math.floor(track.points.length / 2)];
              if (middle) centreOn(middle.lat, middle.lon, 12);
            }
          }}
          onDeleteTrack={(id) => {
            setTracks((current) => current.filter((track) => track.id !== id));
            setShownTrackId((current) => (current === id ? null : current));
          }}
          onClose={() => setBoatOpen(false)}
        />
      )}

      {routeOpen && (
        <RoutePanel
          waypoints={routeWaypoints}
          speedKnots={speedKnots}
          adding={routeAdding}
          areas={chartFeatures}
          protectedAreas={protectedAreaFeatures}
          ferries={marineFeatures?.ferries ?? []}
          tss={marineFeatures?.tss ?? []}
          draughtM={(() => {
            const parsed = Number(settings.boat.draughtM);
            return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
          })()}
          fuelBurnLph={(() => {
            const parsed = Number(settings.boat.fuelBurnLph);
            return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
          })()}
          navigating={navigating}
          navTarget={navTargetValue}
          navComplete={navCompleteValue}
          followPaused={followPaused}
          onStartNavigation={() => {
            setNavIndex(1);
            setFollowPaused(false);
            setNavigating(true);
          }}
          onStopNavigation={() => setNavigating(false)}
          onResumeFollow={() => setFollowPaused(false)}
          onNextWaypoint={() =>
            setNavIndex((current) => Math.min(current + 1, Math.max(1, routeWaypoints.length - 1)))
          }
          savedRoutes={savedRoutes}
          onSaveRoute={(name) => {
            if (routeWaypoints.length < 2) return;
            setSavedRoutes((current) => {
              const next = [createSavedRoute(name, routeWaypoints, speedKnots), ...current];
              return next.sort((a, b) => b.createdAt - a.createdAt);
            });
          }}
          onLoadRoute={(route) => {
            setRouteWaypoints(route.waypoints.map((point) => ({ ...point })));
            setSpeedKnots(route.speedKnots);
            setRouteAdding(false);
            if (route.waypoints.length > 0) {
              centreOn(route.waypoints[0].lat, route.waypoints[0].lon, 14);
            }
          }}
          onDeleteSavedRoute={(id) => setSavedRoutes((current) => current.filter((route) => route.id !== id))}
          onClose={() => {
            setRouteOpen(false);
            setRouteAdding(false);
          }}
          onAdd={() => setRouteAdding(true)}
          onCancelAdding={() => setRouteAdding(false)}
          onSpeedChange={setSpeedKnots}
          onClear={() => setRouteWaypoints([])}
          onRemoveWaypoint={(index) =>
            setRouteWaypoints((current) => current.filter((_, i) => i !== index))
          }
          onCentreWaypoint={(waypoint) => centreOn(waypoint.lat, waypoint.lon, 14)}
          onAddTyped={(lat, lon) => setRouteWaypoints((current) => [...current, { lat, lon }])}
        />
      )}

      {mobOpen && mob && (
        <MobPanel
          mob={mob}
          fix={geo.fix}
          range={mobRangeFromFix(geo.fix, mob)}
          onUpdate={() => {
            const fix = geo.fix;
            setMob(
              fix
                ? createMobRecord(fix.lat, fix.lon, true)
                : createMobRecord(view.center[0], view.center[1], false),
            );
          }}
          onClear={() => {
            setMob(null);
            setMobOpen(false);
          setSelectedTideStation(null);
          }}
          onClose={() => setMobOpen(false)}
        />
      )}

      {selectedTideStation && (
        <TideStationPanel
          station={selectedTideStation}
          onClose={() => setSelectedTideStation(null)}
        />
      )}

      {navigating && (
        <NavStrip
          fix={geo.fix}
          target={navTargetValue}
          complete={navCompleteValue}
          followPaused={followPaused}
          units={settings.units}
          onStop={() => setNavigating(false)}
          onResumeFollow={() => setFollowPaused(false)}
          onOpenRoute={() => {
            setRouteOpen(true);
            setPinsOpen(false);
            setBoatOpen(false);
            setMobOpen(false);
            setSelectedTideStation(null);
          }}
        />
      )}

      {locateNote && (
        <p className="chart-toast" role="status" aria-live="polite">
          {locateNote}
        </p>
      )}

      <ChartAlerts
        alerts={alerts}
        sound={settings.notifications.sound}
        vibration={settings.notifications.vibration}
        hidden={weatherOpen || Boolean(station || selectedMark || selectedVessel)}
      />

      <LayerControl
        open={menuOpen}
        onOpen={setMenuOpen}
        preferences={preferences}
        onChange={configure}
        gpsMode={gpsMode}
        onGpsMode={changeGpsMode}
        geoStatus={geo.status}
        geoError={geo.error}
        markStats={{
          shown: visibleMarks.length,
          total: marksInView.length,
          live: markSource.live,
          cached: markSource.cached,
        }}
        dbInfo={dbInfo}
        onCheckUpdates={() => void checkForUpdates()}
        checking={checking}
        checkMessage={checkMessage}
        chartCache={chartCache}
        station={station}
        onStation={setStation}
        noaaCovered={noaaCovered}
        legendRegion={ialaRegion(view.center[0], view.center[1])}
        settings={settings}
        onSettings={setSettings}
        fix={geo.fix}
        watch={watch}
        onWatch={setWatch}
        warnings={warnings}
        warningsError={warningsError}
        onSelectWarning={(warning) => {
          const first = warning.positions[0];
          if (first) centreOn(first.lat, first.lon, 10);
        }}
        hidden={Boolean(station || selectedMark || selectedVessel)}
      />

      {preferences.showPosition && (
        <GpsWidget
          fix={geo.fix}
          status={geo.status}
          error={geo.error}
          gpsMode={gpsMode}
          onCentre={() => {
            if (geo.fix) centreOn(geo.fix.lat, geo.fix.lon, 14);
          }}
          onEnable={() => changeGpsMode('on')}
          units={settings.units}
          onClose={() => configure({ ...preferences, showPosition: false })}
        />
      )}

      {station && (
        <StationDrawer
          station={station}
          onStation={setStation}
          onClose={() => setStation(null)}
          aisState={ais.state}
          aisVessels={ais.vessels}
          aisNote={ais.note}
          aisScope={ais.scope}
          center={view.center}
          showAisOnChart={preferences.overlays.ais}
          onToggleAisChart={(value) =>
            configure({ ...preferences, overlays: { ...preferences.overlays, ais: value } })
          }
          trackingVessel={trackingVessel}
          onSelectTracking={(mmsi) =>
            setTrackingVessel(mmsi === null ? null : (ais.vessels.find((vessel) => vessel.mmsi === mmsi) ?? null))
          }
          onCentreVessel={(vessel) => {
            // Whatever the chart is flown to is also the picked target, so the
            // mark you asked for keeps its ring once the flight settles.
            setHighlightedVessel(vessel.mmsi);
            centreOn(vessel.lat, vessel.lon, Math.max(view.zoom, 14));
          }}
          onOpenVesselSheet={(vessel) => {
            setStation(null);
            setSelectedVessel(vessel);
          }}
          depthUnit={settings.units.depth}
          coordinateFormat={settings.units.coordinates}
          onFocusVessel={(vessel) => {
            setStation(null);
            setSelectedVessel(vessel);
            setHighlightedVessel(vessel.mmsi);
            centreOn(vessel.lat, vessel.lon, Math.max(view.zoom, 14));
          }}
          // A target picked from the AIS list opens its tracking card in the
          // same drawer, so the list and the card stay one place to work from.
          onOpenTracking={(vessel) => {
            setTrackingVessel(vessel);
            setStation('tracking');
          }}
          distanceUnit={settings.units.distance}
        />
      )}

      {selectedVessel && (
        <VesselSheet
          vessel={selectedVessel}
          centre={view.center}
          onCentre={(vessel) => {
            centreOn(vessel.lat, vessel.lon, Math.max(view.zoom, 14));
            setSelectedVessel(null);
          }}
          onClose={() => setSelectedVessel(null)}
          distanceUnit={settings.units.distance}
          depthUnit={settings.units.depth}
        />
      )}

      {selectedMark && (
        <NavaidSheet
          mark={selectedMark}
          partner={
            selectedMark.transitPartner
              ? (chartedMarks.find((mark) => mark.id === selectedMark.transitPartner) ?? null)
              : null
          }
          onCentre={(mark) => {
            centreOn(mark.lat, mark.lon, 15);
            setSelectedMark(null);
          }}
          onShowPartner={(mark) => {
            centreOn(mark.lat, mark.lon, Math.max(view.zoom, 15));
            setSelectedMark(mark);
          }}
          onClose={() => setSelectedMark(null)}
          distanceUnit={settings.units.distance}
        />
      )}
      </Suspense>
    </div>
  );
}
