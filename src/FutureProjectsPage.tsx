import './landing.css';
import { BRAND, SiteFooter, SiteHeader } from './SiteChrome';

const projects = [
  {
    number: '01',
    title: 'Sailing data',
    copy: 'Deeper sailing-specific data on the chart — the wind, sea state and tidal information that matters when the sails are up, presented the way sailors actually use it.',
    status: 'Exploring',
  },
  {
    number: '02',
    title: 'Sailing race timer',
    copy: 'A race timer built for the start line: countdown sequences, start signals and timing you can run from the helm without leaving the chart.',
    status: 'Exploring',
  },
  {
    number: '03',
    title: 'Navigation planning',
    copy: 'A fuller planning workspace beyond today’s route builder — preparing a passage end to end, with the checks and notes a voyage plan needs, before you leave the dock.',
    status: 'Exploring',
  },
  {
    number: '04',
    title: 'Accounts that link web & app',
    copy: 'Create an account and your planning follows you: build routes and courses on your PC in the web version, then open them in the app on the water — and the other way around.',
    status: 'Planned',
  },
  {
    number: '05',
    title: 'Native Android & iPhone apps',
    copy: 'Dedicated downloads for Android and iPhone/iPad, so the chart lives on your phone like any other app. The web app remains the way to use it today.',
    status: 'Planned',
  },
];

export default function FutureProjectsPage() {
  return (
    <main className="site-home site-page">
      <SiteHeader />
      <section className="page-hero">
        <div className="section-kicker">WHERE {BRAND} IS HEADED <span>—</span> FUTURE PROJECTS</div>
        <h1>What comes<br /><em>next.</em></h1>
        <p className="page-lead">These are the projects being looked into for future builds. None of them are available yet — this page is where you can see what is on the horizon, and say what you would most like to see first.</p>
      </section>
      <section className="page-sections">
        <div className="detail-grid">
          {projects.map((project) => (
            <article className="detail-card" key={project.number}>
              <div className="feature-top"><span className="feature-number">{project.number}</span><span className="future-status">{project.status}</span></div>
              <h2>{project.title}</h2>
              <p>{project.copy}</p>
            </article>
          ))}
        </div>
        <p className="page-note">Plans can change as feedback comes in. If one of these would change how you use the app, say so — it helps decide what gets built first.</p>
      </section>
      <section className="page-cta">
        <h2>Have a say in what ships next.</h2>
        <p>Feedback and ideas go straight to the developer.</p>
        <a className="button-primary" href="/support"><span className="button-icon">↗</span> Get in touch</a>
      </section>
      <SiteFooter />
    </main>
  );
}
