import './landing.css';
import { BRAND, SiteFooter, SiteHeader } from './SiteChrome';

const details = [
  {
    number: '01',
    title: 'Charts & base layers',
    copy: 'Six base layers switch the background chart underneath everything — the chart itself: Standard Chart (OpenStreetMap raster), Satellite Map, Nautical Map, Relief Map, NOAA ENC Map, and NOAA Raster Maps. A nautical dark theme keeps the chart readable day and night on deck.',
    points: ['Standard Chart, Satellite, Nautical and Relief base layers', 'NOAA ENC and NOAA Raster charts in US waters', 'Switchable nautical dark theme for day/night use'],
  },
  {
    number: '02',
    title: 'Depth contours, numbers & soundings',
    copy: 'Depth contours, depth numbers and charted soundings are their own overlay, so you can read the shape of the bottom at a glance and check the numbers where they are charted.',
    points: ['Depth contours showing the shape of the bottom', 'Depth numbers and charted soundings', 'Toggleable, so the chart stays clean when you do not need them'],
  },
  {
    number: '03',
    title: 'Navigation aids, by type',
    copy: 'A worldwide database of navigation aids, drawn from OpenSeaMap seamarks and listed by type, each with its own toggle: lateral marks, cardinal marks, isolated danger marks, safe water marks, special marks, and lights and beacons. Tap any mark for its detail card.',
    points: ['Red and green lateral marks with light characteristics', 'Fog signals and racons where mapped', 'Beacon towers and named marks, not just dots', 'Marine areas and restrictions as individual toggles in the same filters'],
  },
  {
    number: '04',
    title: 'AIS live traffic',
    copy: 'Watch real vessel traffic on the chart, receive-only. Bring your own free AISStream key and it stays on your device; without one, demo vessels keep the traffic view working for practice.',
    points: ['Boat-shaped vessel icons, twice as long as wide, coloured by ship type, with name labels', 'Tracking info and track history, with full detail cards for every vessel', 'Filter traffic by ship type; master on/off toggle'],
  },
  {
    number: '05',
    title: 'Bridges and Clearances',
    copy: 'Bridges are drawn worldwide as a single overlay and a single card per bridge, however many ways the map splits them into. The card combines every mapped record for that crossing, and adds charted clearances from six open sources where they exist.',
    points: ['Operation on every card: Fixed, Raising or Rotating', 'Charted clearances from NOAA ENC, USACE Inland ENC, EuRIS, the viadonau Danube list, US Coast Pilot and Environment Agency headways', 'Every figure carries its datum, source and retrieval date — and a figure with no datum is labelled, never tide-adjusted', 'Bridges over land are not drawn'],
  },
  {
    number: '06',
    title: 'Destination search',
    copy: 'Search any place on Earth by name and fly straight to it. Type three or more characters, pick a result, and the chart centres on it with an orange pin marking the spot.',
    points: ['Place search powered by OpenStreetMap', 'The chart flies to the result and drops a pin', 'Tap the pin or the chart to clear it'],
  },
  {
    number: '07',
    title: 'Saved pins',
    copy: 'Drop your own pins on the chart — anchorages, hazards, favourite spots — and keep them on this device. No account, no server: your pins live in your browser, with a name and notes on each.',
    points: ['Tap the chart to place a pin, rename it and add notes', 'Orange pins on the chart, cyan when selected', 'Saved on this device only — shared pins need accounts, coming later'],
  },
  {
    number: '08',
    title: 'Boat log',
    copy: 'A logbook, pre-departure checklist, maintenance tracker and fuel log in one panel, all saved on this device.',
    points: ['Logbook entries with date, title and notes', '21-item checklist: before leaving, under way, after return', 'Date-based maintenance with overdue and due-soon reminders, plus fuel fills and totals'],
  },
  {
    number: '09',
    title: 'Track recording',
    copy: 'Record your own GPS track as you sail and play it back on the chart. Recording starts and stops from the Boat log, and the button shows an orange dot while a track is live.',
    points: ['Points join only after moving 25 metres, so sitting at anchor does not fill the track with jitter', 'Saved tracks draw in cyan, live recording in orange', 'Date, points, distance and duration for every track'],
  },
  {
    number: '10',
    title: 'Routes & voyage planning',
    copy: 'Plot a route by tapping waypoints on the chart or typing coordinates, drag them into place, and check it before you leave the dock: per-leg distance and bearing, total distance and ETA from your cruising speed, mapped hazards on every leg, and an anti-grounding flag from depth data against your boat’s draught.',
    points: ['Waypoints by tap or typed coordinates, draggable on the chart', 'Per-leg distance and bearing, totals and ETA', 'Hazard check against marine areas, ferry lanes and traffic schemes', 'Anti-grounding flag: sampled depths vs draught plus a safety margin'],
  },
  {
    number: '11',
    title: 'NAVAREA warnings',
    copy: 'Live broadcast warnings from the US National Geospatial-Intelligence Agency, as an opt-in layer. Warnings with a position in their text get a marker on the chart; warnings without one still appear in the menu list, never as a guessed point.',
    points: ['In-force warnings only, refreshed through the app', 'Tap a marker for the full warning text', 'Off by default — the feed is large, so it loads on your say-so'],
  },
  {
    number: '12',
    title: 'Conditions: wind, tides & currents',
    copy: 'Check what the water is doing before you go: wind and waves, tide heights, and tidal currents, with local station information where available and model guidance elsewhere. The weather button reads in two lines, and a toggle pulls conditions for your GPS position or the screen centre, instantly.',
    points: ['Wind, waves and sea conditions at a glance', 'Tide heights and tidal current vectors', 'Station readings where a station is nearby', 'Weather for your GPS position or the screen centre, switched instantly'],
  },
  {
    number: '13',
    title: 'Traffic schemes & ferry lanes',
    copy: 'Traffic Separation Schemes are drawn with their boundaries, separation zones and direction arrows, and ferry lanes show as their own layer — so the rules of the road are visible on the chart, not just in a book.',
    points: ['TSS boundaries, shaded separation zones and arrows', 'Ferry lanes as a separate toggle', 'Independent toggles for schemes and ferries'],
  },
  {
    number: '14',
    title: 'Marine areas, restrictions & public places',
    copy: 'Marine areas and restrictions sit on the chart alongside public places — hospitals, restaurants, pharmacies, bathrooms, marinas and boat ramps/launches — each with its own detail card and source link.',
    points: ['Designated marine areas and restrictions', 'Public places: hospitals, restaurants, pharmacies, bathrooms, marinas, boat ramps and launches', 'Every card links its source record'],
  },
  {
    number: '15',
    title: 'Position & coordinates',
    copy: 'Your own position is shown on screen as a live GPS own-ship marker with a Locate Me button, and every position can be read or entered in any of eight coordinate formats.',
    points: ['On-screen vessel position with GPS own-ship marker and Locate Me', 'Decimal degrees, degrees-decimal-minutes and degrees-minutes-seconds', 'UTM, MGRS, Maidenhead, Plus Codes and Geohash'],
  },
  {
    number: '16',
    title: 'Anchor watch & course',
    copy: 'Set an anchor watch on your anchored position and be alerted if the boat drifts beyond your watch radius, with your course shown on screen alongside your position.',
    points: ['Anchor position with a watch radius you set', 'Alert if the vessel drifts outside the watch circle', 'Course shown on screen with your position'],
  },
  {
    number: '17',
    title: 'Own boat database',
    copy: 'Keep your own boat’s details on the chart whenever you need them — name, type, measurements and identifiers — saved on this device with everything else.',
    points: ['One boat profile with its measurements', 'Length, beam and draught at hand for clearance and grounding checks', 'MMSI and call sign stored with the boat'],
  },
  {
    number: '18',
    title: 'COLREGs guide',
    copy: 'Collision Regulations guidance is built in, with the Canada, US and UK modifications alongside the international rules — structured study notes for the helm, kept close at hand while you plan.',
    points: ['All 41 IMO 1972 rules in structured form', 'Canada, US and UK modifications included', 'Written as guidance for study, not verbatim statute'],
  },
];

export default function FeaturesPage() {
  return (
    <main className="site-home site-page">
      <SiteHeader />
      <section className="page-hero">
        <div className="section-kicker">EVERYTHING IN THE APP <span>—</span> FEATURES</div>
        <h1>What {BRAND} does,<br /><em>in depth.</em></h1>
        <p className="page-lead">Charts, navigation aids, live traffic, bridges, warnings, boat log and conditions — the full feature set of the app, in one place. Open the web app to try any of it in your browser.</p>
        <div className="hero-actions"><a className="button-primary" href="/app"><span className="button-icon">↗</span> Open the web app</a><a className="button-quiet" href="/future-projects">What comes next <span aria-hidden="true">→</span></a></div>
      </section>
      <section className="page-sections">
        <div className="detail-grid">
          {details.map((detail) => (
            <article className="detail-card" key={detail.number}>
              <div className="feature-top"><span className="feature-number">{detail.number}</span></div>
              <h2>{detail.title}</h2>
              <p>{detail.copy}</p>
              <ul>{detail.points.map((point) => <li key={point}>{point}</li>)}</ul>
            </article>
          ))}
        </div>
      </section>
      <section className="page-safety">
        <div className="section-kicker">PLEASE NOTE <span>—</span> SAFETY</div>
        <p>{BRAND} is not for primary navigation. It combines open, community-mapped and modelled information that can be incomplete or stale. Always consult current official charts, Notices to Mariners and the responsible authorities before a passage. <a href="/disclaimer">Read the full data notice ↗</a></p>
      </section>
      <section className="page-cta">
        <h2>See it on the water.</h2>
        <p>Every feature above is live in the web app today — no account needed.</p>
        <a className="button-primary" href="/app"><span className="button-icon">↗</span> Launch the web app</a>
        <p className="page-note">A paid Premium version is in the works — GPX export &amp; import, a 7-day forecast, and most of the projects on the Future Projects page. The native Android &amp; iPhone/iPad apps stay free when they arrive. <a href="/future-projects">See what is planned ↗</a></p>
      </section>
      <SiteFooter />
    </main>
  );
}
