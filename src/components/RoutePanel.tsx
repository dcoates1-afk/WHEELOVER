import { useState } from 'react';
import { formatLatLon } from '../lib/coordinates';
import { formatEtaHours, routeTotals, type RouteWaypoint } from '../lib/routes';

interface RoutePanelProps {
  waypoints: RouteWaypoint[];
  speedKnots: number;
  adding: boolean;
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
