import { useEffect, useState } from 'react';
import { distanceMeters } from '../../shared/navaid-core.mjs';
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

interface HeritageWreckRecord {
  type?: string;
  id?: string;
  geometry?: { type?: string; coordinates?: number[] };
  properties?: Record<string, unknown>;
}

function displayValue(value: unknown): string | null {
  if (value === null || value === undefined || value === '' || value === 'n/a') return null;
  if (typeof value === 'number' && value === 0) return null;
  return String(value);
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
  const [heritageRecords, setHeritageRecords] = useState<HeritageWreckRecord[]>([]);
  const [heritageState, setHeritageState] = useState<'idle' | 'loading' | 'loaded' | 'unavailable'>('idle');
  const isWreck = mark.category === 'wreck' || mark.category === 'hazard_danger';
  useEffect(() => {
    if (!isWreck) {
      setHeritageRecords([]);
      setHeritageState('idle');
      return;
    }
    const controller = new AbortController();
    setHeritageRecords([]);
    setHeritageState('loading');
    void fetch(`/api/wreck-research?lat=${encodeURIComponent(mark.lat)}&lon=${encodeURIComponent(mark.lon)}`, {
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error('Heritage source unavailable');
      const payload = await response.json() as { features?: HeritageWreckRecord[] };
      if (!Array.isArray(payload.features)) throw new Error('Invalid heritage response');
      if (controller.signal.aborted) return;
      setHeritageRecords(payload.features);
      setHeritageState('loaded');
    }).catch(() => {
      if (!controller.signal.aborted) setHeritageState('unavailable');
    });
    return () => controller.abort();
  }, [isWreck, mark.id, mark.lat, mark.lon]);

  const region = ialaRegion(mark.lat, mark.lon);
  const spec = symbolFor(mark.category, region);
  // One light of a transit is often unnamed in OSM while its partner carries
  // the name; borrow it so the sheet reads "Inskip Islands rear light" instead
  // of repeating the class label as both eyebrow and title.
  const unnamedTransit =
    partner?.name && (mark.category === 'transit_front' || mark.category === 'transit_rear')
      ? `${partner.name} ${mark.category === 'transit_front' ? 'front' : 'rear'} light`
      : null;
  const title =
    mark.name ??
    mark.wreckInventoryName ??
    unnamedTransit ??
    (mark.category === 'wreck' || mark.category === 'hazard_danger'
      ? `Wreck at ${formatPosition(mark.lat, mark.lon)}`
      : CATEGORY_LABELS[mark.category] ?? 'Unnamed mark');
  const hasWreckDetails = [
    mark.wreckBoatingEffect,
    mark.wreckWaterLevel,
    mark.wreckSoundingDepth,
    mark.wreckReportedDepth,
    mark.wreckClearance,
    mark.wreckType,
    mark.wreckDateSunk,
    mark.wreckInventoryName,
    mark.wreckInventoryDepth,
    mark.wreckTypeDescription,
    mark.wreckSiteDescription,
    mark.wreckHistoricalContext,
    mark.wreckInventoryLegalStatus,
    mark.wreckChartSource,
    mark.diveSite,
    mark.diveDepth,
    mark.diveMaxDepth,
    mark.diveEntry,
    mark.diveHazard,
  ].some(Boolean);
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
          <Row label="Form / mark type" value={mark.markType ? `${form} · ${mark.markType.replace(/_/g, ' ')}` : form} />
          {mark.category !== 'wreck' && mark.category !== 'hazard_danger' ? (
            <Row label="Mark category" value={mark.markCategory} />
          ) : null}
          <Row label="Light character / flash" value={mark.light ? `${mark.light}${mark.lightCategory ? ` · ${mark.lightCategory.replace(/_/g, ' ')}` : ''}` : mark.lightCharacter ?? (mark.lit === false && mark.form === 'beacon' ? 'Unlit daymark' : null)} />
          {mark.lit !== false && mark.form !== 'mark' && !mark.lightCharacter && !mark.light ? <Row label="Light character status" value="Not specified in the mapped source (not assumed steady)" /> : null}
          <Row label="Buoyage system" value={mark.buoyageSystem?.replace(/-/g, ' ').toUpperCase()} />
          {mark.lightSectors?.map((sector) => (
            <Row
              key={`light-sector-${sector.sector}`}
              label={`Light sector ${sector.sector}`}
              value={[
                sector.character,
                sector.group ? `group ${sector.group}` : null,
                sector.colour,
                sector.period ? `${sector.period} s` : null,
                sector.start && sector.end ? `${sector.start}°–${sector.end}°` : null,
                sector.range ? `${sector.range} NM` : null,
                sector.sequence,
              ].filter(Boolean).join(' · ')}
            />
          ))}
          <Row label="Light colour" value={mark.lightColour} />
          <Row label="Signal group" value={mark.lightGroup} />
          <Row label="Signal period" value={mark.lightPeriod ? `${mark.lightPeriod} s` : null} />
          <Row label="Flash sequence" value={mark.lightSequence} />
          <Row label="VHF channel" value={mark.channel ? `Ch ${mark.channel}` : null} />
          <Row label="Radio callsign" value={mark.callsign} />
          <Row label="Transit role" value={transitRole} />
          <Row label="Lines up on" value={transitBearing} />
          <Row label="Pair distance" value={transitGap} />
          <Row label="Paired mark" value={mark.transitPartnerName} />
          <Row label="Physical colour" value={mark.colour} />
          <Row label="Colour pattern" value={mark.colourPattern} />
          <Row label="Topmark shape" value={mark.topmarkShape} />
          <Row label="Topmark colour" value={mark.topmarkColour} />
          <Row label="Shape" value={mark.shape} />
          <Row label="Height" value={mark.height} />
          <Row label="Vertical datum" value={mark.verticalDatum} />
          <Row label="Position quality" value={mark.positionQuality} />
          <Row label="Nominal range" value={mark.range ? `${mark.range} NM` : null} />
          {mark.category === 'wreck' || mark.category === 'hazard_danger' ? (
            <>
              <Row label="Wreck chart category" value={mark.wreckCategory} />
              <section className="wreck-heritage-results" aria-label="Nearby heritage records">
                <h3>Nearby heritage wreck records</h3>
                <p>EMODnet/Historic England records are discovery context, not proof that a record is this charted wreck. Dataset positions may be area centroids, and heritage depths are not navigation clearances.</p>
                {heritageState === 'loading' && <p role="status">Searching nearby heritage records…</p>}
                {heritageState === 'unavailable' && <p role="status">The heritage service is temporarily unavailable. Existing chart details remain available.</p>}
                {heritageState === 'loaded' && heritageRecords.length === 0 && <p>No EMODnet heritage records were returned within about 3 km of this mark.</p>}
                {heritageRecords.map((record, index) => {
                  const properties = record.properties ?? {};
                  const name = displayValue(properties.name) ?? 'Unnamed heritage wreck';
                  const coordinates = record.geometry?.coordinates;
                  const distance = Array.isArray(coordinates) && coordinates.length >= 2
                    ? Math.round(distanceMeters(mark.lat, mark.lon, Number(coordinates[1]), Number(coordinates[0])))
                    : null;
                  const reference = displayValue(properties.reference);
                  const source = displayValue(properties.source_inf);
                  return (
                    <article className="wreck-heritage-record" key={record.id ?? `${name}-${index}`}>
                      <h4>{name}{distance !== null ? ` · ${distance} m from chart mark` : ''}</h4>
                      <Row label="Record source" value={source} />
                      <Row label="Vessel / object type" value={displayValue(properties.obj_type) ?? displayValue(properties.ship_char)} />
                      <Row label="Sinking context" value={displayValue(properties.sink_context)} />
                      <Row label="Sinking year" value={displayValue(properties.sink_yr)} />
                      <Row label="Vessel dating" value={displayValue(properties.dating)} />
                      <Row label="Site description" value={displayValue(properties.obj_desc)} />
                      <Row label="Inventory depth notes" value={displayValue(properties.depth_info)} />
                      <Row label="Depth measurement precision" value={displayValue(properties.depth_prec)} />
                      <Row label="Approximate object length" value={displayValue(properties.object_length)} />
                      <Row label="Original port / destination" value={[displayValue(properties.place_orig), displayValue(properties.place_dest)].filter(Boolean).join(' → ') || null} />
                      <Row label="Estimated tonnage" value={displayValue(properties.est_tonnag)} />
                      <Row label="Recorded artefacts" value={displayValue(properties.artefacts)} />
                      <Row label="Dataset source record ID" value={displayValue(properties.source_id)} />
                      <Row label="Least / maximum depth fields" value={[displayValue(properties.least_depth), displayValue(properties.max_depth)].filter(Boolean).join(' / ') || null} />
                      <Row label="Recorded legal status" value={displayValue(properties.statutory)} />
                      <Row label="Position note" value={displayValue(properties.point_info)} />
                      <Row label="Country" value={displayValue(properties.country)} />
                      <Row label="Inventory updated" value={displayValue(properties.yr_updated)} />
                      {reference && <Row label="Inventory reference" value={reference} />}
                      {[properties.website1, properties.website2].map((candidate, linkIndex) => {
                        const raw = displayValue(candidate);
                        if (!raw) return null;
                        try {
                          const link = new URL(raw);
                          if (link.protocol !== 'https:' && link.protocol !== 'http:') return null;
                          return <p key={`source-link-${linkIndex}`}><a href={link.toString()} target="_blank" rel="noreferrer">Related source {linkIndex + 1} ↗</a></p>;
                        } catch {
                          return null;
                        }
                      })}
                    </article>
                  );
                })}
                <a href="https://emodnet.ec.europa.eu/geonetwork/srv/api/records/e965088b-a265-4517-84df-c49b156af8a7" target="_blank" rel="noreferrer">EMODnet heritage wreck dataset (CC BY 4.0) ↗</a>
              </section>
              <Row label="Effect on surface navigation" value={mark.wreckBoatingEffect} />
              <Row label="Wreck water level" value={mark.wreckWaterLevel?.replace(/_/g, ' ')} />
              <Row label="Charted sounding" value={mark.wreckSoundingDepth ? `${mark.wreckSoundingDepth} m relative to chart datum` : null} />
              <Row label="Reported depth below water" value={mark.wreckReportedDepth ? `${mark.wreckReportedDepth} m (community mapped; datum/source may differ)` : null} />
              <Row label="Wreck-top clearance" value={mark.wreckClearance ? `${mark.wreckClearance} m (reported)` : null} />
              <Row label="Craft type" value={mark.wreckType} />
              <Row label="Reported sinking date" value={mark.wreckDateSunk} />
              <Row label="Heritage inventory depth information" value={mark.wreckInventoryDepth ? `${mark.wreckInventoryDepth} (heritage inventory report; units/datum may differ; not chart-clearance information)` : null} />
              <Row label="Heritage wreck / vessel description" value={mark.wreckTypeDescription} />
              <Row label="Heritage site condition" value={mark.wreckSiteDescription} />
              <Row label="Historical context" value={mark.wreckHistoricalContext} />
              <Row label="Heritage protection status" value={mark.wreckInventoryLegalStatus} />
              <Row label="Heritage position type" value={mark.wreckInventoryPositionType ? `${mark.wreckInventoryPositionType}${mark.wreckInventoryMatchDistanceM != null ? `; matched chart mark ${mark.wreckInventoryMatchDistanceM} m away` : ''}` : null} />
              <Row label="Heritage inventory updated" value={mark.wreckInventoryUpdated} />
              <Row label="Reported dimensions" value={mark.wreckLength || mark.wreckWidth ? `${mark.wreckLength ? `${mark.wreckLength} m long` : ''}${mark.wreckLength && mark.wreckWidth ? ' · ' : ''}${mark.wreckWidth ? `${mark.wreckWidth} m wide` : ''}` : null} />
              <Row label="NOAA ENC Direct GIS category" value={mark.wreckChartSource ? mark.wreckCategory : null} />
              <Row label="NOAA chart expected depth" value={mark.wreckChartExpectedDepth ? `${mark.wreckChartExpectedDepth} m; ENC Direct GIS value, not navigation-certified` : null} />
              <Row label="NOAA chart sounding quality" value={mark.wreckChartQuality} />
              <Row label="NOAA chart source date" value={mark.wreckChartSurveyDate} />
              <Row label="NOAA vertical datum code" value={mark.wreckChartVerticalDatum} />
              <Row label="NOAA wreck exposure code" value={mark.wreckChartExposed} />
              <Row label="NOAA source warning" value={mark.wreckChartSource} />
              <Row label="Dive site (community mapped)" value={mark.diveSite ? 'Yes — community-mapped interest only; not confirmation of access, conditions, or safety' : null} />
              <Row label="Typical dive depth" value={mark.diveDepth ? `${mark.diveDepth} m (community mapped)` : null} />
              <Row label="Maximum reported dive depth" value={mark.diveMaxDepth ? `${mark.diveMaxDepth} m (community mapped)` : null} />
              <Row label="Dive entry" value={mark.diveEntry} />
              <Row label="Reported diver hazard" value={mark.diveHazard} />
              <Row label="Dive style" value={mark.driftDive ? 'Drift diving reported' : null} />
              {!hasWreckDetails ? (
                <Row label="Additional wreck information" value="No additional chart, heritage, or dive details are available for this mark yet." />
              ) : null}
            </>
          ) : null}
          <Row label="Description / chart & dive notes" value={
            mark.category === 'wreck' || mark.category === 'hazard_danger'
              ? mark.description
                  ?.split(' · ')
                  .filter((part) =>
                    part !== mark.wreckBoatingEffect &&
                    !part.startsWith('Chart source classifies this wreck') &&
                    !part.startsWith('Mapped water-level effect:') &&
                    !part.startsWith('Charted water level:')
                  )
                  .join(' · ') || null
              : mark.description
          } />
          <Row label="Source citation" value={mark.sourceCitation} />
          <Row label="Heritage dataset source" value={mark.wreckInventorySource} />
          {mark.wreckInventoryUrl && <Row label="Heritage dataset metadata" value={mark.wreckInventoryUrl} />}
          {mark.wreckChartSourceUrl && <Row label="NOAA ENC Direct GIS guidance" value={mark.wreckChartSourceUrl} />}
          <Row label="Source date" value={mark.sourceDate} />
          <Row label="Source" value={mark.source === 'osm' ? 'OpenStreetMap seamarks (ODbL)' : mark.source === 'noaa-enc' ? 'NOAA ENC Direct to GIS (not certified for navigation)' : mark.source} />
          {mark.sourceUrl && <Row label="Source feature" value={mark.sourceUrl} />}
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
