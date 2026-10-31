import { useEffect, useRef, useState } from 'react';
import type { ChartAlert } from '../lib/alerts';

interface ChartAlertsProps {
  alerts: ChartAlert[];
  sound: boolean;
  vibration: boolean;
  hidden?: boolean;
}

/** A short two-tone chime; the AudioContext is created per alert and closed. */
function chime(danger: boolean): void {
  try {
    const Ctor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const context = new Ctor();
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + (danger ? 0.5 : 0.35));
    gain.connect(context.destination);
    const tones = danger ? [880, 660] : [740];
    tones.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      oscillator.connect(gain);
      const start = context.currentTime + index * 0.18;
      oscillator.start(start);
      oscillator.stop(start + 0.16);
    });
    window.setTimeout(() => void context.close().catch(() => {}), 900);
  } catch {
    // Audio is a courtesy: a blocked context must not interrupt the alert.
  }
}

function AlertIcon({ kind }: { kind: ChartAlert['kind'] }) {
  if (kind === 'shallow') {
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path d="M12 3.4 21.2 20H2.8Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        <path d="M12 9v5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
        <circle cx="12" cy="17" r="1" fill="currentColor" />
      </svg>
    );
  }
  if (kind === 'anchor') {
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <circle cx="12" cy="4.6" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.7" />
        <path d="M12 6.6v13" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M7.6 9.8h8.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M4.4 13.2c0 4 3.4 6.4 7.6 6.4s7.6-2.4 7.6-6.4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M4.4 13.2 2.6 15.6M4.4 13.2l2.4 1M19.6 13.2l1.8 2.4M19.6 13.2l-2.4 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'course') {
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M12 1.8v3M12 19.2v3M1.8 12h3M19.2 12h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M12 5.8 15 15l-9.2-3Z" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        d="M3 14.5h18l-2.6 4H5.6Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M8 14.5V8h8v6.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M12 4v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/**
 * On-chart alert stack. It sits clear of the map controls in the bottom-left
 * corner and is dismissed per condition, not per update.
 */
export function ChartAlerts({ alerts, sound, vibration, hidden = false }: ChartAlertsProps) {
  const [dismissed, setDismissed] = useState<string[]>([]);
  const announced = useRef(new Set<string>());

  useEffect(() => {
    const live = new Set(alerts.map((alert) => alert.id));
    setDismissed((previous) => {
      const next = previous.filter((id) => live.has(id));
      return next.length === previous.length ? previous : next;
    });
  }, [alerts]);

  useEffect(() => {
    const fresh = alerts.filter((alert) => !announced.current.has(alert.id));
    if (fresh.length === 0) return;
    for (const alert of fresh) announced.current.add(alert.id);
    if (sound) chime(fresh.some((alert) => alert.level === 'danger'));
    if (vibration && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(fresh.some((alert) => alert.level === 'danger') ? [180, 90, 180] : 120);
    }
  }, [alerts, sound, vibration]);

  const visible = alerts.filter((alert) => !dismissed.includes(alert.id));
  if (hidden || visible.length === 0) return null;

  return (
    <div className="chart-alerts" data-testid="chart-alerts" aria-live="polite">
      {visible.map((alert) => (
        <article key={alert.id} className={`chart-alert ${alert.level}`} data-alert={alert.kind}>
          <span className="chart-alert-icon">
            <AlertIcon kind={alert.kind} />
          </span>
          <div className="chart-alert-text">
            <p className="chart-alert-title">{alert.title}</p>
            <p className="chart-alert-detail">{alert.detail}</p>
          </div>
          <button
            type="button"
            className="chart-alert-dismiss"
            aria-label={`Dismiss ${alert.title} alert`}
            onClick={() => setDismissed((previous) => [...previous, alert.id])}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path d="M7 7 L17 17 M17 7 L7 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </article>
      ))}
    </div>
  );
}
