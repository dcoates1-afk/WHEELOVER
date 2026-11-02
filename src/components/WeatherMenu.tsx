import { lazy, Suspense } from 'react';
import type { UnitSettings } from '../lib/settings';

const WeatherPanel = lazy(() =>
  import('./WeatherPanel').then((module) => ({ default: module.WeatherPanel })),
);

interface WeatherMenuProps {
  open: boolean;
  onOpen: (open: boolean) => void;
  lat: number;
  lon: number;
  /** Where the forecast point comes from: the GPS fix, or the centre of the screen. */
  mode: 'gps' | 'center';
  onModeChange: (mode: 'gps' | 'center') => void;
  /** False when no GPS fix is available, so GPS mode falls back to the screen centre. */
  hasFix: boolean;
  units: UnitSettings;
  hidden?: boolean;
}

/**
 * The conditions drawer lives in the top-left corner as its own menu, so the
 * main menu stays about the chart itself.
 */
export function WeatherMenu({ open, onOpen, lat, lon, mode, onModeChange, hasFix, units, hidden = false }: WeatherMenuProps) {
  return (
    <>
      <button
        type="button"
        className={`weather-button ${open ? 'open' : ''} ${hidden || open ? 'is-hidden' : ''}`}
        aria-label={open ? 'Close weather conditions' : 'Open weather conditions'}
        aria-expanded={open}
        data-testid="weather-button"
        onClick={() => onOpen(!open)}
      >
        <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
          <path
            d="M7 17.5h9.2a3.6 3.6 0 0 0 .3-7.18 5.1 5.1 0 0 0-9.85-1.06A4.1 4.1 0 0 0 7 17.5Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
          <path d="M4 20.5h9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
        <span className="weather-button-label">Weather conditions</span>
      </button>

      {open && (
        <section
          className="weather-panel"
          role="dialog"
          aria-modal="false"
          aria-label="Weather conditions"
          data-testid="weather-panel"
        >
          <header className="menu-head">
            <div>
              <p className="eyebrow">Conditions</p>
              <h2>Weather conditions</h2>
              <p className="menu-tagline">
                {mode === 'gps'
                  ? 'Forecast, tides and tidal current at your GPS position'
                  : 'Forecast, tides and tidal current at the centre of the screen'}
              </p>
            </div>
            <button
              type="button"
              className="icon-button"
              onClick={() => onOpen(false)}
              aria-label="Close weather conditions"
            >
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                <path d="M6 6 L18 18 M18 6 L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </header>
          <div className="weather-body">
            <div className="weather-source-toggle" role="group" aria-label="Forecast location">
              <button type="button" aria-pressed={mode === 'gps'} onClick={() => onModeChange('gps')}>
                My GPS location
              </button>
              <button type="button" aria-pressed={mode === 'center'} onClick={() => onModeChange('center')}>
                Screen centre
              </button>
            </div>
            {mode === 'gps' && !hasFix && (
              <p className="menu-note">No GPS fix yet — showing the centre of the screen instead.</p>
            )}
            <Suspense fallback={<p className="menu-note">Loading conditions…</p>}>
              <WeatherPanel lat={lat} lon={lon} units={units} />
            </Suspense>
            <p className="menu-note weather-hint">
              {mode === 'gps'
                ? 'Following your GPS position as it updates.'
                : 'Following the centre of the screen — pan the chart and the forecast follows once you stop.'}
            </p>
          </div>
        </section>
      )}
    </>
  );
}
