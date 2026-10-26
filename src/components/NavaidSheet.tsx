import { ialaRegion, formatPosition, symbolFor, CATEGORY_LABELS } from '../lib/navaids';
import type { Navaid, NavaidCategory } from '../lib/navaids';

/**
 * "mark" is the fallback form for chart features that are not buoys or beacons,
 * so name the feature itself instead of printing a meaningless word.
 */
const FORM_LABELS: Partial<Record<NavaidCategory, string>> = {
  transit_front: 'Transit light — front (lower)',
  transit_rear: 'Transit light — rear (higher)',
  calling_in_point: 'Radio reporting line',
  communication_area: 'Vessel reporting / communications area',
  anchor_berth: 'Designated berth',
  anchorage: 'Anchorage ground',
  wreck: 'Charted wreck',
  hazard_danger: 'Charted wreck (dangerous)',
};

interface NavaidSheetProps {
  mark: Navaid;
  /** The other end of a transit pair, when it is in the loaded data. */
  partner?: Navaid | null;
  onCentre: (mark: Navaid) => void;
  onShowPartner?: (mark: Navaid) => void;
  onClose: () => void;
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

export function NavaidSheet({ mark, partner, onCentre, onShowPartner, onClose }: NavaidSheetProps) {
  const region = ialaRegion(mark.lat, mark.lon);
  const spec = symbolFor(mark.category, region);
  // One light of a transit is often unnamed in OSM while its partner carries
  // the name; borrow it so the sheet reads "Inskip Islands rear light" instead
  // of repeating the class label as both eyebrow and title.
  const unnamedTransit =
    partner?.name && (mark.category === 'transit_front' || mark.category === 'transit_rear')
      ? `${partner.name} ${mark.category === 'transit_front' ? 'front' : 'rear'} light`
      : null;
  const title = mark.name ?? unnamedTransit ?? CATEGORY_LABELS[mark.category] ?? 'Unnamed mark';
  const form =
    FORM_LABELS[mark.category] ??
    (mark.form === 'beacon' && mark.lit === false ? 'Unlit beacon (day mark)' : mark.form);
  const transitRole =
    mark.category === 'transit_front'
      ? 'Front (lower)'
      : mark.category === 'transit_rear'
        ? 'Rear (higher)'
        : null;
  const transitBearing =
    mark.transitBearing === null ? null : `${String(mark.transitBearing).padStart(3, '0')}° true`;
  const transitGap =
    mark.transitDistanceM === null ? null : `${mark.transitDistanceM} m to the paired mark`;
  const partnerAction =
    partner?.category === 'transit_rear'
      ? 'Show the rear mark (higher)'
      : partner?.category === 'transit_front'
        ? 'Show the front mark (lower)'
        : null;

  return (
    <div className="sheet-scrim" onClick={onClose} role="presentation">
      <section
        className="navaid-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`Mark reference: ${title}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet-grabber" aria-hidden="true" />
        <header className="sheet-head">
          <span className="sheet-symbol" dangerouslySetInnerHTML={{ __html: spec.svg }} aria-hidden="true" />
          <div>
            <p className="eyebrow">{CATEGORY_LABELS[mark.category]}</p>
            <h2>{title}</h2>
            <p className="sheet-sub">
              {formatPosition(mark.lat, mark.lon)} · IALA region {region}
            </p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close mark reference">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path d="M6 6 L18 18 M18 6 L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <dl className="sheet-body">
          <Row label="Form" value={form} />
          <Row label="Light character" value={mark.light} />
          <Row label="VHF channel" value={mark.channel ? `Ch ${mark.channel}` : null} />
          <Row label="Radio callsign" value={mark.callsign} />
          <Row label="Transit role" value={transitRole} />
          <Row label="Lines up on" value={transitBearing} />
          <Row label="Pair distance" value={transitGap} />
          <Row label="Paired mark" value={mark.transitPartnerName} />
          <Row label="Colour" value={mark.colour} />
          <Row label="Shape / topmark" value={mark.shape} />
          <Row label="Height" value={mark.height} />
          <Row label="Nominal range" value={mark.range ? `${mark.range} NM` : null} />
          <Row label="Description" value={mark.description} />
          <Row label="Source" value={mark.source === 'osm' ? 'OpenStreetMap seamarks (ODbL)' : mark.source} />
          <Row label="Last mapped" value={mark.updated ? new Date(mark.updated).toLocaleDateString() : null} />
          <Row label="Reference" value={mark.id} />
        </dl>

        <footer className="sheet-actions">
          <button type="button" className="primary-button" onClick={() => onCentre(mark)}>
            Centre chart on mark
          </button>
          {partner && partnerAction && onShowPartner && (
            <button type="button" className="secondary-button" onClick={() => onShowPartner(partner)}>
              {partnerAction}
            </button>
          )}
          <button type="button" className="secondary-button" onClick={onClose}>
            Back to chart
          </button>
        </footer>
      </section>
    </div>
  );
}
