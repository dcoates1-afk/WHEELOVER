export interface RetryPlan {
  delayMs: number;
  message: string;
  exhausted: boolean;
}

export const AIS_RETRY_LIMIT = 6;
export const AIS_NORMAL_BACKOFF_BASE_MS = 5_000;
export const AIS_NORMAL_BACKOFF_MAX_MS = 60_000;
export const AIS_RATE_LIMIT_BASE_MS = 5 * 60_000;
export const AIS_RATE_LIMIT_MAX_MS = 60 * 60_000;

/**
 * Treat HTTP 429 differently from transport failures: AISStream has explicitly
 * asked the relay to slow down, so give it minutes rather than reconnecting in
 * a few seconds. The random spread prevents synchronized reconnect bursts.
 */
export function planAisRetry(
  attempt: number,
  rateLimited: boolean,
  random = Math.random(),
): RetryPlan {
  if (attempt > AIS_RETRY_LIMIT) {
    return { delayMs: 0, message: 'AISStream unavailable — showing simulated traffic', exhausted: true };
  }

  const base = rateLimited ? AIS_RATE_LIMIT_BASE_MS : AIS_NORMAL_BACKOFF_BASE_MS;
  const maximum = rateLimited ? AIS_RATE_LIMIT_MAX_MS : AIS_NORMAL_BACKOFF_MAX_MS;
  const delayMs = Math.min(maximum, base * 2 ** Math.max(0, attempt - 1)) + Math.floor(Math.max(0, Math.min(0.999999, random)) * 5_000);
  const seconds = Math.round(delayMs / 1000);
  const message = rateLimited
    ? `AISStream rate limited this connection — retry ${attempt} in ${seconds >= 60 ? `${Math.round(seconds / 60)} min` : `${seconds} s`}`
    : `AISStream connection dropped — retry ${attempt} in ${seconds} s`;

  return { delayMs, message, exhausted: false };
}
