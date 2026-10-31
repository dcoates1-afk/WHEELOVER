import { bearingDegrees, distanceMeters } from '../../shared/navaid-core.mjs';
import { relativeAge, vesselLabel } from '../lib/ais';
import type { AisVessel } from '../lib/ais';
import {
  courseLabel,
  dimensionsLabel,
  draughtLabel,
  headingLabel,
  navStatusLabel,
  speedLabel,
  vesselColour,
  vesselIconSvg,
  vesselKindLabel,
} from '../lib/aisVessel';
import { formatPosition } from '../lib/navaids';
import { vesselCountry } from '../lib/mmsi';
import { formatDistance } from '../lib/settings';
import type { DistanceUnit } from '../lib/settings';

interface VesselSheetProps {
  vessel: AisVessel;
  centre: [number, number];
  onCentre: (vessel: AisVessel) => void;
  onClose: () => void;
  /** Unit the range and bearing line is written in. */
  distanceUnit?: DistanceUnit;
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="sheet-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function rangeLabel(vessel: AisVessel, centre: [number, number], unit?: DistanceUnit): string {
  const metres = distanceMeters(centre[0], centre[1], vessel.lat, vessel.lon);
  const bearing = Math.round(bearingDegrees(centre[0], centre[1], vessel.lat, vessel.lon));
  return `${formatDistance(metres, unit)} away · bearing ${String(bearing).padStart(3, '0')}°`;
}

/**
 * AIS reference sheet: everything a static report or voyage report carries,
 * plus what the chart measured — range and bearing from the current view.
 */
export function VesselSheet({ vessel, centre, onCentre, onClose, distanceUnit }: VesselSheetProps) {
  const title = vesselLabel(vessel);
  const kind = vesselKindLabel(vessel);
  const status = navStatusLabel(vessel.navStatus, vessel.sog);
  const transponder = vessel.transponder ? `Class ${vessel.transponder}` : null;
  const { country, iso2 } = vesselCountry(vessel);
  const flagLabel = country ? [iso2, country].filter(Boolean).join(' · ') : null;
  const subtitle = [
    `MMSI ${vessel.mmsi}`,
    vessel.imo !== null ? `IMO ${vessel.imo}` : null,
    vessel.callSign ?? null,
    vessel.simulated ? 'simulated target' : null,
  ]
    .filter(Boolean)
    .join(' · ');
  // A target heard only through its transponder has no name or type yet; say
  // so once instead of repeating "unknown type" above its MMSI.
  const staticAge = vessel.staticAt === null ? null : relativeAge(vessel.staticAt);
  const note =
    vessel.name === null
      ? 'No static report received yet. The name usually arrives within six minutes of first hearing the target; known targets are restored from the local cache.'
      : null;

  return (
    <div className="sheet-scrim" onClick={onClose} role="presentation">
      <section
        className="navaid-sheet vessel-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`Vessel reference: ${title}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet-grabber" aria-hidden="true" />
        <header className="sheet-head">
          <span
            className="sheet-symbol vessel-sheet-symbol"
            style={{ ['--vessel' as string]: vesselColour(vessel) }}
            dangerouslySetInnerHTML={{ __html: vesselIconSvg(vessel, 46) }}
            aria-hidden="true"
          />
          <div>
            <p className="eyebrow">
              {vessel.name === null ? 'Unidentified AIS target' : kind}
              {transponder && vessel.name !== null ? ` · ${transponder}` : ''}
            </p>
            <h2>{title}</h2>
            <p className="sheet-sub">{subtitle}</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close vessel reference">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path d="M6 6 L18 18 M18 6 L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <dl className="sheet-body">
          <Row label="Status" value={status} />
          <Row label="Speed (SOG)" value={speedLabel(vessel)} />
          <Row label="Course (COG)" value={courseLabel(vessel)} />
          <Row label="Heading" value={headingLabel(vessel)} />
          <Row label="Position" value={formatPosition(vessel.lat, vessel.lon)} />
          <Row label="Flag" value={flagLabel} />
          <Row label="From this chart" value={rangeLabel(vessel, centre, distanceUnit)} />
          <Row label="Destination" value={vessel.destination} />
          <Row label="ETA" value={vessel.eta} />
          <Row label="Size (L × B)" value={dimensionsLabel(vessel)} />
          <Row label="Draught" value={draughtLabel(vessel)} />
          <Row label="Call sign" value={vessel.callSign} />
          <Row label="IMO" value={vessel.imo === null ? null : String(vessel.imo)} />
          <Row label="Report class" value={transponder} />
          <Row label="Static report" value={staticAge} />
          <Row label="Position report" value={relativeAge(vessel.lastSeen)} />
          <Row label="Source" value={vessel.simulated ? 'Simulated traffic' : 'AISStream live feed'} />
        </dl>

        {note && <p className="vessel-sheet-note">{note}</p>}

        <footer className="sheet-actions">
          <button type="button" className="primary-button" onClick={() => onCentre(vessel)}>
            Centre chart on vessel
          </button>
          <button type="button" className="secondary-button" onClick={onClose}>
            Back to chart
          </button>
        </footer>
      </section>
    </div>
  );
}
