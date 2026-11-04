import { formatLatLon } from '../lib/coordinates';
import type { MobRange, MobRecord } from '../lib/mob';
import type { GeoFix } from '../hooks/useGeolocation';

interface MobPanelProps {
  mob: MobRecord;
  fix: GeoFix | null;
  range: MobRange | null;
  onUpdate: () => void;
  onClear: () => void;
  onClose: () => void;
}

/**
 * Man overboard panel. Shows where the MOB position was recorded, when,
 * and — while a GPS fix exists — the range and bearing back to it. This is
 * a marker and a return course, not an alarm: it sounds nothing and
 * transmits nothing.
 */
export default function MobPanel(props: MobPanelProps) {
  const { mob } = props;
  return (
    <section className="mob-panel" aria-label="Man overboard">
      <div className="route-panel-head">
        <h2>Man overboard</h2>
        <button type="button" className="route-close" onClick={props.onClose} aria-label="Close man overboard panel">
          ×
        </button>
      </div>
      <p className="route-note">
        {formatLatLon(mob.lat, mob.lon)} · {new Date(mob.at).toLocaleString()}
      </p>
      <p className="route-note">
        {mob.fromGps
          ? 'Recorded from your GPS fix.'
          : 'Recorded from the screen centre — no GPS fix at the time, so treat it as approximate.'}
      </p>
      {props.range !== null ? (
        <p>
          Back to MOB: <strong>{props.range.distanceNm.toFixed(1)} NM</strong> · bearing{' '}
          <strong>{Math.round(props.range.bearingDeg)}°</strong>
        </p>
      ) : (
        <p className="route-note">Range and bearing need your GPS position.</p>
      )}
      <button type="button" className="route-clear" onClick={props.onUpdate}>
        Update position
      </button>
      <button type="button" className="route-clear" onClick={props.onClear}>
        Clear MOB
      </button>
    </section>
  );
}
