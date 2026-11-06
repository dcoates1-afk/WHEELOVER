import { createRoot } from 'react-dom/client';
import 'leaflet/dist/leaflet.css';
import './styles.css';
import App from './App';
import LandingPage from './LandingPage';
import DisclaimerPage from './DisclaimerPage';
import FeaturesPage from './FeaturesPage';
import SupportPage from './SupportPage';
import FutureProjectsPage from './FutureProjectsPage';
import ErrorBoundary from './ErrorBoundary';

const isAppRoute = window.location.pathname === '/app' || window.location.pathname.startsWith('/app/');
const isDisclaimerRoute = window.location.pathname === '/disclaimer';
const isFeaturesRoute = window.location.pathname === '/features';
const isSupportRoute = window.location.pathname === '/support';
const isFutureRoute = window.location.pathname === '/future-projects';
const RootView = isAppRoute ? App : isDisclaimerRoute ? DisclaimerPage : isFeaturesRoute ? FeaturesPage : isSupportRoute ? SupportPage : isFutureRoute ? FutureProjectsPage : LandingPage;

if (isAppRoute && window.location.pathname !== '/app') {
  window.history.replaceState(null, '', `/app${window.location.search}${window.location.hash}`);
}

if (window.location.pathname === '/app') {
  const viewport = document.querySelector('meta[name="viewport"]');
  viewport?.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover');
}
if (!isAppRoute) {
  const viewport = document.querySelector('meta[name="viewport"]');
  viewport?.setAttribute('content', 'width=device-width, initial-scale=1.0');
}

const title = isAppRoute ? '@ Wheel-over — Maritime Navigation and Planning' : isDisclaimerRoute ? 'Open-data disclaimer — @ Wheel-over' : isFeaturesRoute ? 'Features — @ Wheel-over' : isSupportRoute ? 'Support — @ Wheel-over' : isFutureRoute ? 'Future projects — @ Wheel-over' : '@ Wheel-over — Know your course. Own your passage.';

document.title = title;
const description = document.querySelector('meta[name="description"]');
description?.setAttribute('content', isAppRoute
  ? '@ Wheel-over — Maritime Navigation and Planning. Explore nautical charts, navigation aids, live AIS, tides and marine weather.'
  : isDisclaimerRoute
    ? 'Sources, limitations and important safety information for open-data overlays and tools in @ Wheel-over.'
    : isFeaturesRoute
      ? 'Every feature of @ Wheel-over in depth: charts, navigation aids, live AIS, bridges, routes, conditions and more.'
      : isSupportRoute
        ? 'Support @ Wheel-over: donate via PayPal or Interac e-Transfer, or send feedback to the developer.'
        : isFutureRoute
          ? 'What comes next for @ Wheel-over: sailing data, a race timer, navigation planning and accounts linking web and app.'
          : 'Know your course. Own your passage. A thoughtful chartplotter for curious sailors: charts, planning, traffic and conditions.');

import.meta.env.DEV && console.info(`[WHEELOVER] ${isAppRoute ? 'chart app' : 'product website'} loaded`);

// Keep the app available at /app while the root URL presents the product site.
// (The HTML root remains shared to preserve this Vite single-page setup.)

const container = document.getElementById('root');
if (!container) throw new Error('WHEELOVER root element is missing');

createRoot(container).render(
  <ErrorBoundary>
    <RootView />
  </ErrorBoundary>,
);
