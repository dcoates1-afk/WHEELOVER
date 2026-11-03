import { useEffect, useMemo, useRef, useState } from 'react';
import { formatLatLon } from '../lib/coordinates';
import { formatEtaHours, routeTotals, type RouteWaypoint } from '../lib/routes';
import { checkRouteHazards } from '../lib/routeHazards';
import {
  evaluateGrounding,
  fetchGebcoElevations,
  sampleRoute,
  type GroundingResult,
} from '../lib/routeGrounding';
import type { ChartFeature } from '../lib/overpass';
import type { ProtectedAreaFeature } from '../lib/protectedAreas';
import type { MarineFeature } from '../lib/marineDb';

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
  onClose: () => void;
  onAdd: () => void;
  onCancelAdding: () => void;
  onSpeedChange: (speedKnots: number) => void;
  onClear: () => void;
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
  const groundingStale = grounding !== null && grounding.signature !== waypointSignature;

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
        signature: waypointSignature,
      });
    } finally {
      if (!controller.signal.aborted) setGroundingLoading(false);
    }
  };
  const [latText, setLatText] = useState('');
  const [lonText, setLonText] = useState('');
  const [typedError, setTypedError] = useState<string | null>(null);

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
      {props.waypoints.length > 0 && (
        <button type="button" className="route-clear" onClick={props.onClear}>
          Clear route
        </button>
      )}
    </section>
  );
}
