import './landing.css';
import './disclaimer.css';
import { SHIP_REPORTING_SYSTEMS } from './lib/shipReportingSystems';

const sources = [
  { name: 'OpenStreetMap', detail: 'Community-mapped chart features, TSS, ferry routes, bridges, and places. © OpenStreetMap contributors; data are available under the Open Database Licence (ODbL), including its attribution and share-alike terms for derived databases.', href: 'https://www.openstreetmap.org/copyright' },
  { name: 'Esri — basemaps, imagery and relief', detail: 'World Ocean Base (Esri, Garmin, GEBCO, NOAA NGDC), World Imagery (Esri, Maxar, Earthstar Geographics) and World Shaded Relief (Esri, NOAA, USGS) are served by Esri under its respective terms.', href: 'https://www.esri.com/en-us/legal/terms' },
  { name: 'Shom — France', detail: 'Traffic-separation features from “Traffic separation schemes” (BDML_DST, 2021), Open Licence Etalab v2.0. Required credit: “Shom, 2021. Traffic separation schemes.” Shom metadata says “Do not use for navigation.”', href: 'https://services.data.shom.fr/geonetwork/srv/api/records/BDML_DST.xml' },
  { name: 'Fisheries and Oceans Canada / Canadian Hydrographic Service', detail: 'TSS feature classes from Vessel Traffic Routes. Open Government Licence — Canada permits adaptation and redistribution with source acknowledgement; attribution: “Contains information licensed under the Open Government Licence – Canada.”', href: 'https://open.canada.ca/data/en/dataset/6ab2803a-aace-4e60-83ed-44a7e0ccd1d8' },
  { name: 'UK Hydrographic Office via DataMapWales', detail: 'Selected traffic separation lanes and zones from the UKHO Ship Routeing Measures dataset. Contains public sector information, licensed under the Open Government Licence v3.0, from UKHO. The accessible DataMapWales feature extent is regional and does not represent complete UK or global coverage.', href: 'https://datamap.gov.wales/layers/appdata-wg-marine:ukho_ship_routeing_measures_areas/metadata_detail' },
  { name: 'GEBCO', detail: 'Bathymetric grids used for modelled depth numbers, display contours, and the local GEBCO_2026 contour pilot, together with the GEBCO 2023 contour tiles. Nominal grid spacing does not represent local survey detail; source resolution and vertical references vary.', href: 'https://www.gebco.net/data_and_products/gridded_bathymetry_data/' },
  { name: 'EMODnet', detail: 'Marine environmental and seabed products, including bathymetry and heritage records. Coverage, source dates, resolution, attributes, and licensing are product-specific.', href: 'https://emodnet.ec.europa.eu/' },
  { name: 'European Environment Agency — Natura 2000', detail: 'Protected-site boundaries and attributes returned by the Natura 2000 service; designations do not, by themselves, state current boating restrictions.', href: 'https://www.eea.europa.eu/en/datahub/datahubitem-view/6fc8ad2d-195d-40f4-bdec-576e7d1268e4' },
  { name: 'NOAA ENC / ENC Direct to GIS / Maritime Chart Service', detail: 'Official U.S. chart-service content is shown only as a display aid: converted ENC Direct GIS features, the NOAA Maritime Chart Service raster chart display, and the ENC depth-contour and charted-sounding layers. Converted GIS data are not an official NOAA navigation product; use current official ENCs and notices.', href: 'https://nauticalcharts.noaa.gov/learn/encdirect/' },
  { name: 'NOAA CO-OPS', detail: 'Tide and current predictions are station-based and datum-dependent. Station distance and local conditions affect how representative they are.', href: 'https://tidesandcurrents.noaa.gov/' },
  { name: 'Open-Meteo / Météo-France SMOC', detail: 'Weather and ocean-current model output is guidance rather than a local observation or guaranteed forecast. Modelled surface drift is not a harmonic tidal-current prediction.', href: 'https://open-meteo.com/en/docs/marine-weather-api' },
  { name: 'OpenSeaMap', detail: 'Seamark raster overlay (© OpenSeaMap, CC-BY-SA) and related community resources. Its credit is carried here rather than on the chart.', href: 'https://www.openseamap.org/' },
  { name: 'AISStream', detail: 'Live vessel positions depend on upstream reception, relay connectivity, reporting intervals, and feed coverage. Demo-mode traffic is simulated, not received over AIS.', href: 'https://aisstream.io/' },
];

export default function DisclaimerPage() {
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
          <h2>Other data limitations</h2>
          <ul>
            <li><strong>Depths and contours:</strong> modelled or interpolated seabed grids are not surveyed soundings and cannot establish safe depth. Grid resolution, survey density, vertical datum, and shoreline alignment vary by source and region. NOAA ENC displays and converted GIS features still require current official chart use.</li>
            <li><strong>Navigation marks, wrecks, and bridges:</strong> chart-derived, open-data, and community records can have uncertain positions, names, classifications, dates, depth references, clearance values, or status. Heritage and dive information is contextual and does not establish identity, access, or safety.</li>
            <li><strong>Protected and restricted waters:</strong> a mapped designation boundary does not itself define current access rules or prove a boating prohibition. Restrictions may be seasonal, locally defined, or absent from the displayed data.</li>
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
