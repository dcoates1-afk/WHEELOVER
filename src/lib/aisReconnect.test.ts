import { describe, expect, it } from 'vitest';
import {
  AIS_RATE_LIMIT_BASE_MS,
  AIS_RATE_LIMIT_MAX_MS,
  AIS_RETRY_LIMIT,
  planAisRetry,
} from '../../server/aisReconnect';

describe('AIS reconnect planning', () => {
  it('backs off for minutes on 429 and caps exponential growth at one hour', () => {
    expect(planAisRetry(1, true, 0).delayMs).toBe(AIS_RATE_LIMIT_BASE_MS);
    expect(planAisRetry(2, true, 0).delayMs).toBe(AIS_RATE_LIMIT_BASE_MS * 2);
    expect(planAisRetry(5, true, 0).delayMs).toBe(AIS_RATE_LIMIT_MAX_MS);
    expect(planAisRetry(1, true, 0.5).delayMs).toBe(AIS_RATE_LIMIT_BASE_MS + 2_500);
  });

  it('returns to normal short backoff for transport failures', () => {
    expect(planAisRetry(1, false, 0).delayMs).toBe(5_000);
    expect(planAisRetry(2, false, 0).delayMs).toBe(10_000);
    expect(planAisRetry(6, false, 0).delayMs).toBe(60_000);
  });

  it('exhausts after the configured retries', () => {
    expect(planAisRetry(AIS_RETRY_LIMIT, true, 0).exhausted).toBe(false);
    expect(planAisRetry(AIS_RETRY_LIMIT + 1, true, 0).exhausted).toBe(true);
  });
});
