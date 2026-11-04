import './landing.css';
import { BRAND, SiteFooter, SiteHeader } from './SiteChrome';

const premium = [
  {
    title: 'GPX export & import',
    copy: 'Export your pins and tracks, and import routes and waypoints from other apps and chartplotters. Locked in the free app today — it returns as part of Premium.',
    status: 'Locked today · Premium',
  },
  {
    title: '7-day forecast',
    copy: 'A full week of wind, waves, tides and currents for planning further ahead, instead of the 2-day outlook in the free app.',
    status: 'Planned · Premium',
  },
  {
    title: 'Sailing data',
    copy: 'Deeper sailing-specific data on the chart — the wind, sea state and tidal information that matters when the sails are up, presented the way sailors actually use it: wind shifts, tide gates and sea state in the terms you plan around, not just raw numbers.',
    status: 'Exploring · Premium',
  },
  {
    title: 'Sailing race timer',
    copy: 'A race timer built for the start line: countdown sequences, start signals and timing you can run from the helm without leaving the chart. Five-four-one-minute sequences and rolling starts, signals you can hear over wind and water, and a start-line view that stays readable in sun and spray.',
    status: 'Exploring · Premium',
  },
  {
    title: 'Navigation planning',
    copy: 'The route builder, hazard check and anti-grounding flag are in the app today. Still to come in planning: a weather verdict for departure, bridge air-draft checks against your boat’s air draft, and a fuller planning workspace — saved routes you can return to, and notes on each route.',
    status: 'In progress · Premium',
  },
  {
    title: 'Accounts that link web & app',
    copy: 'Create an account and your planning follows you: build routes and courses on your PC in the web version, then open them in the app on the water — and the other way around. Your pins, logbook and tracks come with you between devices. Accounts also unlock the community features below, which is why they come first.',
    status: 'Planned · Premium',
  },
  {
    title: 'Community Features',
    copy: 'Destination reviews, crowdsourced chart updates, shared pins, community routes and hazards with voting, connecting with other boaters, and sharing routes and experiences — plus private and public groups for clubs, fleets and cruising friends. These need accounts first, so they follow the account project above.',
    status: 'Planned · Premium',
  },
  {
    title: 'Routes that steer around land and hazards',
    copy: 'Automatic routing that steers your route around land and charted hazards, using your boat’s draft and air draft — and checking bridge clearances along the way. Until this arrives, the route builder stays manual — you plot, the app checks.',
    status: 'Planned · Premium',
  },
  {
    title: 'Advanced Navigation',
    copy: 'Live guidance and alarms while you navigate: cross-track error with an off-course alert, waypoint arrival and proximity alerts, CPA/TCPA collision alarms from live AIS traffic, weather checked along the route for the time you reach each point, tide-window departure planning, a depth profile along your route, per-waypoint ETAs and VMG, and a fuel range ring. The route planner today plots and checks; this is the set that watches over you while you sail it. The alarms will want the native apps’ background alerts to work properly.',
    status: 'Planned · Premium',
  },
];

export default function FutureProjectsPage() {
  return (
    <main className="site-home site-page">
      <SiteHeader />
      <section className="page-hero">
        <div className="section-kicker">WHERE {BRAND} IS HEADED <span>—</span> FUTURE PROJECTS</div>
        <h1>What comes<br /><em>next.</em></h1>
        <p className="page-lead">These are the projects being looked into for future builds. None of them are available yet — this page is where you can see what is on the horizon, and say what you would most like to see first. The native Android &amp; iPhone/iPad apps come first and stay free; everything else below arrives as part of a paid Premium version.</p>
      </section>
      <section className="page-sections">
        <div className="section-kicker">COMING SOON <span>—</span> FREE</div>
        <h2>Native Android &amp; iPhone apps</h2>
        <p className="page-lead">Dedicated downloads for Android and iPhone/iPad, so the chart lives on your phone like any other app — with offline charts, GPS in the background, and alerts for anchor watch and warnings. The web app remains the way to use it today. Free when they arrive — not part of Premium.</p>
      </section>
      <section className="page-sections">
        <div className="section-kicker">PAID VERSION IN THE WORKS <span>—</span> PREMIUM</div>
        <h2>A paid Premium version is in the works. It will include:</h2>
        <div className="detail-grid">
          {premium.map((project) => (
            <article className="detail-card" key={project.title}>
              <div className="feature-top"><span className="future-status">{project.status}</span></div>
              <h2>{project.title}</h2>
              <p>{project.copy}</p>
            </article>
          ))}
        </div>
        <p className="page-note">No price or date yet; the app stays free either way. Plans can change as feedback comes in. If one of these would change how you use the app, say so — it helps decide what gets built first.</p>
      </section>
      <section className="page-cta">
        <h2>Have a say in what ships next.</h2>
        <p>Nothing here is set in stone — the order these get built depends on what sailors actually ask for. Tell the developer which project would change your time on the water, how you would use it, and where you sail. Every message goes straight to the developer, and the projects with the loudest chorus get built first.</p>
        <a className="button-primary" href="/support"><span className="button-icon">↗</span> Get in touch</a>
      </section>
      <SiteFooter />
    </main>
  );
}
