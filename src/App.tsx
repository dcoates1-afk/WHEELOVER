import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { selectVisibleNavaids } from '../shared/navaid-core.mjs';
import type { Navaid } from './lib/navaidTypes';
import { MapCanvas, isUsWaters } from './components/MapCanvas';
import type { MapHandle } from './components/MapCanvas';
import { LayerControl } from './components/LayerControl';
import type { DbInfo } from './components/LayerControl';
import { GpsWidget } from './components/GpsWidget';
import { LocateButton } from './components/LocateButton';
import { ZoomControls } from './components/ZoomControls';
import { NavaidSheet } from './components/NavaidSheet';
import { VesselSheet } from './components/VesselSheet';
import { StationDrawer } from './components/StationDrawer';
import type { AisVessel } from './lib/ais';
import { useAis } from './hooks/useAis';
import { useGeolocation } from './hooks/useGeolocation';
import {
  readChartPreferences,
  writeChartPreferences,
} from './lib/chartPreferences';
import type { ChartPreferences } from './lib/chartPreferences';
import { filterNavaidsByGroups } from './lib/navaidGroups';
import { annotateTransits } from './lib/navaids';
import {
  formatBytes,
  noaaCacheStats,
  planNoaaTiles,
  prefetchNoaaTiles,
} from './lib/noaaChart';
import { openingView, readLastFix, shouldAutoCentre, writeLastFix } from './lib/locate';
import { readGpsMode, writeGpsMode } from './lib/gpsPreference';
import type { GpsMode } from './lib/gpsPreference';
import { navaidDatabase, regionForPoint } from './lib/navaidDb';
import { ialaRegion } from './lib/navaids';
import type { NavaidManifest } from './lib/navaidDb';
import { queryNavaids } from './lib/overpass';
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
  const [station, setStation] = useState<StationTab | null>(null);
  const [selectedMark, setSelectedMark] = useState<Navaid | null>(null);
  const [selectedVessel, setSelectedVessel] = useState<AisVessel | null>(null);
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
  const [weatherAt, setWeatherAt] = useState<[number, number]>(() => [
    initialView.center[0],
    initialView.center[1],
  ]);
  const [noaaCovered, setNoaaCovered] = useState(false);
  const [marks, setMarks] = useState<Navaid[]>(() => navaidDatabase.seed());
  const [pois, setPois] = useState<Poi[]>([]);
  const [markSource, setMarkSource] = useState<{ live: boolean; cached: boolean }>({ live: false, cached: true });
  const [db, setDb] = useState<DbReport>({ manifest: null, checkedAt: null });
  const [checking, setChecking] = useState(false);
  const [checkMessage, setCheckMessage] = useState<string | null>(null);
  const [chartCache, setChartCache] = useState<{ tiles: number; bytes: number } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const geo = useGeolocation(gpsMode);
  const aisEnabled = station === 'ais' || preferences.overlays.ais;
  const ais = useAis(aisEnabled, view.bounds);

  // Keep an open vessel sheet on the latest snapshot: speed, course and status
  // move while the sheet is open, and a target that drops out of range keeps
  // its last known detail rather than blinking shut.
  useEffect(() => {
    setSelectedVessel((current) =>
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

  // Manifest + weekly revalidation, once per session.
  useEffect(() => {
    let cancelled = false;
    void navaidDatabase.init().then((report) => {
      if (cancelled) return;
      setDb({
        manifest: report.manifest,
        checkedAt: report.checked ? Date.now() : navaidDatabase.getCheckedAt(),
      });
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
  const chartedMarks = useMemo(
    () => annotateTransits(filterNavaidsByGroups(marks, preferences.hiddenGroups)),
    [marks, preferences.hiddenGroups],
  );

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
        showAll: preferences.showAllMarks,
        center: view.center,
      }),
    [chartedMarks, view, preferences.showAllMarks],
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

  return (
    <div className={`app theme-${preferences.theme}`}>
      <MapCanvas
        ref={mapRef}
        initialCenter={initialView.center}
        initialZoom={initialView.zoom}
        preferences={preferences}
        marks={visibleMarks}
        pois={pois}
        zoom={view.zoom}
        onSelectMark={(mark) => {
          setSelectedVessel(null);
          setSelectedMark(mark);
        }}
        onSelectVessel={(vessel) => {
          setSelectedMark(null);
          setSelectedVessel(vessel);
        }}
        onViewChange={onViewChange}
        onUserMove={() => {
          userMoved.current = true;
        }}
        onNoaaCoverageChange={setNoaaCovered}
        onMapClick={(lat, lon) => setWeatherAt([lat, lon])}
        fix={geo.fix}
        aisVessels={ais.vessels}
      />

      {preferences.theme === 'red' && <div className="red-tint" aria-hidden="true" />}

      <h1 className="chart-brand" aria-label="WHEELOVER — Maritime Navigation and Planning">
        WHEELOVER
      </h1>

      <ZoomControls
        hidden={chartControlsHidden}
        onZoomIn={() => mapRef.current?.zoomIn()}
        onZoomOut={() => mapRef.current?.zoomOut()}
      />

      <LocateButton
        fix={geo.fix}
        status={geo.status}
        hidden={chartControlsHidden}
        onLocate={locateMe}
      />

      {locateNote && (
        <p className="chart-toast" role="status" aria-live="polite">
          {locateNote}
        </p>
      )}

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
          onFocusVessel={(vessel) => {
            setStation(null);
            setSelectedVessel(vessel);
            centreOn(vessel.lat, vessel.lon, Math.max(view.zoom, 14));
          }}
          weatherAt={weatherAt}
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
        />
      )}
    </div>
  );
}
