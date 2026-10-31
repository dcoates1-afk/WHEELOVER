import { useState } from 'react';
import type { AisVessel } from '../lib/ais';
import { vesselColour, vesselIconSvg, vesselSwatchSvg } from '../lib/aisVessel';
import { vesselCountry } from '../lib/mmsi';
import { formatDistance } from '../lib/settings';
import type { CoordinateFormat, DepthUnit, DistanceUnit } from '../lib/settings';
import {
  TRACKING_PAGES,
  trackingFields,
  trackingSubtitle,
  trackingTargets,
  trackingTitle,
} from '../lib/tracking';
import type { TrackingPage } from '../lib/tracking';

interface TrackingPanelProps {
  vessels: AisVessel[];
  /** The target the pages are showing, or null for the picker. */
  vessel: AisVessel | null;
  centre: [number, number];
  onSelect: (mmsi: number | null) => void;
  onCentre: (vessel: AisVessel) => void;
  onOpenSheet: (vessel: AisVessel) => void;
  distanceUnit?: DistanceUnit;
  depthUnit?: DepthUnit;
  coordinateFormat?: CoordinateFormat;
}

function FieldRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="tracking-row">
      <dt>{label}</dt>
      <dd className={value ? undefined : 'missing'}>{value ?? 'Not reported'}</dd>
    </div>
  );
}

/**
 * Tracking info: the AIS reference as three pages, in the shape of the vessel
 * cards the tracking sites publish. Everything shown is what the transponder
 * sent plus what this chart measured; there is no port-call or ownership data
 * behind it, and the pages say "Not reported" rather than inventing a value.
 */
export function TrackingPanel({
  vessels,
  vessel,
  centre,
  onSelect,
  onCentre,
  onOpenSheet,
  distanceUnit,
  depthUnit,
  coordinateFormat,
}: TrackingPanelProps) {
  const [page, setPage] = useState<TrackingPage>('overview');

  if (vessel === null) {
    const targets = trackingTargets(vessels, centre);
    return (
      <div className="station-body">
        <p className="menu-note">
          Choose a target to open its tracking card. Targets are listed nearest the chart centre first.
        </p>
        {targets.length === 0 ? (
          <p className="empty-state">No AIS targets received yet.</p>
        ) : (
          <ul className="tracking-picker">
            {targets.map(({ vessel: target, metres }) => {
              const { iso2 } = vesselCountry(target);
              return (
                <li key={target.mmsi}>
                  <button type="button" className="menu-row" onClick={() => onSelect(target.mmsi)}>
                    <span className="row-label">
                      <span className="tracking-pick-name">
                        <span
                          className="tracking-pick-swatch"
                          dangerouslySetInnerHTML={{ __html: vesselSwatchSvg(target, 12) }}
                          aria-hidden="true"
                        />
                        {target.name ?? `MMSI ${target.mmsi}`}
                        {iso2 ? ` · ${iso2}` : ''}
                      </span>
                      <small>MMSI {target.mmsi}</small>
                    </span>
                    <span className="tracking-pick-range">{formatDistance(metres, distanceUnit)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  const { iso2, country } = vesselCountry(vessel);
  const fields = trackingFields(page, vessel, {
    centre,
    distanceUnit,
    depthUnit,
    coordinateFormat,
  });

  return (
    <div className="station-body">
      <div className="tracking-card">
        <span
          className="tracking-icon"
          style={{ ['--vessel' as string]: vesselColour(vessel) }}
          dangerouslySetInnerHTML={{ __html: vesselIconSvg(vessel, 40) }}
          aria-hidden="true"
        />
        <div className="tracking-identity">
          <h3>{trackingTitle(vessel)}</h3>
          <p>{trackingSubtitle(vessel)}</p>
          {iso2 && (
            <p className="tracking-flag" title={country ?? undefined}>
              <span className="vessel-flagcode">{iso2}</span>
              {country}
            </p>
          )}
        </div>
      </div>

      <div className="tab-row tracking-pages" role="tablist" aria-label="Tracking pages">
        {TRACKING_PAGES.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={page === entry.id}
            className={`tab ${page === entry.id ? 'active' : ''}`}
            onClick={() => setPage(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <dl className="tracking-list">
        {fields.map((field) => (
          <FieldRow key={field.label} label={field.label} value={field.value} />
        ))}
      </dl>

      <div className="tracking-actions">
        <button type="button" className="primary-button" onClick={() => onCentre(vessel)}>
          Centre chart
        </button>
        <button type="button" className="secondary-button" onClick={() => onOpenSheet(vessel)}>
          Reference sheet
        </button>
        <button type="button" className="secondary-button" onClick={() => onSelect(null)}>
          Change target
        </button>
      </div>
    </div>
  );
}
