import { createRoot } from 'react-dom/client';
import 'leaflet/dist/leaflet.css';
import './styles.css';
import App from './App';
import LandingPage from './LandingPage';

const isAppRoute = window.location.pathname === '/app' || window.location.pathname.startsWith('/app/');
const RootView = isAppRoute ? App : LandingPage;

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

const title = isAppRoute ? 'WHEELOVER — Maritime Navigation and Planning' : 'WHEELOVER — Know your course. Own your passage.';
document.title = title;
const description = document.querySelector('meta[name="description"]');
description?.setAttribute('content', isAppRoute
  ? 'WHEELOVER — Maritime Navigation and Planning. Explore nautical charts, navigation aids, live AIS, tides and marine weather.'
  : 'Know your course. Own your passage. A thoughtful chartplotter for curious sailors: charts, planning, traffic and conditions.');

import.meta.env.DEV && console.info(`[WHEELOVER] ${isAppRoute ? 'chart app' : 'product website'} loaded`);

// Keep the app available at /app while the root URL presents the product site.
// (The HTML root remains shared to preserve this Vite single-page setup.)

const container = document.getElementById('root');
if (!container) throw new Error('WHEELOVER root element is missing');

createRoot(container).render(<RootView />);
