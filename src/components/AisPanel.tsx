import { useMemo } from 'react';
import { distanceMeters } from '../../shared/navaid-core.mjs';
import type { AisScope, AisState, AisVessel } from '../lib/ais';
import { relativeAge, scopeLabel, vesselLabel } from '../lib/ais';
import {
  VESSEL_KIND_COLOURS,
  VESSEL_KIND_LABELS,
  navStatusLabel,
  vesselKind,
  vesselKindLabel,
  vesselSwatchSvg,
} from '../lib/aisVessel';
import type { VesselKind } from '../lib/aisVessel';
import { vesselCountry } from '../lib/mmsi';
import { formatDistance } from '../lib/settings';
import type { DistanceUnit } from '../lib/settings';

interface AisPanelProps {
  state: AisState;
  vessels: AisVessel[];
  note: string | null;
  scope: AisScope | null;
  center: [number, number];
  showOnChart: boolean;
  onToggleChart: (value: boolean) => void;
  onFocusVessel: (vessel: AisVessel) => void;
  /** Unit the range to each target is written in. */
  distanceUnit?: DistanceUnit;
}

const STATE_LABEL: Record<AisState, string> = {
  idle: 'Idle',
  connecting: 'Connecting',
  live: 'Live',
  reconnecting: 'Reconnecting',
  demo: 'Simulated',
  error: 'Unavailable',
  closed: 'Closed',
};

export function AisPanel({
  state,
  vessels,
  note,
  scope,
  center,
  showOnChart,
  onToggleChart,
  onFocusVessel,
  distanceUnit,
}: AisPanelProps) {
  const sorted = useMemo(() => {
    return [...vessels]
      .map((vessel) => ({
        vessel,
        metres: distanceMeters(center[0], center[1], vessel.lat, vessel.lon),
      }))
      .sort((a, b) => a.metres - b.metres)
      .slice(0, 60);
  }, [vessels, center]);

  // The chart's colours are only useful if the panel explains them.
  const kinds = useMemo(() => {
    const counts = new Map<VesselKind, number>();
    for (const vessel of vessels) {
      const kind = vesselKind(vessel);
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [vessels]);

  return (
    <div className="station-body">
      <div className="station-status">
        <span className={`pill state-${state}`}>{STATE_LABEL[state]}</span>
        <span className="status-count">{vessels.length} vessels tracked</span>
      </div>
      <p className="menu-note" data-testid="ais-scope">
        {scope
          ? `Feed covers ${scopeLabel(scope)} around this chart · follows the chart as you pan`
          : 'Feed area not reported yet'}
      </p>

      {state === 'demo' && (
        <p className="inline-warning">
          AISStream feed unavailable; showing simulated vessels.
        </p>
      )}
      {state === 'reconnecting' && (
        <p className="inline-warning">
          AISStream drops its upstream connection periodically. The relay reconnects automatically; the last snapshot stays on screen.
        </p>
      )}
      {note && state !== 'live' && <p className="menu-note">{note}</p>}

      <button
        type="button"
        role="switch"
        aria-checked={showOnChart}
        className="menu-row"
        onClick={() => onToggleChart(!showOnChart)}
      >
        <span className="row-label">
          Show targets on chart
          <small>Colour-coded by vessel type</small>
        </span>
        <span className={`switch ${showOnChart ? 'on' : ''}`} aria-hidden="true">
          <span />
        </span>
      </button>

      {kinds.length > 0 && (
        <ul className="vessel-legend" aria-label="Vessel types on this chart">
          {kinds.map(([kind, count]) => (
            <li key={kind}>
              <span
                className="vessel-legend-dot"
                style={{ background: VESSEL_KIND_COLOURS[kind] }}
                aria-hidden="true"
              />
              {VESSEL_KIND_LABELS[kind]}
              <b>{count}</b>
            </li>
          ))}
        </ul>
      )}

      <ul className="vessel-list">
        {sorted.map(({ vessel, metres }) => {
          const { iso2, country } = vesselCountry(vessel);
          return (
            <li key={vessel.mmsi}>
              <button type="button" className="vessel-row" onClick={() => onFocusVessel(vessel)}>
                <span className="vessel-name" title="Open vessel reference">
                  <span
                    className="vessel-row-swatch"
                    dangerouslySetInnerHTML={{ __html: vesselSwatchSvg(vessel, 12) }}
                    aria-hidden="true"
                  />
                  {iso2 && (
                    <span className="vessel-row-flag" title={country ?? undefined}>
                      {iso2}
                    </span>
                  )}
                  {vesselLabel(vessel)}
                  {vessel.simulated && <em>simulated</em>}
                </span>
                <span className="vessel-meta">
                  {vesselKindLabel(vessel)} · {navStatusLabel(vessel.navStatus, vessel.sog)}
                  {vessel.name ? ` · MMSI ${vessel.mmsi}` : ' · name pending'}
                </span>
                <span className="vessel-numbers">
                  <span>{formatDistance(metres, distanceUnit)}</span>
                  <span>{vessel.sog !== null ? `${vessel.sog.toFixed(1)} kn` : '—'}</span>
                  <span>{vessel.cog !== null ? `${Math.round(vessel.cog)}°` : '—'}</span>
                  <span>{relativeAge(vessel.lastSeen)}</span>
                </span>
              </button>
            </li>
          );
        })}
        {sorted.length === 0 && <li className="empty-state">No AIS targets received yet.</li>}
      </ul>
    </div>
  );
}
