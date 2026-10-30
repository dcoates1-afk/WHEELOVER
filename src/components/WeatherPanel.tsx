import { useCallback, useEffect, useState } from 'react';
import { fetchWeather } from '../lib/weather';
import type { SeriesPoint, WeatherReport } from '../lib/weather';
import { findTideForecast, modelTideForecast } from '../lib/tides';
import type { TideForecast } from '../lib/tides';
import {
  currentAt,
  currentSeries,
  findCurrentPredictions,
  modelCurrentAt,
  modelCurrentSeries,
} from '../lib/currents';
import type { CurrentEvent, CurrentForecast, CurrentPhase, ModelCurrentNow } from '../lib/currents';
import { compassPoint } from '../lib/geo';
import { parseNoaaTime } from '../lib/time';
import { formatPosition } from '../lib/navaids';

interface WeatherPanelProps {
  lat: number;
  lon: number;
}

function Sparkline({ points, colour }: { points: SeriesPoint[]; colour: string }) {
  const sample = points.slice(0, 24);
  if (sample.length < 2) return null;
  const values = sample.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const path = sample
    .map((point, index) => {
      const x = (index / (sample.length - 1)) * 100;
      const y = 32 - ((point.value - min) / span) * 28;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
  return (
    <svg className="sparkline" viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden="true">
      <path d={`${path} L100 36 L0 36 Z`} fill={colour} opacity="0.16" />
      <path d={path} fill="none" stroke={colour} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

function arrowFor(direction: number | undefined): string {
  return direction === undefined ? '—' : compassPoint(direction);
}

const PHASE_LABEL: Record<CurrentPhase, string> = {
  flood: 'Flood',
  ebb: 'Ebb',
  slack: 'Slack',
};

function formatDuration(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes)) return '—';
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function CurrentArrow({ degrees, phase }: { degrees: number | null; phase: CurrentPhase | 'model' }) {
  return (
    <svg
      className={`current-arrow phase-${phase}`}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={degrees === null ? undefined : { transform: `rotate(${degrees}deg)` }}
    >
      <path d="M12 2 L18.5 20 L12 16.2 L5.5 20 Z" />
    </svg>
  );
}

function seriesToSparkline(points: { epoch: number; speedKn: number }[]): SeriesPoint[] {
  return points.map((point) => ({ time: new Date(point.epoch).toISOString(), value: point.speedKn }));
}

export function WeatherPanel({ lat, lon }: WeatherPanelProps) {
  const [report, setReport] = useState<WeatherReport | null>(null);
  const [tide, setTide] = useState<TideForecast | null>(null);
  const [tideMessage, setTideMessage] = useState<string | null>(null);
  const [current, setCurrent] = useState<CurrentForecast | null>(null);
  const [modelCurrent, setModelCurrent] = useState<ModelCurrentNow | null>(null);
  const [currentMessage, setCurrentMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadTide = useCallback(
    async (forecast: WeatherReport | null, signal?: AbortSignal) => {
      try {
        const lookup = await findTideForecast(lat, lon, { signal });
        if (lookup.status === 'ok') {
          setTide(lookup.forecast);
          setTideMessage(null);
          return;
        }
      } catch (lookupError) {
        if (lookupError instanceof DOMException && lookupError.name === 'AbortError') return;
        // Fall through to the global model curve.
      }
      if (forecast?.tideModelAvailable) {
        setTide(modelTideForecast(forecast.seaLevel));
        setTideMessage(null);
        return;
      }
      setTide(null);
      setTideMessage('No tide data is available for this position.');
    },
    [lat, lon],
  );

  const loadCurrent = useCallback(
    async (forecast: WeatherReport | null, signal?: AbortSignal) => {
      try {
        const lookup = await findCurrentPredictions(lat, lon, { signal });
        if (lookup.status === 'ok') {
          setCurrent(lookup.forecast);
          setModelCurrent(null);
          setCurrentMessage(null);
          return;
        }
      } catch (lookupError) {
        if (lookupError instanceof DOMException && lookupError.name === 'AbortError') return;
        // Fall through to the global ocean model.
      }
      if (forecast?.currentModelAvailable) {
        const now = modelCurrentAt(forecast.currentSpeed, forecast.currentDirection);
        if (now) {
          setCurrent(null);
          setModelCurrent(now);
          setCurrentMessage(null);
          return;
        }
      }
      setCurrent(null);
      setModelCurrent(null);
      setCurrentMessage('No current data is available for this position.');
    },
    [lat, lon],
  );

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      setTideMessage(null);
      setCurrentMessage(null);
      let next: WeatherReport | null = null;
      try {
        next = await fetchWeather(lat, lon, signal);
        setReport(next);
      } catch (weatherError) {
        if (!(weatherError instanceof DOMException && weatherError.name === 'AbortError')) {
          setError(weatherError instanceof Error ? weatherError.message : 'Weather unavailable');
        }
      }

      await Promise.all([loadTide(next, signal), loadCurrent(next, signal)]);
      setLoading(false);
    },
    [lat, lon, loadTide, loadCurrent],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const wind = report?.wind[0];
  const gust = report?.gusts[0];
  const direction = report?.windDirection[0]?.value;
  const wave = report?.waves[0];
  const wavePeriod = report?.wavePeriod[0];
  const seaTemperature = report?.seaTemperature[0];
  const airTemperature = report?.temperature[0];

  const nowEpoch = Date.now();
  const nextTides = tide
    ? tide.events
        .filter((event) => parseNoaaTime(event.time) >= nowEpoch)
        .slice(0, 4)
    : [];

  const currentNow = current ? currentAt(current.events) : null;
  const currentSpark: SeriesPoint[] = current
    ? seriesToSparkline(currentSeries(current.events, nowEpoch, 12, 30))
    : [];
  const nextCurrents = current
    ? current.events.filter((event) => event.epoch > nowEpoch).slice(0, 4)
    : [];
  const modelSpark: SeriesPoint[] = report?.currentModelAvailable
    ? seriesToSparkline(modelCurrentSeries(report.currentSpeed, nowEpoch, 12))
    : [];

  return (
    <div className="station-body">
      <div className="station-status">
        <span className="pill">Open-Meteo</span>
        <span className="status-count">{formatPosition(lat, lon)}</span>
      </div>

      {loading && <p className="menu-note">Loading marine forecast…</p>}
      {error && <p className="inline-warning">{error}</p>}

      {report && (
        <>
          <div className="metric-grid">
            <div className="metric-card">
              <p className="eyebrow">Wind</p>
              <p className="metric-value">{wind ? Math.round(wind.value) : '—'}<small> kn</small></p>
              <p className="metric-sub">
                gusts {gust ? Math.round(gust.value) : '—'} kn · from {arrowFor(direction)}
              </p>
              <Sparkline points={report.wind} colour="#5cc9f0" />
            </div>
            <div className="metric-card">
              <p className="eyebrow">Sea state</p>
              <p className="metric-value">
                {wave ? wave.value.toFixed(1) : '—'}
                <small> m</small>
              </p>
              <p className="metric-sub">
                {report.marineAvailable
                  ? `period ${wavePeriod ? Math.round(wavePeriod.value) : '—'} s · SST ${
                      seaTemperature ? `${seaTemperature.value.toFixed(1)}°C` : '—'
                    }`
                  : 'marine model has no data at this position'}
              </p>
              <Sparkline points={report.waves} colour="#f4c531" />
            </div>
            <div className="metric-card">
              <p className="eyebrow">Air temperature</p>
              <p className="metric-value">
                {airTemperature ? Math.round(airTemperature.value) : '—'}
                <small> °C</small>
              </p>
              <p className="metric-sub">next 24 h</p>
              <Sparkline points={report.temperature} colour="#57d2a0" />
            </div>
          </div>

          <h3 className="section-title">Next tides</h3>
          {tide ? (
            <>
              <p className="menu-note" data-tide-source={tide.source}>
                {tide.source === 'noaa'
                  ? `${tide.label} · ${Math.round(tide.distanceKm ?? 0)} km away · ${tide.datum}`
                  : `${tide.label} · heights above ${tide.datum}`}
              </p>
              {tide.heightNow !== null && (
                <p className="tide-now" data-tide-now={tide.heightNow.toFixed(2)}>
                  Now {tide.heightNow >= 0 ? '+' : '−'}
                  {Math.abs(tide.heightNow).toFixed(2)} m above mean sea level
                </p>
              )}
              <ul className="tide-list" data-tide-events={tide.source}>
                {nextTides.map((event) => (
                  <li key={`${event.time}-${event.type}`}>
                    <span className={`tide-type ${event.type === 'H' ? 'high' : 'low'}`}>
                      {event.type === 'H' ? 'High' : 'Low'}
                    </span>
                    <span>{event.time} UTC</span>
                    <span>{event.value.toFixed(2)} m</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="menu-note">{tideMessage ?? 'Tide predictions unavailable.'}</p>
          )}

          <h3 className="section-title current-heading">Tidal current</h3>
          {current && currentNow ? (
            <>
              <p className="menu-note">
                {current.station.name} · {current.distanceKm.toFixed(0)} km away · NOAA current predictions
              </p>
              <div
                className="current-readout"
                data-current-source="noaa"
                data-current-station={current.station.id}
                data-current-phase={currentNow.phase}
                data-current-speed={currentNow.speedKn.toFixed(2)}
                data-current-set={currentNow.setDegrees === null ? '' : Math.round(currentNow.setDegrees)}
              >
                <CurrentArrow degrees={currentNow.setDegrees} phase={currentNow.phase} />
                <div className="current-figures">
                  <p className="current-speed">
                    {currentNow.speedKn.toFixed(1)}
                    <small> kn</small>
                  </p>
                  <p className="current-line">
                    {currentNow.phase === 'slack'
                      ? 'Slack water'
                      : `${PHASE_LABEL[currentNow.phase]} · sets ${compassPoint(currentNow.setDegrees ?? 0)} ${Math.round(
                          currentNow.setDegrees ?? 0,
                        )}°`}
                  </p>
                  <p className="metric-sub">
                    {currentNow.next
                      ? `next ${PHASE_LABEL[currentNow.next.type].toLowerCase()} in ${formatDuration(currentNow.minutesToNext)}`
                      : 'no further predictions'}
                  </p>
                </div>
                <Sparkline points={currentSpark} colour="#5cc9f0" />
              </div>
              <ul className="tide-list current-list" data-current-events="noaa">
                {nextCurrents.map((event: CurrentEvent) => (
                  <li key={`${event.time}-${event.type}`}>
                    <span className={`tide-type current-${event.type}`}>{PHASE_LABEL[event.type]}</span>
                    <span>{event.time} UTC</span>
                    <span>{event.type === 'slack' ? 'slack' : `${event.speedKn.toFixed(1)} kn`}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : modelCurrent ? (
            <>
              <p className="menu-note">Open-Meteo surface-current model · ~8 km</p>
              <div
                className="current-readout"
                data-current-source="model"
                data-current-phase="model"
                data-current-speed={modelCurrent.speedKn.toFixed(2)}
                data-current-set={modelCurrent.setDegrees === null ? '' : Math.round(modelCurrent.setDegrees)}
              >
                <CurrentArrow degrees={modelCurrent.setDegrees} phase="model" />
                <div className="current-figures">
                  <p className="current-speed">
                    {modelCurrent.speedKn.toFixed(1)}
                    <small> kn</small>
                  </p>
                  <p className="current-line">
                    {modelCurrent.speedKn < 0.1
                      ? 'Near slack'
                      : `Sets ${compassPoint(modelCurrent.setDegrees ?? 0)} ${Math.round(
                          modelCurrent.setDegrees ?? 0,
                        )}°`}
                  </p>
                </div>
                <Sparkline points={modelSpark} colour="#5cc9f0" />
              </div>
            </>
          ) : (
            <p className="menu-note">{currentMessage ?? 'Current predictions unavailable.'}</p>
          )}
        </>
      )}

    </div>
  );
}
