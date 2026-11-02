import { useState, type ReactNode } from 'react';
import './landing.css';

export const BRAND = '@ Wheel-over';
export const DONATE_EMAIL = 'dcoates1@outlook.com';
export const PAYPAL_URL = 'https://paypal.me/DouglasCoates230';

export function SiteHeader() {
  return (
    <header className="home-header">
      <a className="home-brand" href="/" aria-label="@ Wheel-over home"><img className="home-logo" src="/images/wheelover-icon.webp" alt="" /><span>{BRAND}</span></a>
      <nav className="home-nav" aria-label="Main navigation"><a href="/features">Features</a><a href="/future-projects">Future projects</a><a href="/support">Support</a><a href="/#platforms">Get the app</a></nav>
      <a className="home-nav-cta" href="/app">Open chart <span aria-hidden="true">↗</span></a>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="home-footer">
      <a className="home-brand" href="/"><img className="home-logo" src="/images/wheelover-icon.webp" alt="" /><span>{BRAND}</span></a>
      <span className="footer-note">Know your course. Own your passage.</span>
      <a href="/features" className="footer-link">Features ↗</a>
      <a href="/future-projects" className="footer-link">Future projects ↗</a>
      <a href="/support" className="footer-link">Support the project ↗</a>
      <a href="/app" className="footer-link">Open web app ↗</a>
      <a href="/disclaimer" className="footer-link">Open-data disclaimer</a>
      <span className="footer-copy">© {new Date().getFullYear()} {BRAND}</span>
    </footer>
  );
}

/** The two ways to contribute: PayPal, and an Interac e-Transfer to the developer's email. */
export function DonateOptions() {
  const [copied, setCopied] = useState(false);
  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(DONATE_EMAIL);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard unavailable: the address is shown in full below, so it can still be copied by hand.
    }
  };
  return (
    <div className="donate-row">
      <a className="button-primary support-button" href={PAYPAL_URL} target="_blank" rel="noopener noreferrer"><span className="button-icon" aria-hidden="true">↗</span> Donate via PayPal</a>
      <div className="etransfer-card">
        <strong>Donate via Interac e-Transfer</strong>
        <p>Send an e-Transfer from your bank app to</p>
        <div className="etransfer-address">
          <span>{DONATE_EMAIL}</span>
          <button type="button" className="copy-email" onClick={copyEmail}>{copied ? 'Copied ✓' : 'Copy email'}</button>
        </div>
      </div>
    </div>
  );
}

export function PageHero({ kicker, title, lead, children }: { kicker: string; title: ReactNode; lead: string; children?: ReactNode }) {
  return (
    <section className="page-hero">
      <div className="section-kicker">{kicker}</div>
      <h1>{title}</h1>
      <p className="page-lead">{lead}</p>
      {children}
    </section>
  );
}
