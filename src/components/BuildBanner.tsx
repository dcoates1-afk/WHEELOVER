import { useState } from 'react';
import { useSupersededBuild } from '../hooks/useSupersededBuild';
import { shortCommit } from '../lib/buildWatch';

/**
 * A quiet notice that the deployment has moved on from the code this tab is
 * running. It offers the reload rather than taking it: a reload mid-passage
 * drops the AIS socket and the map view, so the person at the helm decides when.
 */
export function BuildBanner() {
  const superseded = useSupersededBuild();
  const [dismissed, setDismissed] = useState(false);

  if (!superseded || dismissed) return null;

  return (
    <div className="build-banner" role="status" aria-live="polite" data-testid="build-banner">
      <p className="build-banner-text">
        New version deployed.
        <span className="build-banner-builds">
          {shortCommit(superseded.running)} → {shortCommit(superseded.served)}
        </span>
      </p>
      <button type="button" className="build-banner-reload" onClick={() => window.location.reload()}>
        Reload
      </button>
      <button
        type="button"
        className="build-banner-dismiss"
        aria-label="Dismiss the update notice"
        onClick={() => setDismissed(true)}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path d="M7 7 L17 17 M17 7 L7 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
