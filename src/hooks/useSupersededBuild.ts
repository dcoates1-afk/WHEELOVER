import { useEffect, useState } from 'react';
import { RUNNING_COMMIT } from '../lib/buildInfo';
import { isSupersededBuild, servedCommit } from '../lib/buildWatch';

export interface SupersededBuild {
  /** The commit this tab is running. */
  running: string;
  /** The commit the deployment now answers with. */
  served: string;
}

/** Five minutes is soon enough to catch a deploy during one watch, and cheap. */
const POLL_INTERVAL_MS = 5 * 60 * 1000;
/**
 * A tablet left on the chart comes back to the foreground often. The poll is
 * small, but there is no reason to repeat it each time a hand crosses the screen.
 */
const MIN_GAP_MS = 30 * 1000;

const BUILD_INFO_URL = `${import.meta.env.BASE_URL}build-info.json`;

/**
 * Watches for a deploy landing under a tab that is already open.
 *
 * Nothing is polled in development, where there is no build to compare against,
 * and a failed check is simply retried on the next tick: a boat out of range is
 * the normal case, not an error.
 */
export function useSupersededBuild(): SupersededBuild | null {
  const [superseded, setSuperseded] = useState<SupersededBuild | null>(null);

  useEffect(() => {
    if (!RUNNING_COMMIT || import.meta.env.DEV) return;
    let cancelled = false;
    let found = false;
    let lastCheck = 0;
    const controller = new AbortController();

    const check = async (): Promise<void> => {
      if (cancelled || found) return;
      lastCheck = Date.now();
      try {
        const reply = await fetch(BUILD_INFO_URL, {
          cache: 'no-store',
          headers: { accept: 'application/json' },
          signal: controller.signal,
        });
        // A deploy in progress can answer 404 or 502; that is not news yet.
        if (!reply.ok) return;
        const served = servedCommit(await reply.json());
        if (cancelled || !served || !isSupersededBuild(RUNNING_COMMIT, served)) return;
        found = true;
        setSuperseded({ running: RUNNING_COMMIT, served });
      } catch {
        // Offline, aborted, or not JSON. The next tick tries again.
      }
    };

    void check();
    const timer = window.setInterval(() => void check(), POLL_INTERVAL_MS);
    const onVisibilityChange = (): void => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastCheck < MIN_GAP_MS) return;
      void check();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  return superseded;
}
