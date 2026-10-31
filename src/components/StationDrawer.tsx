import type { AisScope, AisState, AisVessel } from '../lib/ais';
import { STATION_LABELS, STATION_TAB_LABELS, STATION_TABS } from '../lib/station';
import type { StationTab } from '../lib/station';
import type { CoordinateFormat, DepthUnit, DistanceUnit } from '../lib/settings';
import { AisPanel } from './AisPanel';
import { ColregsPanel } from './ColregsPanel';
import { TrackingPanel } from './TrackingPanel';

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
  /** Open the Tracking info card for a target picked from the AIS list. */
  onOpenTracking: (vessel: AisVessel) => void;
  /** Unit the range to each target is written in. */
  distanceUnit?: DistanceUnit;
  depthUnit?: DepthUnit;
  coordinateFormat?: CoordinateFormat;
  /** Target the Tracking info page is showing, once one has been chosen. */
  trackingVessel: AisVessel | null;
  onSelectTracking: (mmsi: number | null) => void;
  onCentreVessel: (vessel: AisVessel) => void;
  onOpenVesselSheet: (vessel: AisVessel) => void;
}

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
  onOpenTracking,
  distanceUnit,
  depthUnit,
  coordinateFormat,
  trackingVessel,
  onSelectTracking,
  onCentreVessel,
  onOpenVesselSheet,
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
            {STATION_TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={station === tab}
                className={`tab ${station === tab ? 'active' : ''}`}
                onClick={() => onStation(tab)}
              >
                {STATION_TAB_LABELS[tab]}
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
            onCentreVessel={onCentreVessel}
            onOpenTracking={onOpenTracking}
            distanceUnit={distanceUnit}
          />
        )}
        {station === 'tracking' && (
          <TrackingPanel
            vessels={aisVessels}
            vessel={trackingVessel}
            centre={center}
            onSelect={onSelectTracking}
            onCentre={onCentreVessel}
            onOpenSheet={onOpenVesselSheet}
            distanceUnit={distanceUnit}
            depthUnit={depthUnit}
            coordinateFormat={coordinateFormat}
          />
        )}
        {station === 'colregs' && <ColregsPanel />}
      </section>
    </div>
  );
}
