import { useEffect, useMemo, useRef, useState } from 'react';
import { formatLatLon } from '../lib/coordinates';
import { formatEtaHours, routeTotals, type RouteWaypoint } from '../lib/routes';
import type { SavedRoute } from '../lib/savedRoutes';
import { checkRouteHazards } from '../lib/routeHazards';
import {
  evaluateGrounding,
  fetchGebcoElevations,
  sampleRoute,
  type GroundingResult,
} from '../lib/routeGrounding';
import { loadClearanceDatasets, type ClearanceDatasets } from '../lib/clearances';
import { checkRouteAirDraft, type AirDraftResult } from '../lib/routeAirDraft';
import { fetchWeather } from '../lib/weather';
import { verdictForReport, type WeatherVerdict } from '../lib/routeWeather';
import type { ChartFeature } from '../lib/overpass';
import type { ProtectedAreaFeature } from '../lib/protectedAreas';
import type { MarineFeature } from '../lib/marineDb';
import type { NavTarget } from '../lib/navigation';

interface RoutePanelProps {
  waypoints: RouteWaypoint[];
  speedKnots: number;
  adding: boolean;
  areas: ChartFeature[];
  protectedAreas: ProtectedAreaFeature[];
  ferries: MarineFeature[];
  tss: MarineFeature[];
  /** Boat draught in metres, or null when the navigator has not set one. */
  draughtM: number | null;
  /** Boat air draft in metres, or null when the navigator has not set one. */
  airDraftM: number | null;
  /** Fuel burn in litres per hour, or null when the navigator has not set one. */
  fuelBurnLph: number | null;
  /** Active navigation state, driven by the app's GPS fix. */
  navigating: boolean;
  navTarget: NavTarget | null;
  navComplete: boolean;
  followPaused: boolean;
  onStartNavigation: () => void;
  onStopNavigation: () => void;
  onResumeFollow: () => void;
  onNextWaypoint: () => void;
  savedRoutes: SavedRoute[];
  onClose: () => void;
  onAdd: () => void;
  onCancelAdding: () => void;
  onSpeedChange: (speedKnots: number) => void;
  onClear: () => void;
  onSaveRoute: (name: string) => void;
  onLoadRoute: (route: SavedRoute) => void;
  onDeleteSavedRoute: (id: string) => void;
  onRemoveWaypoint: (index: number) => void;
  onCentreWaypoint: (waypoint: RouteWaypoint) => void;
  onAddTyped: (lat: number, lon: number) => void;
}

/**
 * Manual route builder panel. Waypoints come from chart taps or typed
 * coordinates, and the panel shows per-leg distance and bearing plus the
 * total and ETA from the editable cruising speed. Safety checks (weather
 * verdict, hazard check, anti-grounding flag) arrive on top of this builder.
 */
export default function RoutePanel(props: RoutePanelProps) {
  const totals = routeTotals(props.waypoints, props.speedKnots);
  const hazards = useMemo(
    () =>
      checkRouteHazards({
        waypoints: props.waypoints,
        areas: props.areas,
        protectedAreas: props.protectedAreas,
        ferries: props.ferries,
        tss: props.tss,
      }),
    [props.waypoints, props.areas, props.protectedAreas, props.ferries, props.tss],
  );
  const hazardCount = hazards.reduce((sum, leg) => sum + leg.hazards.length, 0);
  const [marginM, setMarginM] = useState(1);
  const [grounding, setGrounding] = useState<{
    result: GroundingResult;
    signature: string;
  } | null>(null);
  const [groundingLoading, setGroundingLoading] = useState(false);
  const groundingController = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      groundingController.current?.abort();
    },
    [],
  );
  const waypointSignature = JSON.stringify(props.waypoints);
  const draughtM = props.draughtM;
  // The check's inputs: waypoints, draught and margin. When any of them
  // changes the stored result is stale and the auto-recalc below re-runs it.
  const groundingSignature = `${waypointSignature}|${draughtM ?? ''}|${marginM}`;
  const groundingStale = grounding !== null && grounding.signature !== groundingSignature;

  // Auto-recalc: once a grounding result exists, re-run it (debounced) when
  // its inputs change, so the flags track the route instead of going stale.
  useEffect(() => {
    if (grounding === null || grounding.signature === groundingSignature) return;
    if (props.waypoints.length < 2 || draughtM === null || groundingLoading) return;
    const timer = setTimeout(() => {
      void runGroundingCheck();
    }, 800);
    return () => clearTimeout(timer);
    // runGroundingCheck is re-created each render; the values it reads are
    // the effect's dependencies, so the closure is always current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grounding, groundingSignature, draughtM, marginM, groundingLoading]);

  const runGroundingCheck = async () => {
    const draught = props.draughtM;
    if (draught === null || props.waypoints.length < 2) return;
    groundingController.current?.abort();
    const controller = new AbortController();
    groundingController.current = controller;
    setGroundingLoading(true);
    try {
      const points = sampleRoute(props.waypoints);
      const elevations = await fetchGebcoElevations(points, controller.signal);
      if (controller.signal.aborted) return;
      const samples = points.map((point) => ({
        ...point,
        elevation: elevations.get(`${point.lat.toFixed(5)}:${point.lon.toFixed(5)}`) ?? null,
      }));
      setGrounding({
        result: evaluateGrounding(samples, draught, marginM),
        signature: groundingSignature,
      });
    } finally {
      if (!controller.signal.aborted) setGroundingLoading(false);
    }
  };
  const [latText, setLatText] = useState('');
  const [lonText, setLonText] = useState('');
  const [typedError, setTypedError] = useState<string | null>(null);
  const [saveName, setSaveName] = useState('');

  // Air-draft check, mirroring the grounding check: same margin, same
  // button-driven run, same stale-signature auto-recalc. Bridge data is
  // the chart features the panel already receives; only the clearance
  // datasets need fetching, and they are cached per session.
  const airDraftM = props.airDraftM;
  const bridgeIds = props.areas
    .filter((feature) => feature.type === 'bridge')
    .map((feature) => feature.id)
    .join(',');
  const [airDraft, setAirDraft] = useState<{
    result: AirDraftResult;
    datasetsLoaded: boolean;
    signature: string;
  } | null>(null);
  const [airDraftLoading, setAirDraftLoading] = useState(false);
  const airDraftSignature = `${waypointSignature}|${airDraftM ?? ''}|${marginM}|${bridgeIds}`;
  const airDraftStale = airDraft !== null && airDraft.signature !== airDraftSignature;

  const runAirDraftCheck = async () => {
    const airDraft = props.airDraftM;
    if (airDraft === null || props.waypoints.length < 2) return;
    setAirDraftLoading(true);
    try {
      const datasets: ClearanceDatasets = await loadClearanceDatasets();
      setAirDraft({
        result: checkRouteAirDraft({
          waypoints: props.waypoints,
          bridges: props.areas,
          datasets,
          airDraftM: airDraft,
          marginM,
        }),
        datasetsLoaded: datasets.manifest.generatedAt !== '',
        signature: airDraftSignature,
      });
    } finally {
      setAirDraftLoading(false);
    }
  };

  // Auto-recalc: once an air-draft result exists, re-run it (debounced)
  // when its inputs change, so the flags track the route instead of going
  // stale. The datasets promise is cached, so re-runs cost no fetch.
  useEffect(() => {
    if (airDraft === null || airDraft.signature === airDraftSignature) return;
    if (props.waypoints.length < 2 || airDraftM === null || airDraftLoading) return;
    const timer = setTimeout(() => {
      void runAirDraftCheck();
    }, 800);
    return () => clearTimeout(timer);
    // runAirDraftCheck is re-created each render; the values it reads are
    // the effect's dependencies, so the closure is always current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [airDraft, airDraftSignature, airDraftM, marginM, airDraftLoading]);

  // Weather verdict, mirroring the grounding check: button-driven run,
  // same stale-signature auto-recalc. Conditions come from Open-Meteo at
  // the route midpoint sample, current hour — one point on the route, not
  // a forecast for every leg, so the verdict is a planning aid only.
  const weatherSignature = waypointSignature;
  const [weather, setWeather] = useState<{
    verdict: WeatherVerdict;
    point: { lat: number; lon: number };
    signature: string;
  } | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState(false);
  const weatherController = useRef<AbortController | null>(null);
  const weatherStale = weather !== null && weather.signature !== weatherSignature;

  const runWeatherCheck = async () => {
    if (props.waypoints.length < 2) return;
    weatherController.current?.abort();
    const controller = new AbortController();
    weatherController.current = controller;
    setWeatherLoading(true);
    setWeatherError(false);
    try {
      const samples = sampleRoute(props.waypoints);
      const point = samples[Math.floor(samples.length / 2)] ?? props.waypoints[0];
      const report = await fetchWeather(point.lat, point.lon, controller.signal);
      if (controller.signal.aborted) return;
      setWeather({ verdict: verdictForReport(report), point, signature: weatherSignature });
    } catch {
      if (!controller.signal.aborted) setWeatherError(true);
    } finally {
      if (!controller.signal.aborted) setWeatherLoading(false);
    }
  };

  useEffect(
    () => () => {
      weatherController.current?.abort();
    },
    [],
  );

  // Auto-recalc: once a weather result exists, re-run it (debounced) when
  // the route changes, so the verdict tracks the route instead of going stale.
  useEffect(() => {
    if (weather === null || weather.signature === weatherSignature) return;
    if (props.waypoints.length < 2 || weatherLoading) return;
    const timer = setTimeout(() => {
      void runWeatherCheck();
    }, 800);
    return () => clearTimeout(timer);
    // runWeatherCheck is re-created each render; the values it reads are
    // the effect's dependencies, so the closure is always current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weather, weatherSignature, weatherLoading]);

  const addTyped = () => {
    const lat = Number(latText);
    const lon = Number(lonText);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
      setTypedError('Enter a valid latitude (-90 to 90) and longitude (-180 to 180).');
      return;
    }
    setTypedError(null);
    setLatText('');
    setLonText('');
    props.onAddTyped(lat, lon);
  };

  return (
    <section className="route-panel" aria-label="Route builder">
      <div className="route-panel-head">
        <h2>Route</h2>
        <span className="route-count">{props.waypoints.length}</span>
        <button type="button" className="route-close" onClick={props.onClose} aria-label="Close route builder">
          ×
        </button>
      </div>
      <p className="route-note">
        Tap waypoints on the chart or type coordinates. Drag any waypoint on the chart to move it.
        The route is saved on this device only.
      </p>
      {props.adding ? (
        <div className="route-adding">
          <span>Tap the chart to add waypoints.</span>
          <button type="button" onClick={props.onCancelAdding}>
            Done
          </button>
        </div>
      ) : (
        <button type="button" className="route-add" onClick={props.onAdd}>
          + Add waypoint
        </button>
      )}
      <div className="route-totals">
        <span>
          Total <strong>{totals.totalNm.toFixed(1)} NM</strong>
        </span>
        <span>
          ETA <strong>{formatEtaHours(totals.etaHours)}</strong>
        </span>
        {props.fuelBurnLph !== null && totals.etaHours !== null && (
          <span>
            Fuel <strong>~{(totals.etaHours * props.fuelBurnLph).toFixed(1)} L</strong>
          </span>
        )}
        <label>
          Speed (kn)
          <input
            type="number"
            min="0.1"
            step="0.5"
            value={props.speedKnots}
            onChange={(event) => {
              const speed = Number(event.target.value);
              if (Number.isFinite(speed) && speed > 0) props.onSpeedChange(speed);
            }}
          />
        </label>
      </div>
      {totals.legs.length > 0 && (
        <ol className="route-legs">
          {totals.legs.map((leg, index) => (
            <li key={index}>
              <button type="button" onClick={() => props.onCentreWaypoint(leg.from)}>
                W{index + 1} → W{index + 2}
              </button>
              <span>
                {leg.distanceNm.toFixed(1)} NM · {Math.round(leg.bearingDeg)}°
              </span>
            </li>
          ))}
        </ol>
      )}
      {props.waypoints.length >= 2 && (
        <div className="route-hazards">
          <h3>Navigate</h3>
          {!props.navigating ? (
            <>
              <p className="route-hazards-note">
                Follow your GPS fix along this route: the chart recentres as you sail and the
                panel reports the next waypoint. Nothing here steers the boat.
              </p>
              <button type="button" className="route-clear" onClick={props.onStartNavigation}>
                Start navigating
              </button>
            </>
          ) : (
            <>
              {props.navComplete ? (
                <p>Route complete — you have arrived at the last waypoint.</p>
              ) : props.navTarget !== null ? (
                <p>
                  Next: <strong>W{props.navTarget.index + 1}</strong> ·{' '}
                  <strong>{props.navTarget.distanceNm.toFixed(1)} NM</strong> · bearing{' '}
                  <strong>{Math.round(props.navTarget.bearingDeg)}°</strong>
                </p>
              ) : (
                <p className="route-hazards-note">Waiting for a GPS fix…</p>
              )}
              {props.followPaused && (
                <p className="route-hazards-note">
                  Follow paused because you moved the chart.{' '}
                  <button type="button" onClick={props.onResumeFollow}>
                    Resume follow
                  </button>
                </p>
              )}
              <button type="button" className="route-clear" onClick={props.onNextWaypoint}>
                Next waypoint
              </button>
              <button type="button" className="route-clear" onClick={props.onStopNavigation}>
                Stop navigating
              </button>
            </>
          )}
        </div>
      )}
      {props.waypoints.length >= 2 && (
        <div className="route-hazards">
          <h3>
            Hazards {hazardCount > 0 ? `(${hazardCount})` : ''}
          </h3>
          <p className="route-hazards-note">
            Mapped hazards only — marine areas, ferry lanes and traffic schemes whose chart data
            has loaded for this area. Pan the route&apos;s area first if a stretch looks empty.
            A clear leg is not a guarantee of safe water.
          </p>
          <ol className="route-hazards-legs">
            {hazards.map((leg) => (
              <li key={leg.legIndex}>
                <span>
                  W{leg.legIndex + 1} → W{leg.legIndex + 2}:{' '}
                </span>
                {leg.hazards.length === 0 ? (
                  <span>No mapped hazards</span>
                ) : (
                  <span>
                    {leg.hazards.map((hazard) => `${hazard.name} (${hazard.group})`).join(', ')}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
      {props.waypoints.length >= 2 && (
        <div className="route-hazards">
          <h3>Grounding</h3>
          {draughtM === null ? (
            <p className="route-hazards-note">
              Set your draught in the menu&apos;s boat details to run this check — without it
              there is nothing to compare the seabed against.
            </p>
          ) : (
            <>
              <p className="route-hazards-note">
                Samples the GEBCO seabed grid about every 250 m along the route and flags water
                shallower than draught plus margin, and grid cells at or above sea level. The
                grid is modelled at about 450 m and referenced to mean sea level, tide is not
                applied, and a narrow channel can read as land — a flag is a warning, never a
                guarantee, and no flags is not a promise of deep water.
              </p>
              <div className="route-totals">
                <label>
                  Margin (m)
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={marginM}
                    onChange={(event) => {
                      const margin = Number(event.target.value);
                      if (Number.isFinite(margin) && margin >= 0) setMarginM(margin);
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="route-clear"
                  style={{ marginTop: 0, width: 'auto' }}
                  onClick={runGroundingCheck}
                  disabled={groundingLoading}
                >
                  {groundingLoading ? 'Sampling…' : 'Check grounding'}
                </button>
              </div>
              {groundingStale && (
                <p className="route-hazards-note">
                  The route changed since this check — run it again for the current waypoints.
                </p>
              )}
              {grounding !== null && grounding.result.sampled === 0 && (
                <p className="route-hazards-note">
                  No grid values came back for this route, so the check could not run. Try again
                  when the connection is better.
                </p>
              )}
              {grounding !== null && grounding.result.sampled > 0 && (
                <>
                  {grounding.result.flags.length === 0 ? (
                    <p>No grounding flags on the sampled route.</p>
                  ) : (
                    <ol className="route-hazards-legs">
                      {grounding.result.flags.map((flag) => (
                        <li key={`${flag.legIndex}-${flag.kind}`}>
                          <span>
                            W{flag.legIndex + 1} → W{flag.legIndex + 2}:{' '}
                          </span>
                          {flag.kind === 'land' ? (
                            <span>
                              May cross land — grid elevation {flag.metres.toFixed(1)} m (
                              {flag.count} sample{flag.count === 1 ? '' : 's'}).
                            </span>
                          ) : (
                            <span>
                              Shallowest water {flag.metres.toFixed(1)} m, needs{' '}
                              {(draughtM + marginM).toFixed(1)} m ({flag.count} sample
                              {flag.count === 1 ? '' : 's'}).
                            </span>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                  <p className="route-hazards-note">
                    {grounding.result.sampled} samples
                    {grounding.result.unsampled > 0
                      ? `, ${grounding.result.unsampled} without a grid value`
                      : ''}
                    . Draught {draughtM.toFixed(1)} m + margin {marginM.toFixed(1)} m.
                  </p>
                </>
              )}
            </>
          )}
        </div>
      )}
      {props.waypoints.length >= 2 && (
        <div className="route-hazards">
          <h3>Air draft</h3>
          {airDraftM === null ? (
            <p className="route-hazards-note">
              Set your air draft in the menu&apos;s boat details to run this check — without it
              there is nothing to compare bridge clearances against.
            </p>
          ) : (
            <>
              <p className="route-hazards-note">
                Compares air draft plus margin against charted bridge clearances where the route
                crosses a bridge. Figures are judged at their stated datum with no tide applied —
                water above the datum eats clearance metre for metre, so recheck near high water.
                A figure with no stated datum can never count as a pass. Only bridges whose chart
                data has loaded for this area can be found. A flag is a warning, never a
                guarantee, and no flags is not a promise every bridge clears.
              </p>
              <div className="route-totals">
                <span>
                  Margin (m) <strong>{marginM.toFixed(1)}</strong> (set in the grounding check
                  above)
                </span>
                <button
                  type="button"
                  className="route-clear"
                  style={{ marginTop: 0, width: 'auto' }}
                  onClick={runAirDraftCheck}
                  disabled={airDraftLoading}
                >
                  {airDraftLoading ? 'Loading clearances…' : 'Check air draft'}
                </button>
              </div>
              {airDraftStale && (
                <p className="route-hazards-note">
                  The route changed since this check — run it again for the current waypoints.
                </p>
              )}
              {airDraft !== null && !airDraft.datasetsLoaded && (
                <p className="route-hazards-note">
                  Bridge clearance data did not load, so no bridge could be judged. Try again
                  when the connection is better.
                </p>
              )}
              {airDraft !== null && airDraft.datasetsLoaded && (
                <>
                  {airDraft.result.checks.length === 0 ? (
                    <p>No bridges crossed on this route.</p>
                  ) : (
                    <ol className="route-hazards-legs">
                      {airDraft.result.checks.map((check) => (
                        <li key={`${check.legIndex}-${check.bridgeId}`}>
                          <span>
                            W{check.legIndex + 1} → W{check.legIndex + 2}: {check.name}:{' '}
                          </span>
                          {check.verdict === 'fail' ? (
                            <span>
                              Will not clear — charted {check.clearanceM?.toFixed(1)} m
                              {check.datum ? ` (${check.datum})` : ''} under{' '}
                              {check.requiredM.toFixed(1)} m required.
                              {check.openM !== null && <> Opens to {check.openM.toFixed(1)} m.</>}
                            </span>
                          ) : check.verdict === 'pass' ? (
                            <span>
                              Clears at datum — charted {check.clearanceM?.toFixed(1)} m
                              {check.datum ? ` (${check.datum})` : ''} over{' '}
                              {check.requiredM.toFixed(1)} m required.
                              {check.least && (
                                <> (Group least — actual clearance is at least this.)</>
                              )}
                              {check.hasDatumUnknown && (
                                <> Also carries datum-unknown figures, not counted.</>
                              )}
                            </span>
                          ) : (
                            <span>
                              Cannot verify —{' '}
                              {check.clearanceM === null
                                ? check.hasDatumUnknown
                                  ? 'its figures carry no stated datum.'
                                  : 'no charted clearance figure for this bridge.'
                                : `its lowest figure is a group least of ${check.clearanceM.toFixed(1)} m, below ${check.requiredM.toFixed(1)} m required — the real clearance may still be higher.`}
                            </span>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                  <p className="route-hazards-note">
                    {airDraft.result.checks.length} bridge
                    {airDraft.result.checks.length === 1 ? '' : 's'} crossed. Air draft{' '}
                    {airDraftM.toFixed(1)} m + margin {marginM.toFixed(1)} m.
                  </p>
                </>
              )}
            </>
          )}
        </div>
      )}
      {props.waypoints.length >= 2 && (
        <div className="route-hazards">
          <h3>Weather</h3>
          <p className="route-hazards-note">
            Fetches Open-Meteo conditions at the route midpoint and judges them against the
            confirmed bands — Go under 15 kn wind, gusts under 20 kn, waves under 1 m and
            visibility over 5 NM; Caution to 25 kn wind, 30 kn gusts, 2 m waves and 2 NM
            visibility; beyond that No-go. The worst factor sets the verdict, and the verdict
            names it. A verdict is a planning aid, never a guarantee — conditions change, and
            the midpoint is one point on the route.
          </p>
          <div className="route-totals">
            <button
              type="button"
              className="route-clear"
              style={{ marginTop: 0, width: 'auto' }}
              onClick={runWeatherCheck}
              disabled={weatherLoading}
            >
              {weatherLoading ? 'Fetching weather…' : 'Check weather'}
            </button>
          </div>
          {weatherStale && (
            <p className="route-hazards-note">
              The route changed since this check — run it again for the current waypoints.
            </p>
          )}
          {weatherError && (
            <p className="route-hazards-note">
              Weather did not load, so the verdict could not run. Try again when the
              connection is better.
            </p>
          )}
          {weather !== null && (
            <>
              {weather.verdict.level === 'go' ? (
                <p>
                  <strong>Go</strong> — every assessed factor is in the Go band.
                </p>
              ) : weather.verdict.drivers.length > 0 ? (
                <p>
                  <strong>
                    {weather.verdict.level === 'caution' ? 'Caution' : 'No-go'}
                  </strong>{' '}
                  — driven by {weather.verdict.drivers.join(', ').toLowerCase()}.
                </p>
              ) : (
                <p>
                  <strong>Caution</strong> — no usable weather data came back.
                </p>
              )}
              <ol className="route-hazards-legs">
                {weather.verdict.factors.map((factor) => (
                  <li key={factor.name}>
                    <span>{factor.name}: </span>
                    {factor.display === null ? (
                      <span>No data — excluded from the verdict.</span>
                    ) : (
                      <span>
                        {factor.display} —{' '}
                        {factor.level === 'go'
                          ? 'Go'
                          : factor.level === 'caution'
                            ? 'Caution'
                            : 'No-go'}
                        .
                      </span>
                    )}
                  </li>
                ))}
              </ol>
              <p className="route-hazards-note">
                Conditions at the route midpoint (
                {formatLatLon(weather.point.lat, weather.point.lon)}), current hour.
              </p>
            </>
          )}
        </div>
      )}
      <ol className="route-waypoints">
        {props.waypoints.map((waypoint, index) => (
          <li key={index}>
            <button type="button" onClick={() => props.onCentreWaypoint(waypoint)}>
              W{index + 1} · {formatLatLon(waypoint.lat, waypoint.lon)}
            </button>
            <button type="button" aria-label={`Remove waypoint ${index + 1}`} onClick={() => props.onRemoveWaypoint(index)}>
              ×
            </button>
          </li>
        ))}
      </ol>
      <div className="route-typed">
        <input
          type="number"
          placeholder="Latitude"
          value={latText}
          onChange={(event) => setLatText(event.target.value)}
          aria-label="Waypoint latitude"
        />
        <input
          type="number"
          placeholder="Longitude"
          value={lonText}
          onChange={(event) => setLonText(event.target.value)}
          aria-label="Waypoint longitude"
        />
        <button type="button" onClick={addTyped}>
          Add
        </button>
      </div>
      {typedError && <p className="route-error">{typedError}</p>}
      <div className="route-hazards">
        <h3>Saved routes</h3>
        <p className="route-hazards-note">
          Save this route by name to return to it later. Loading a saved route replaces the
          current route.
        </p>
        <div className="route-typed">
          <input
            type="text"
            placeholder="Route name"
            value={saveName}
            onChange={(event) => setSaveName(event.target.value)}
            aria-label="Saved route name"
          />
          <button
            type="button"
            disabled={props.waypoints.length < 2}
            onClick={() => {
              props.onSaveRoute(saveName.trim() || `Route ${props.savedRoutes.length + 1}`);
              setSaveName('');
            }}
          >
            Save
          </button>
        </div>
        {props.savedRoutes.length === 0 ? (
          <p className="route-hazards-note">No saved routes yet.</p>
        ) : (
          <ol className="route-waypoints">
            {props.savedRoutes.map((route) => (
              <li key={route.id}>
                <button type="button" onClick={() => props.onLoadRoute(route)}>
                  {route.name} · {route.waypoints.length} waypoints
                </button>
                <button
                  type="button"
                  aria-label={`Delete saved route ${route.name}`}
                  onClick={() => props.onDeleteSavedRoute(route.id)}
                >
                  ×
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
      {props.waypoints.length > 0 && (
        <button type="button" className="route-clear" onClick={props.onClear}>
          Clear route
        </button>
      )}
    </section>
  );
}
