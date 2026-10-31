import type { GeoFix, GeoStatus } from '../hooks/useGeolocation';
import { CompassRose } from './CompassRose';
import { formatCoordinate } from '../lib/coordinates';
import { DEFAULT_SETTINGS, convertSpeed, formatDistance, speedUnitLabel } from '../lib/settings';
import type { UnitSettings } from '../lib/settings';

interface GpsWidgetProps {
  fix: GeoFix | null;
  status: GeoStatus;
  error: string | null;
  gpsMode: 'on' | 'off';
  onCentre: () => void;
  onEnable: () => void;
  onClose: () => void;
  units?: UnitSettings;
}

export function GpsWidget({
  fix,
  status,
  error,
  gpsMode,
  onCentre,
  onEnable,
  onClose,
  units = DEFAULT_SETTINGS.units,
}: GpsWidgetProps) {
  return (
    <aside className="gps-widget" aria-label="Vessel position">
      <header className="gps-head">
        <div>
          <p className="eyebrow">Vessel position</p>
          <h2>{fix ? 'Live GPS fix' : gpsMode === 'on' ? 'Waiting for fix' : 'Location switched off'}</h2>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Hide position panel">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="M6 6 L18 18 M18 6 L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      {gpsMode === 'off' ? (
        <div className="gps-off">
          <p>GPS is set to Always off. Nothing is being requested from the device.</p>
          <button type="button" className="secondary-button" onClick={onEnable}>
            Turn GPS on
          </button>
        </div>
      ) : fix ? (
        <>
          <div className="gps-body">
            <dl className="gps-readout">
              <div className="gps-position">
                <dt>Position</dt>
                <dd>{formatCoordinate(fix.lat, fix.lon, units.coordinates)}</dd>
              </div>
              <div>
                <dt>Speed over ground</dt>
                <dd>
                  {fix.sog !== null
                    ? `${convertSpeed(fix.sog, units.speed).toFixed(1)} ${speedUnitLabel(units.speed)}`
                    : '—'}
                </dd>
              </div>
              <div>
                <dt>Course / heading</dt>
                <dd>{fix.compass !== null ? `${Math.round(fix.compass)}°` : '—'}</dd>
              </div>
              <div>
                <dt>Accuracy</dt>
                <dd>±{formatDistance(fix.accuracy, units.distance)}</dd>
              </div>
              <div>
                <dt>Updated</dt>
                <dd>{new Date(fix.timestamp).toLocaleTimeString()}</dd>
              </div>
            </dl>
            <CompassRose heading={fix.compass} />
          </div>
          <div className="gps-actions">
            <button type="button" className="primary-button" onClick={onCentre}>
              Centre chart on vessel
            </button>
          </div>
        </>
      ) : (
        <div className="gps-off">
          <p>
            {status === 'requesting'
              ? 'Requesting a position fix from the device…'
              : error ?? 'No fix yet. GPS is always on, so the chart will update as soon as the device reports a position.'}
          </p>
          {status === 'error' && (
            <button type="button" className="secondary-button" onClick={onEnable}>
              Retry location
            </button>
          )}
        </div>
      )}
    </aside>
  );
}
