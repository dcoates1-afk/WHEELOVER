import './landing.css';
import { BRAND, DonateOptions, SiteFooter, SiteHeader } from './SiteChrome';

const FEEDBACK_EMAIL = 'atwheel-over@outlook.com';

export default function SupportPage() {
  return (
    <main className="site-home site-page">
      <SiteHeader />
      <section className="page-hero">
        <div className="section-kicker">KEEP THIS PROJECT AFLOAT <span>—</span> SUPPORT</div>
        <h1>Enjoy {BRAND}?<br /><em>Help it chart ahead.</em></h1>
        <p className="page-lead">{BRAND} is an independent project, built to make useful marine information easier to explore. The app remains free to use. If it is helpful to you, an optional contribution helps support its ongoing development — paying for the unglamorous parts: keeping the chart and traffic feeds working, building the next features, and keeping the app free for everyone who uses it. There are no investors and no ads, just sailors chipping in when the app earns it.</p>
      </section>
      <section className="page-sections">
        <h2 className="page-section-title">Ways to contribute</h2>
        <DonateOptions />
        <p className="page-note">Contributions are optional and go to the developer directly. They help keep the charts, traffic feeds and new features coming — the app itself stays free.</p>
      </section>
      <section className="page-sections">
        <h2 className="page-section-title">Feedback &amp; requests</h2>
        <div className="detail-grid">
          <article className="detail-card">
            <h2>Found an issue?</h2>
            <p>Something drawn wrong, a bridge card that looks off, a warning in the wrong place, or a view that came up empty? Tell the developer what you saw and where — a place name or coordinates make it much faster to track down. A screenshot and the time you saw it help even more, and if it is a bridge or a mark, the name on the card is worth including. Reports go straight to the developer, who reproduces the problem, fixes it, and ships the fix in a later build — the app updates in your browser, nothing to reinstall.</p>
            <a className="text-link" href={`mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent('@ Wheel-over feedback')}`}>Email the developer <span>↗</span></a>
          </article>
          <article className="detail-card">
            <h2>Have an idea?</h2>
            <p>Ideas for future builds are welcome — sailing tools, race features, planning improvements, community features, anything that would make time on the water better. The most useful ideas say what problem they solve and how you would use the feature: where you sail, how often, and what you do today instead. Good ideas travel, and several features in the app started exactly this way.</p>
            <a className="text-link" href="/future-projects">See what is planned <span>→</span></a>
          </article>
        </div>
      </section>
      <section className="page-cta">
        <h2>Back to the water.</h2>
        <p>The chart is open in your browser whenever you need it.</p>
        <a className="button-primary" href="/app"><span className="button-icon">↗</span> Open the web app</a>
      </section>
      <SiteFooter />
    </main>
  );
}
