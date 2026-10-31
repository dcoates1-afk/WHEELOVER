import type { AisScope, AisState, AisVessel } from '../lib/ais';
import { STATION_LABELS } from '../lib/station';
import type { StationTab } from '../lib/station';
import type { DistanceUnit } from '../lib/settings';
import { AisPanel } from './AisPanel';
import { ColregsPanel } from './ColregsPanel';

interface StationDrawerProps {
  station: StationTab;
  onStation: (tab: StationTab) => void;
  onClose: () => void;
  aisState: AisState;
  aisVessels: AisVessel[];
  aisNote: string | null;
  aisScope: AisScope | null;
  center: [number, number];
  showAisOnChart: boolean;
  onToggleAisChart: (value: boolean) => void;
  onFocusVessel: (vessel: AisVessel) => void;
  /** Unit the range to each target is written in. */
  distanceUnit?: DistanceUnit;
}

const TABS: StationTab[] = ['ais', 'colregs'];

export function StationDrawer({
  station,
  onStation,
  onClose,
  aisState,
  aisVessels,
  aisNote,
  aisScope,
  center,
  showAisOnChart,
  onToggleAisChart,
  onFocusVessel,
  distanceUnit,
}: StationDrawerProps) {
  return (
    <div className="scrim drawer-scrim" onClick={onClose} role="presentation">
      <section
        className="station-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={STATION_LABELS[station]}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="drawer-head">
          <div className="tab-row" role="tablist" aria-label="Station">
            {TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={station === tab}
                className={`tab ${station === tab ? 'active' : ''}`}
                onClick={() => onStation(tab)}
              >
                {tab === 'ais' ? 'AIS' : 'COLREGs'}
              </button>
            ))}
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close station">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path d="M6 6 L18 18 M18 6 L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="drawer-title">
          <h2>{STATION_LABELS[station]}</h2>
        </div>

        {station === 'ais' && (
          <AisPanel
            state={aisState}
            vessels={aisVessels}
            note={aisNote}
            scope={aisScope}
            center={center}
            showOnChart={showAisOnChart}
            onToggleChart={onToggleAisChart}
            onFocusVessel={onFocusVessel}
            distanceUnit={distanceUnit}
          />
        )}
        {station === 'colregs' && <ColregsPanel />}
      </section>
    </div>
  );
}
