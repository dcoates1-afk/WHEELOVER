import { useEffect, useRef, useState } from 'react';
import { findTideForecast, type TideForecast, type TideStation } from '../lib/tides';

interface TideStationPanelProps {
  station: TideStation;
  onClose: () => void;
}

/**
 * Forecast for one tapped tide station: high and low waters from the
 * station's own predictions, with the source and datum stated. The lookup
 * reuses the conditions drawer's forecast code, so a station panel and the
 * drawer can never disagree about the same water.
 */
export default function TideStationPanel(props: TideStationPanelProps) {
  const { station } = props;
  const [forecast, setForecast] = useState<TideForecast | null>(null);
  const [status, setStatus] = useState<'loading' | 'no-station' | 'unavailable' | 'ok'>('loading');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    setStatus('loading');
    setForecast(null);
    findTideForecast(station.lat, station.lon, { signal: next.signal })
      .then((lookup) => {
        if (next.signal.aborted) return;
        if (lookup.status === 'ok') {
          setForecast(lookup.forecast);
          setStatus('ok');
        } else {
          setStatus(lookup.status);
        }
      })
      .catch(() => {
        if (!next.signal.aborted) setStatus('unavailable');
      });
    return () => next.abort();
  }, [station]);
  return (
    <section className="tide-panel" aria-label="Tide station">
      <div className="route-panel-head">
        <h2>{station.name}</h2>
        <button type="button" className="route-close" onClick={props.onClose} aria-label="Close tide station">
          ×
        </button>
      </div>
      {status === 'loading' && <p className="route-note">Loading the forecast…</p>}
      {status === 'no-station' && (
        <p className="route-note">No harmonic station covers this water, so there is no forecast to show.</p>
      )}
      {status === 'unavailable' && (
        <p className="route-note">The tide service did not answer. Try again when the connection is better.</p>
      )}
      {status === 'ok' && forecast && (
        <>
          <p className="route-note">
            {forecast.label} · {forecast.source === 'noaa' ? 'NOAA harmonic predictions' : 'Sea-level model'} · datum{' '}
            {forecast.datum}
          </p>
          <ol className="route-waypoints">
            {forecast.events.slice(0, 8).map((event, index) => (
              <li key={`${event.time}-${index}`}>
                <span>
                  {event.type === 'H' ? 'High' : 'Low'} water · {event.time} · {event.value.toFixed(2)} m
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
