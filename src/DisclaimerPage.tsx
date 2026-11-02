import { useEffect, useState } from 'react';
import './landing.css';
import './disclaimer.css';
import { marineDataUrl } from './lib/marineDb';
import { SHIP_REPORTING_SYSTEMS } from './lib/shipReportingSystems';

/** Counts and snapshot date of the sound-signal and racon extract. */
interface SignalCoverage {
  count: number;
  fogSignals: number;
  racons: number;
  sourceTimestamp: string | null;
}

/** Counts and snapshot date of the mark-detail extract. */
interface MarkDetailCoverage {
  count: number;
  sourceTimestamp: string | null;
}

/** Counts and snapshot date of the sector-light extract. */
interface SectorCoverage {
  count: number;
  records: number;
  sourceTimestamp: string | null;
}

/** What the live bridge and marine-area overlays last drew, and from which snapshot. */
interface ChartFeatureCoverage {
  bridges: number;
  areas: number;
  sourceTimestamp: string | null;
  /** The mirror that answered was behind current OpenStreetMap data. */
  behind: boolean;
}

const formatSnapshot = (value: string | null): string | null => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  // Snapshot timestamps are UTC; format them in UTC so the date does not shift
  // by a day just because the reader's device sits west of Greenwich.
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
};

const number = (value: number): string => value.toLocaleString('en-GB');

const sources = [
  { name: 'OpenStreetMap', detail: 'Community-mapped chart features, light sector bearings, sound signals and racons, TSS, ferry routes, bridges, marine protected areas, conservation designations, reefs, banks, restricted areas, military ranges, and places. © OpenStreetMap contributors; data are available under the Open Database Licence (ODbL), including its attribution and share-alike terms for derived databases.', href: 'https://www.openstreetmap.org/copyright' },
  { name: 'Esri — basemaps, imagery and relief', detail: 'World Ocean Base (Esri, Garmin, GEBCO, NOAA NGDC), World Imagery (Esri, Maxar, Earthstar Geographics) and World Shaded Relief (Esri, NOAA, USGS) are served by Esri under its respective terms.', href: 'https://www.esri.com/en-us/legal/terms' },
  { name: 'Shom — France', detail: 'Traffic-separation features from “Traffic separation schemes” (BDML_DST, 2021), Open Licence Etalab v2.0. Required credit: “Shom, 2021. Traffic separation schemes.” Shom metadata says “Do not use for navigation.”', href: 'https://services.data.shom.fr/geonetwork/srv/api/records/BDML_DST.xml' },
  { name: 'Fisheries and Oceans Canada / Canadian Hydrographic Service', detail: 'TSS feature classes from Vessel Traffic Routes. Open Government Licence — Canada permits adaptation and redistribution with source acknowledgement; attribution: “Contains information licensed under the Open Government Licence – Canada.”', href: 'https://open.canada.ca/data/en/dataset/6ab2803a-aace-4e60-83ed-44a7e0ccd1d8' },
  { name: 'UK Hydrographic Office via DataMapWales', detail: 'Selected traffic separation lanes and zones from the UKHO Ship Routeing Measures dataset. Contains public sector information, licensed under the Open Government Licence v3.0, from UKHO. The accessible DataMapWales feature extent is regional and does not represent complete UK or global coverage.', href: 'https://datamap.gov.wales/layers/appdata-wg-marine:ukho_ship_routeing_measures_areas/metadata_detail' },
  { name: 'GEBCO', detail: 'Bathymetric grids used for modelled depth numbers, display contours, and the local GEBCO_2026 contour pilot, together with the GEBCO 2023 contour tiles. Nominal grid spacing does not represent local survey detail; source resolution and vertical references vary.', href: 'https://www.gebco.net/data_and_products/gridded_bathymetry_data/' },
  { name: 'EMODnet', detail: 'Marine environmental and seabed products, including bathymetry and heritage records. Coverage, source dates, resolution, attributes, and licensing are product-specific.', href: 'https://emodnet.ec.europa.eu/' },
  { name: 'EMODnet Human Activities — heritage shipwrecks (CC BY 4.0)', detail: 'Heritage inventory records reproduced under CC BY 4.0, originator AND-International, source provider Historic England. Used to describe charted wrecks, not to position them; see “Heritage wreck records” below.', href: 'https://emodnet.ec.europa.eu/geonetwork/srv/api/records/e965088b-a265-4517-84df-c49b156af8a7' },
  { name: 'European Environment Agency — Natura 2000', detail: 'Protected-site boundaries and attributes returned by the Natura 2000 service, merged with EMODnet\u2019s marine-protected-area layer, which still lists the UK and OSPAR sites the Natura layer no longer covers. Designations do not, by themselves, state current boating restrictions.', href: 'https://www.eea.europa.eu/en/datahub/datahubitem-view/6fc8ad2d-195d-40f4-bdec-576e7d1268e4' },
  { name: 'NOAA ENC / ENC Direct to GIS / Maritime Chart Service', detail: 'Official U.S. chart-service content is shown only as a display aid: converted ENC Direct GIS features, the NOAA Maritime Chart Service raster chart display, and the ENC depth-contour and charted-sounding layers. Converted GIS data are not an official NOAA navigation product; use current official ENCs and notices.', href: 'https://nauticalcharts.noaa.gov/learn/encdirect/' },
  { name: 'NOAA CO-OPS', detail: 'Tide and current predictions are station-based and datum-dependent. Station distance and local conditions affect how representative they are.', href: 'https://tidesandcurrents.noaa.gov/' },
  { name: 'Open-Meteo / Météo-France SMOC', detail: 'Weather and ocean-current model output is guidance rather than a local observation or guaranteed forecast. Modelled surface drift is not a harmonic tidal-current prediction.', href: 'https://open-meteo.com/en/docs/marine-weather-api' },
  { name: 'OpenSeaMap', detail: 'Seamark raster overlay (© OpenSeaMap, CC-BY-SA) and related community resources. Its credit is carried here rather than on the chart.', href: 'https://www.openseamap.org/' },
  { name: 'AISStream', detail: 'Live vessel positions depend on upstream reception, relay connectivity, reporting intervals, and feed coverage. Demo-mode traffic is simulated, not received over AIS.', href: 'https://aisstream.io/' },
];

export default function DisclaimerPage() {
  // The extract's size and snapshot date are read from its own manifest, so a
  // rebuilt index updates this page without anyone editing the copy.
  const [signals, setSignals] = useState<SignalCoverage | null>(null);
  const [sectors, setSectors] = useState<SectorCoverage | null>(null);
  const [details, setDetails] = useState<MarkDetailCoverage | null>(null);
  const [chartFeatures, setChartFeatures] = useState<ChartFeatureCoverage | null>(null);
  useEffect(() => {
    let cancelled = false;
    const readManifest = (path: string) =>
      fetch(marineDataUrl(path), { cache: 'no-store' })
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null);
    void readManifest('signals/manifest.json').then((raw: unknown) => {
      if (cancelled || !raw || typeof raw !== 'object') return;
      const manifest = raw as Partial<SignalCoverage>;
      const count = Number(manifest.count);
      if (!Number.isFinite(count) || count <= 0) return;
      setSignals({
        count,
        fogSignals: Number(manifest.fogSignals) || 0,
        racons: Number(manifest.racons) || 0,
        sourceTimestamp: typeof manifest.sourceTimestamp === 'string' ? manifest.sourceTimestamp : null,
      });
    });
    void readManifest('mark-details/manifest.json').then((raw: unknown) => {
      if (cancelled || !raw || typeof raw !== 'object') return;
      const manifest = raw as Partial<MarkDetailCoverage>;
      const count = Number(manifest.count);
      if (!Number.isFinite(count) || count <= 0) return;
      setDetails({
        count,
        sourceTimestamp: typeof manifest.sourceTimestamp === 'string' ? manifest.sourceTimestamp : null,
      });
    });
    // Bridges and marine areas are queried per chart view rather than built into
    // an extract, so the server reports its last successful query instead.
    const stats = new URL('/api/overpass?stats=chart-features', window.location.origin);
    void fetch(stats, { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null)
      .then((raw: unknown) => {
        if (cancelled || !raw || typeof raw !== 'object') return;
        const record = raw as { bridges?: unknown; areas?: unknown; sourceTimestamp?: unknown; behind?: unknown };
        const bridges = Number(record.bridges);
        const areas = Number(record.areas);
        if (!Number.isFinite(bridges) || !Number.isFinite(areas) || bridges + areas <= 0) return;
        const sourceTimestamp = Number(record.sourceTimestamp);
        setChartFeatures({
          bridges,
          areas,
          sourceTimestamp: Number.isFinite(sourceTimestamp) && sourceTimestamp > 0
            ? new Date(sourceTimestamp).toISOString()
            : null,
          behind: record.behind === true,
        });
      });
    void readManifest('light-sectors/manifest.json').then((raw: unknown) => {
      if (cancelled || !raw || typeof raw !== 'object') return;
      const manifest = raw as Partial<SectorCoverage>;
      const lights = Number(manifest.count);
      if (!Number.isFinite(lights) || lights <= 0) return;
      setSectors({
        count: lights,
        records: Number(manifest.records) || 0,
        sourceTimestamp: typeof manifest.sourceTimestamp === 'string' ? manifest.sourceTimestamp : null,
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const signalSnapshot = formatSnapshot(signals?.sourceTimestamp ?? null);
  const detailSnapshot = formatSnapshot(details?.sourceTimestamp ?? null);
  const sectorSnapshot = formatSnapshot(sectors?.sourceTimestamp ?? null);
  const chartFeatureSnapshot = formatSnapshot(chartFeatures?.sourceTimestamp ?? null);
  return (
    <main className="disclaimer-page">
      <header className="disclaimer-header">
        <a className="home-brand" href="/"><img className="home-logo" src="/images/wheelover-icon.webp" alt="" /><span>WHEELOVER</span></a>
        <a className="home-nav-cta" href="/app">Back to chart <span aria-hidden="true">↗</span></a>
      </header>
      <article className="disclaimer-content">
        <div className="section-kicker">DATA, LIMITS &amp; SOURCES <span>—</span> IMPORTANT</div>
        <h1>Data sources &amp; disclaimer</h1>
        <p className="disclaimer-lead">WHEELOVER combines open, community-mapped, modelled, converted, and other third-party information for exploration and situational awareness. It can be incomplete, inaccurate, generalized, displaced, stale, or unavailable; boundaries and symbols may not reflect current legal or operational conditions.</p>
        <section>
          <h2>Not for navigation or compliance</h2>
          <p>WHEELOVER is not an official or certified navigation system. Do not use it alone to plan or conduct a passage, determine safe water or bridge clearance, interpret a traffic scheme, or decide whether an area may be entered. It does not replace current official nautical charts, Notices to Mariners, publications, local regulations, or guidance from responsible authorities.</p>
          <p>Maintain a proper navigational watch and verify hazards, positions, depths, bridge clearance and opening status, routeing measures, protected-area rules, weather, tides, and currents against current authoritative information. A missing feature or value does not establish that a hazard, restriction, route, or clearance is absent.</p>
        </section>
        <section>
          <h2>Worldwide traffic separation overlay</h2>
          <p>The overlay is worldwide in extent through community mapping, not a complete worldwide inventory. It combines the current OpenStreetMap TSS extract with available, explicitly licensed additions from Shom, Fisheries and Oceans Canada, and UKHO via DataMapWales. Regional additions are limited to their source extents; source geometries may be partial, generalized, differently classified, or out of date. The overlay is illustrative and must not be treated as the legally operative scheme or used for navigation.</p>
          <p>Hong Kong Marine Department data were not merged because the published terms do not clearly grant derivative-work rights. NOAA Marine Cadastre Vessel Routing Measures were not merged because the hosted layer metadata does not specify a layer-specific licence. Neither dataset is represented as part of the archive.</p>
        </section>
        <section>
          <h2>Heritage wreck records</h2>
          <p>Wreck cards can carry descriptive fields taken from the EMODnet Human Activities heritage-shipwreck inventory — vessel or object type, sinking year or context, site description and condition, historical context, recorded protection status, inventory reference and update year, and the inventory&apos;s own depth notes. Those records come from the source shown on the card and are reused under CC BY 4.0, with AND-International as originator and Historic England as the usual source provider.</p>
          <p>A heritage record is attached to a charted wreck only when it lies within about 25 m of the mark, so the pairing is proximity-based matching, not proof of identity. Dataset positions may be area centroids rather than surveyed fixes, and a single wreck may appear under a different name, year, or type in a heritage inventory than on the chart.</p>
          <p>Inventory depth fields are historical measurements or estimates with their own, often unclear, reference and precision. They are not clearances, not least depths over the wreck, and not soundings: do not use them to judge whether water is safe. Recorded protection status is as held by the inventory and may be out of date, incomplete, or irrelevant to the jurisdiction that now manages the site, so it cannot establish whether diving, anchoring, fishing or entry is permitted. The paired records were matched when the offline mark database was built, so a record added to the inventory afterwards will not appear.</p>
        </section>
        <section>
          <h2>Sound signals and racons</h2>
          <p>Bell, horn, whistle and radar-transponder symbols come from a separate worldwide community-mapped extract. The worldwide mark archive used to draw the chart keeps a light&apos;s character and sectors but carries no sound-signal or radar-transponder tags at all, so these details are attached from that extract when the chart is viewed.</p>
          <p>{signals
            ? <>Current extract: {number(signals.count)} mapped objects — {number(signals.fogSignals)} sound signals and {number(signals.racons)} radar transponders{signalSnapshot ? <> — from the OpenStreetMap snapshot of {signalSnapshot}</> : null}.</>
            : <>The extract&apos;s size and snapshot date are read from its manifest when this page loads.</>} That date is the age of the mapped data, not of this page. Rebuilding the index from a newer extract is what refreshes it.</p>
          <p>The extract fills in only what a chart mark is missing; a mark&apos;s own record always wins. Its coverage is community mapping, not a complete inventory: aids that carry a real bell, horn or racon but are unmapped show nothing, mapped signals that belong to an object with no chart mark cannot be drawn, and a missing symbol does not establish that an aid is silent or has no transponder. Signals are shown as a movement aid only — they can be decommissioned, seasonal, or operated on demand, so treat the current chart, Light List, sailing directions and notices as authoritative.</p>
        </section>
        <section>
          <h2>Bridges and marine areas</h2>
          <p>The bridge-clearance and marine-area overlays are not shipped with the app as a fixed extract. Each chart view asks OpenStreetMap for the bridges over tidal water inside it, and for the protected, conservation, reef, bank, restricted and military areas mapped there; the answer is cached and reused for that view.</p>
          <p>{chartFeatures
            ? <>Most recent chart view drawn: {number(chartFeatures.bridges)} {chartFeatures.bridges === 1 ? 'bridge' : 'bridges'} over tidal water and {number(chartFeatures.areas)} marine-area outlines{chartFeatureSnapshot ? <> — from the OpenStreetMap snapshot of {chartFeatureSnapshot}</> : null}{chartFeatures.behind ? <>, and the mirror that answered was behind current data, so that view may include superseded features</> : null}.</>
            : <>The most recent view&apos;s counts and snapshot date are read from the chart server when this page loads.</>} That date is the age of the mapped data, not of this page, and it describes the last view fetched rather than worldwide coverage.</p>
          <p>A view that has not been fetched yet, or a query the OpenStreetMap mirrors could not answer, draws nothing: an empty overlay means the data is missing, not that a crossing or a designated area is absent.</p>
        </section>
        <section>
          <h2>Other data limitations</h2>
          <ul>
            <li><strong>Depths and contours:</strong> modelled or interpolated seabed grids are not surveyed soundings and cannot establish safe depth. Grid resolution, survey density, vertical datum, and shoreline alignment vary by source and region. NOAA ENC displays and converted GIS features still require current official chart use.</li>
            <li><strong>Navigation marks, wrecks, and bridges:</strong> chart-derived, open-data, and community records can have uncertain positions, names, classifications, dates, depth references, clearance values, or status. Heritage and dive information is contextual and does not establish identity, access, or safety.</li>
            <li><strong>Mark detail (topmarks, shapes, colours, structure, heights, references):</strong> the worldwide archive keeps only a mark&apos;s name, class and light summary, so the remaining charted detail is attached from a separate community-mapped extract and only fills fields the mark&apos;s own record leaves blank. It is community mapping, not a complete inventory: an unmapped topmark or reference shows nothing, and a blank value does not establish that an aid carries no such feature. {details
              ? <>Current extract: {number(details.count)} mapped marks{detailSnapshot ? <> — from the OpenStreetMap snapshot of {detailSnapshot}</> : null}. That date is the age of the mapped data, not of this page.</>
              : <>The extract&apos;s size and snapshot date are read from its manifest when this page loads.</>}</li>
            <li><strong>Light sectors:</strong> sector bearings come from a separate community-mapped extract, so they can be partial, out of date, or mapped without the limits that would let them be drawn. A drawn arc is not a surveyed light boundary; use the current chart and Light List. {sectors
              ? <>Current extract: {number(sectors.count)} sector lights carrying {number(sectors.records)} sector bearings{sectorSnapshot ? <> — from the OpenStreetMap snapshot of {sectorSnapshot}</> : null}. That date is the age of the mapped data, not of this page.</>
              : <>The extract&apos;s size and snapshot date are read from its manifest when this page loads.</>}</li>
            <li><strong>Sound signals and racons:</strong> drawn only where a community-mapped record exists, matched to the aid by identity and only filling what its own record lacks. Silence or a transponder on one aid says nothing about a neighbouring one; see “Sound signals and racons” above.</li>
            <li><strong>Marine areas and restrictions:</strong> the overlay draws community-mapped protected areas and reserves, conservation designations (including SACs, SPAs, marine protected areas and no-take sites), reefs, banks and shoals, charted restricted and caution areas, and military danger, training and test areas, together with European Natura 2000 site boundaries. A mapped designation outline does not itself define current access rules or prove a boating prohibition: restrictions may be seasonal, locally defined, mapped as a different designation, or absent from the data, and coverage varies greatly by country. Reefs, banks and ranges are drawn from mapped outlines only and are not a survey. The popups list the mapped tags for the feature; only the official chart, local notices and the managing authority establish a legal limit or a closed area.</li>
            <li><strong>Weather, tides, and currents:</strong> model output and station predictions may differ from conditions at sea. Forecasts, datum, station distance, and rapidly changing conditions matter.</li>
            <li><strong>AIS:</strong> received positions can be delayed, intermittent, or absent. When the relay is in demo mode, plotted traffic is simulated.</li>
            <li><strong>COLREG study notes and ship-reporting systems:</strong> study summaries are not the legal text. Plotted reporting-system extents are informational and may be partial; they do not establish the reporting area or current reporting obligation.</li>
          </ul>
        </section>
        <section>
          <h2>Ship-reporting system coverage</h2>
          <p>Only the geometries listed below are drawn. Systems without verified geometry are not inferred from names or partial traces.</p>
          <ul className="disclaimer-sources reporting-source-list">
            {SHIP_REPORTING_SYSTEMS.coverageNotes.map((entry) => (
              <li key={entry.systemId}>
                <strong>{entry.system}</strong>
                <p>{entry.status}</p>
                <p>{entry.datum} · reviewed {entry.verifiedAsOf}</p>
                <p>{entry.note}</p>
                <a href={entry.sourceUrl} target="_blank" rel="noreferrer noopener">{entry.sourceCitation} ↗</a>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h2>Sources and reuse terms</h2>
          <ul className="disclaimer-sources">
            {sources.map((source) => <li key={source.name}><a href={source.href} target="_blank" rel="noreferrer noopener">{source.name} ↗</a><p>{source.detail}</p></li>)}
          </ul>
          <p>Regional datasets retain their own licences. Basemap, imagery, seamark, contour, sounding and ship-reporting credits are listed on this page rather than drawn over the chart; each provider&apos;s terms continue to apply. The listed sources are not an endorsement by those providers.</p>
        </section>
        <footer><a href="/app">Return to the chart</a><span>WHEELOVER · Data notice</span></footer>
      </article>
    </main>
  );
}
