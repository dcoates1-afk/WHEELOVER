import type { ReactNode } from 'react';
import './landing.css';
import { BRAND, DonateOptions } from './SiteChrome';

const FEEDBACK_EMAIL = 'atwheel-over@outlook.com';

const features = [
  {
    number: '01',
    title: 'Charts for the bigger picture',
    copy: 'Switch between six base layers: OpenStreetMap standard chart, satellite, nautical, relief, NOAA ENC and NOAA raster maps.',
    icon: 'chart',
  },
  {
    number: '02',
    title: 'Know what’s around you',
    copy: 'OpenSeaMap seamarks and a worldwide database of navigation aids, plus live AIS vessel traffic when the shared feed is available.',
    icon: 'radar',
  },
  {
    number: '03',
    title: 'Conditions at a glance',
    copy: 'Check wind, waves, tides and currents, with local station information where available and model guidance elsewhere.',
    icon: 'weather',
  },
  {
    number: '04',
    title: 'Made for a day on the water',
    copy: 'Use GPS location, save chart tiles for offline viewing, and keep COLREGs study notes close at hand.',
    icon: 'compass',
  },
];

function FeedbackLink({ children }: { children: ReactNode }) {
  if (!FEEDBACK_EMAIL) return <span className="feedback-unavailable">{children}</span>;
  return <a href={`mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent('@ Wheel-over feedback')}`}>{children}</a>;
}

function ContactCard() {
  return <div className="contact-card"><span className="contact-mark">↗</span><strong>Feedback &amp; requests</strong><p>Found an issue or have an idea for a future build? Get in touch by email — a place name or coordinates for a problem, or the problem your idea solves, makes it much faster to act on.</p><FeedbackLink><span className="contact-pending">EMAIL THE DEVELOPER</span></FeedbackLink></div>;
}

function FeatureIcon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    chart: <><path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z"/><path d="M9 4v13.5M15 6.5V20"/></>,
    radar: <><circle cx="12" cy="12" r="8.5"/><path d="M12 12 18.5 6.5M12 3.5v17M3.5 12h17"/><circle cx="12" cy="12" r="2"/></>,
    weather: <><path d="M4 15.5a4 4 0 0 1 1.5-7.7A6.5 6.5 0 0 1 18 9a3.5 3.5 0 0 1 .5 7H4Z"/><path d="m8 19-1 2m6-2-1 2m6-2-1 2"/></>,
    compass: <><circle cx="12" cy="12" r="9"/><path d="m15.7 8.3-2.4 5-5 2.4 2.4-5 5-2.4Z"/><path d="M12 2v2m10 8h-2M4 12H2m10 10v-2"/></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

export default function LandingPage() {
  return (
    <main className="site-home">
      <header className="home-header">
        <a className="home-brand" href="#top" aria-label="@ Wheel-over home"><img className="home-logo" src="/images/wheelover-icon.webp" alt="" /><span>{BRAND}</span></a>
        <nav className="home-nav" aria-label="Main navigation"><a href="/features">Features</a><a href="#screens">See it in action</a><a href="/future-projects">Future projects</a><a href="/support">Support</a><a href="#platforms">Get the app</a></nav>
        <a className="home-nav-cta" href="/app">Open chart <span aria-hidden="true">↗</span></a>
      </header>
      <section className="home-hero" id="top">
        <div className="hero-copy"><div className="eyebrow"><span className="eyebrow-line" /> A clearer view of the water</div><h1>Find your way.<br /><em>Feel the freedom.</em></h1><p className="hero-intro">A thoughtful chartplotter for curious sailors. Open the chart and go — no account, nothing to install. Explore nautical charts, nearby traffic, bridge clearances and changing conditions in one place, save the spots that matter to you, and spend less time switching tools and more time looking out to sea.</p><div className="chip-row"><span className="chip">Free to use</span><span className="chip">No account needed</span><span className="chip">Runs in your browser</span></div><p className="hero-motto">Know your course. Own your passage.</p><p className="hero-categories">Charts · Planning · Traffic · Conditions</p><div className="hero-actions"><a className="button-primary" href="/app"><span className="button-icon">↗</span> Open the web app</a><a className="button-quiet" href="/features">Explore features <span aria-hidden="true">↓</span></a></div><div className="hero-meta"><span className="meta-check">✓</span> Start exploring in your browser <span className="meta-separator">/</span> No account needed</div></div>
        <div className="hero-visual"><div className="browser-frame shot-tilt"><div className="browser-bar"><span className="browser-dots"><i /><i /><i /></span><span className="browser-url">{BRAND} · Victoria Harbour</span></div><img src="/images/app-victoria-harbour.jpg" alt="The @ Wheel-over chart showing Victoria Harbour with navigation marks, ferry routes and bridges" /></div><span className="sticker">Real app. Real water.</span><div className="visual-caption"><span>REAL SCREENS</span><span>Straight from the working app — no mockups.</span></div></div>
        <div className="hero-bottomline"><span>MADE FOR THE WATER</span><span className="bottomline-rule"/><span>PLAN · EXPLORE · DISCOVER</span></div>
      </section>
      <div className="wave-divider" aria-hidden="true"><svg viewBox="0 0 1200 40" preserveAspectRatio="none"><path d="M0 24c100-14 200-14 300 0s200 14 300 0 200-14 300 0 200 14 300 0v16H0Z" /></svg></div>
      <section className="home-intro" id="about"><div className="section-kicker">THE @ WHEEL-OVER DIFFERENCE <span>—</span> 01</div><div className="intro-grid"><h2>The essentials,<br /><em>all in one view.</em></h2><div className="intro-body"><p>{BRAND} brings chart layers, navigation aids, vessel traffic, bridge clearances, marine conditions and your own pins, logbook and tracks together in a clean, mobile-first experience — the essentials, all in one view, so you can check the water, plan the day and keep your own notes without juggling five apps.</p><a href="/app" className="text-link">Take a look around <span>↗</span></a></div></div></section>
      <section className="home-screens" id="screens"><div className="screens-heading"><div><div className="section-kicker">SEE IT IN ACTION <span>—</span> 02</div><h2>Real screens. Real water.</h2></div><p>Straight from the working app — the harbour chart, a bridge up close, and the weather drawer with its GPS / screen-centre toggle.</p></div><div className="screen-grid"><figure className="screen-card tilt-left"><div className="browser-frame"><div className="browser-bar"><span className="browser-dots"><i /><i /><i /></span><span className="browser-url">Victoria Harbour</span></div><img src="/images/app-victoria-harbour.jpg" alt="The @ Wheel-over chart over Victoria Harbour" loading="lazy" /></div><figcaption><strong>The whole harbour</strong><span>Marks, ferry routes, traffic schemes and bridges in one view.</span></figcaption></figure><figure className="screen-card"><div className="browser-frame"><div className="browser-bar"><span className="browser-dots"><i /><i /><i /></span><span className="browser-url">Johnson Street Bridge</span></div><img src="/images/app-johnson-bridge.jpg" alt="The @ Wheel-over chart zoomed into the Johnson Street Bridge area" loading="lazy" /></div><figcaption><strong>Bridges up close</strong><span>One card per bridge, with clearances and operation.</span></figcaption></figure><figure className="screen-card tilt-right"><div className="browser-frame"><div className="browser-bar"><span className="browser-dots"><i /><i /><i /></span><span className="browser-url">Weather conditions</span></div><img src="/images/app-weather.jpg" alt="The @ Wheel-over weather drawer showing wind, sea state and tides" loading="lazy" /></div><figcaption><strong>Weather, your way</strong><span>GPS location or screen centre — pulled instantly.</span></figcaption></figure></div></section>
      <section className="home-features" id="features"><div className="features-heading"><div><div className="section-kicker">TOOLS FOR YOUR NEXT OUTING <span>—</span> 03</div><h2>Useful by design.</h2></div><p>Start with the chart. Open the tools you need.<br />Keep the rest of the screen for the water.</p></div><div className="feature-grid">{features.map((feature) => <article className="feature-card" key={feature.number}><div className="feature-top"><span className="feature-number">{feature.number}</span><span className="feature-icon"><FeatureIcon name={feature.icon} /></span></div><h3>{feature.title}</h3><p>{feature.copy}</p></article>)}</div><div className="feature-footnote"><span className="feature-footnote-mark">✳</span><p>Explore OpenStreetMap, satellite, relief and nautical basemaps, plus NOAA chart layers in US waters.</p><a href="/features">See all features <span>↗</span></a></div></section>
      <section className="home-platforms" id="platforms"><div className="platforms-copy"><div className="section-kicker">YOUR DEVICE, YOUR WAY <span>—</span> 04</div><h2>Ready when<br /><em>you are.</em></h2><p>Open {BRAND} in your browser today. Dedicated Android and iPhone downloads are planned for a future release.</p><a className="button-primary" href="/app"><span className="button-icon">↗</span> Launch web app</a><p className="platforms-future">Accounts that link the web app with your phone, plus sailing tools, are on the way. <a href="/future-projects">See future projects ↗</a></p></div><div className="platform-list"><a className="platform-row platform-available" href="/app"><span className="platform-icon web-icon">◎</span><span className="platform-text"><strong>Web app</strong><small>Available now · Open in your browser</small></span><span className="platform-action">OPEN <b>↗</b></span></a><div className="platform-row"><span className="platform-icon">◈</span><span className="platform-text"><strong>Android</strong><small>Native app in a future release</small></span><span className="platform-coming">COMING SOON</span></div><div className="platform-row"><span className="platform-icon">◉</span><span className="platform-text"><strong>iPhone &amp; iPad</strong><small>Native app in a future release</small></span><span className="platform-coming">COMING SOON</span></div><div className="platform-note"><span>i</span><p>Native downloads aren’t available yet. The web app is the current way to use {BRAND} on desktop and mobile browsers.</p></div></div></section>
      <section className="home-support" id="support" aria-labelledby="support-title"><div className="support-copy"><div className="section-kicker">KEEP THIS PROJECT AFLOAT <span>—</span> 05</div><h2 id="support-title">Enjoy {BRAND}?<br /><em>Help it chart ahead.</em></h2><p>{BRAND} is an independent project, built to make useful marine information easier to explore. There are no investors and no ads. If it is helpful to you, an optional contribution helps pay for the work behind it — keeping the chart and traffic feeds running, building the next features, and keeping the app free for everyone. The app remains free to use whether you contribute or not.</p><a href="/support" className="text-link">More on the Support page <span>↗</span></a></div><DonateOptions /></section>
      <section className="home-contact" id="contact"><div><div className="section-kicker">HELP SHAPE WHAT COMES NEXT <span>—</span> 06</div><h2>Good ideas travel.<br /><em>Send yours our way.</em></h2><p>Found an issue, or have an idea for a future build? We’d love to hear what would make your time on the water better.</p></div><ContactCard /></section>
      <footer className="home-footer"><a className="home-brand" href="#top"><img className="home-logo" src="/images/wheelover-icon.webp" alt="" /><span>{BRAND}</span></a><span className="footer-note">Know your course. Own your passage.</span><a href="/features" className="footer-link">Features ↗</a><a href="/future-projects" className="footer-link">Future projects ↗</a><a href="/support" className="footer-link">Support the project ↗</a><a href="/app" className="footer-link">Open web app ↗</a><a href="/disclaimer" className="footer-link">Open-data disclaimer</a><span className="footer-copy">© {new Date().getFullYear()} {BRAND}</span></footer>
    </main>
  );
}
