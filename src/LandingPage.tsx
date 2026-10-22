import type { ReactNode } from 'react';
import './landing.css';

const FEEDBACK_EMAIL = 'dcoates1@outlook.com';

const features = [
  {
    number: '01',
    title: 'Charts for the bigger picture',
    copy: 'Switch between familiar basemaps, satellite imagery, shaded relief and nautical views. NOAA chart layers add US coverage where available.',
    icon: 'chart',
  },
  {
    number: '02',
    title: 'Know what’s around you',
    copy: 'Explore navigation marks and community-mapped places, with live AIS vessel traffic when the shared feed is available.',
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
  return <a href={`mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent('WHEELOVER feedback')}`}>{children}</a>;
}

function ContactCard() {
  return <div className="contact-card"><span className="contact-mark">↗</span><strong>Feedback &amp; requests</strong><p>Found an issue or have an idea for a future build? Get in touch by email.</p><FeedbackLink><span className="contact-pending">EMAIL THE DEVELOPER</span></FeedbackLink></div>;
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

function ChartArtwork() {
  return (
    <div className="home-chart" aria-label="Illustration of a nautical chart with a plotted route and vessel markers" role="img">
      <div className="chart-grid" />
      <svg className="chart-contours" viewBox="0 0 680 520" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <path d="M-50 380c100-70 125-130 220-112s104 75 194 35 134-101 325-73M-60 422c115-75 155-130 240-115s109 61 194 27 148-92 326-62M-54 465c122-73 164-118 250-104s109 53 192 20 154-82 321-50" />
        <path d="M45-20c55 99 54 146 117 190s128 30 165 109 12 130 85 231M112-24c49 96 50 139 109 182s124 30 162 106 13 126 82 226M181-24c39 90 44 133 99 175s119 29 157 101 15 125 80 219" />
        <path d="M350 86c60-32 118-27 152 12s29 87-16 111-108 16-135-18-45-74-1-105ZM391 112c37-20 72-16 92 9s17 53-10 67-65 9-81-12-27-44-1-64Z" />
        <path d="M17 255c36-26 75-30 110-12s46 47 31 78-57 47-92 32-72-64-49-98ZM507 331c42-25 94-24 123 1s29 59 3 83-74 30-111 7-62-62-15-91Z" />
      </svg>
      <div className="chart-coordinate coordinate-one">50°45′N&nbsp; 001°18′W</div><div className="chart-coordinate coordinate-two">SOLENT · UK</div>
      <svg className="route-line" viewBox="0 0 680 520" preserveAspectRatio="none" aria-hidden="true"><path d="M92 364c90-110 143-77 226-150s129-52 252-136" /></svg>
      <span className="chart-pin pin-start"><i /></span><span className="chart-pin pin-end"><i /></span>
      <div className="chart-vessel vessel-one">▲</div><div className="chart-vessel vessel-two">▲</div>
      <div className="chart-scale"><span>0</span><i /><span>2 nm</span></div>
      <div className="chart-status"><span className="status-dot" /> Chart view <b>·</b> GPS ready</div>
      <div className="chart-float"><span className="float-label">WIND</span><strong>12 <small>kn</small></strong><span>SW · 245°</span></div>
      <div className="chart-depth">DEPTH CONTOURS <span>›</span></div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <main className="site-home">
      <header className="home-header">
        <a className="home-brand" href="#top" aria-label="WHEELOVER home"><span className="brand-mark">W</span><span>WHEELOVER</span></a>
        <nav className="home-nav" aria-label="Main navigation"><a href="#features">Features</a><a href="#platforms">Get the app</a><a href="#about">Our approach</a></nav>
        <a className="home-nav-cta" href="/app">Open chart <span aria-hidden="true">↗</span></a>
      </header>
      <section className="home-hero" id="top">
        <div className="hero-copy"><div className="eyebrow"><span className="eyebrow-line" /> A clearer view of the water</div><h1>Find your way.<br /><em>Feel the freedom.</em></h1><p className="hero-intro">A thoughtful chartplotter for curious sailors. Explore nautical charts, nearby traffic and changing conditions—all in one place.</p><p className="hero-motto">Know your course. Own your passage.</p><p className="hero-categories">Charts · Planning · Traffic · Conditions</p><div className="hero-actions"><a className="button-primary" href="/app"><span className="button-icon">↗</span> Open the web app</a><a className="button-quiet" href="#features">Explore features <span aria-hidden="true">↓</span></a></div><div className="hero-meta"><span className="meta-check">✓</span> Start exploring in your browser <span className="meta-separator">/</span> No account needed</div></div>
        <div className="hero-visual"><ChartArtwork /><div className="visual-caption"><span>01 / 04</span><span>A little more confidence, at every waypoint.</span></div></div>
        <div className="hero-bottomline"><span>MADE FOR THE WATER</span><span className="bottomline-rule"/><span>PLAN · EXPLORE · DISCOVER</span></div>
      </section>
      <section className="home-intro" id="about"><div className="section-kicker">THE WHEELOVER DIFFERENCE <span>—</span> 01</div><div className="intro-grid"><h2>The essentials,<br /><em>all in one view.</em></h2><div className="intro-body"><p>WHEELOVER brings chart layers, navigation aids, vessel traffic and marine conditions together in a clean, mobile-first experience—so you can spend less time switching tools and more time looking out to sea.</p><a href="/app" className="text-link">Take a look around <span>↗</span></a></div></div></section>
      <section className="home-features" id="features"><div className="features-heading"><div><div className="section-kicker">TOOLS FOR YOUR NEXT OUTING <span>—</span> 02</div><h2>Useful by design.</h2></div><p>Start with the chart. Open the tools you need.<br />Keep the rest of the screen for the water.</p></div><div className="feature-grid">{features.map((feature) => <article className="feature-card" key={feature.number}><div className="feature-top"><span className="feature-number">{feature.number}</span><span className="feature-icon"><FeatureIcon name={feature.icon} /></span></div><h3>{feature.title}</h3><p>{feature.copy}</p></article>)}</div><div className="feature-footnote"><span className="feature-footnote-mark">✳</span><p>Explore OpenStreetMap, satellite, relief and nautical basemaps, plus NOAA chart layers in US waters.</p><a href="/app">See the chart <span>↗</span></a></div></section>
      <section className="home-platforms" id="platforms"><div className="platforms-copy"><div className="section-kicker">YOUR DEVICE, YOUR WAY <span>—</span> 03</div><h2>Ready when<br /><em>you are.</em></h2><p>Open WHEELOVER in your browser today. Dedicated Android and iPhone downloads are planned for a future release.</p><a className="button-primary" href="/app"><span className="button-icon">↗</span> Launch web app</a></div><div className="platform-list"><a className="platform-row platform-available" href="/app"><span className="platform-icon web-icon">◎</span><span className="platform-text"><strong>Web app</strong><small>Available now · Open in your browser</small></span><span className="platform-action">OPEN <b>↗</b></span></a><div className="platform-row"><span className="platform-icon">◈</span><span className="platform-text"><strong>Android</strong><small>Native app in a future release</small></span><span className="platform-coming">COMING SOON</span></div><div className="platform-row"><span className="platform-icon">◉</span><span className="platform-text"><strong>iPhone &amp; iPad</strong><small>Native app in a future release</small></span><span className="platform-coming">COMING SOON</span></div><div className="platform-note"><span>i</span><p>Native downloads aren’t available yet. The web app is the current way to use WHEELOVER on desktop and mobile browsers.</p></div></div></section>
      <section className="home-safety"><div className="safety-icon">!</div><div><span className="section-kicker">A NOTE ON NAVIGATION</span><p>WHEELOVER is a planning and situational-awareness aid, not a certified navigation system. Always use official charts, notices and your own judgement.</p></div></section>
      <section className="home-contact" id="contact"><div><div className="section-kicker">HELP SHAPE WHAT COMES NEXT <span>—</span> 04</div><h2>Good ideas travel.<br /><em>Send yours our way.</em></h2><p>Found an issue, or have an idea for a future build? We’d love to hear what would make your time on the water better.</p></div><ContactCard /></section>
      <footer className="home-footer"><a className="home-brand" href="#top"><span className="brand-mark">W</span><span>WHEELOVER</span></a><span className="footer-note">Know your course. Own your passage.</span><a href="/app" className="footer-link">Open web app ↗</a><span className="footer-copy">© {new Date().getFullYear()} WHEELOVER</span></footer>
    </main>
  );
}
