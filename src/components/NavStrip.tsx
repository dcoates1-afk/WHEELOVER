import type { GeoFix } from '../hooks/useGeolocation';
import type { NavTarget } from '../lib/navigation';
import {
  DEFAULT_SETTINGS,
  convertSpeed,
  speedUnitLabel,
  type UnitSettings,
} from '../lib/settings';

interface NavStripProps {
  fix: GeoFix | null;
  target: NavTarget | null;
  complete: boolean;
  followPaused: boolean;
  units?: UnitSettings;
  onStop: () => void;
  onResumeFollow: () => void;
  onOpenRoute: () => void;
}

/**
 * Persistent heading strip while navigating: course and speed from the GPS
 * fix, plus the next waypoint's range and bearing. It stays on screen when
 * the route panel is closed, so navigation does not depend on the panel
 * staying open. It reports; it never steers.
 */
export default function NavStrip(props: NavStripProps) {
  const units = props.units ?? DEFAULT_SETTINGS.units;
  const { fix } = props;
  return (
    <div className="nav-strip" role="status" aria-label="Navigation">
      <span>
        Course <strong>{fix?.compass !== null && fix?.compass !== undefined ? `${Math.round(fix.compass)}°` : '—'}</strong>
      </span>
      <span>
        Speed{' '}
        <strong>
          {fix?.sog !== null && fix?.sog !== undefined
            ? `${convertSpeed(fix.sog, units.speed).toFixed(1)} ${speedUnitLabel(units.speed)}`
            : '—'}
        </strong>
      </span>
      {props.complete ? (
        <span>
          <strong>Route complete</strong>
        </span>
      ) : props.target !== null ? (
        <span>
          Next W{props.target.index + 1} ·{' '}
          <strong>{props.target.distanceNm.toFixed(1)} NM</strong> ·{' '}
          <strong>{Math.round(props.target.bearingDeg)}°</strong>
        </span>
      ) : (
        <span>Waiting for a GPS fix…</span>
      )}
      {props.followPaused && (
        <button type="button" onClick={props.onResumeFollow}>
          Resume follow
        </button>
      )}
      <button type="button" onClick={props.onOpenRoute}>
        Route
      </button>
      <button type="button" onClick={props.onStop}>
        Stop
      </button>
    </div>
  );
}
