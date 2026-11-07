import { describe, expect, it } from 'vitest';
import { WEEK_MS, manifestNeedsCheck } from './navaidDb';

const now = 1_800_000_000_000;

describe('navaid manifest refresh', () => {
  it('rereads the manifest when the deployment names a new commit', () => {
    expect(
      manifestNeedsCheck({ checkedAt: now - 60_000, storedDeploy: 'aaaaaaa', servedDeploy: 'bbbbbbb', now }),
    ).toBe(true);
  });

  it('leaves a stored copy alone when the deployment has not moved', () => {
    expect(
      manifestNeedsCheck({ checkedAt: now - 60_000, storedDeploy: 'aaaaaaa', servedDeploy: 'aaaaaaa', now }),
    ).toBe(false);
  });

  it('falls back to the weekly check when no deployment stamp is readable', () => {
    expect(
      manifestNeedsCheck({ checkedAt: now - 60_000, storedDeploy: 'aaaaaaa', servedDeploy: null, now }),
    ).toBe(false);
    expect(
      manifestNeedsCheck({ checkedAt: now - WEEK_MS, storedDeploy: 'aaaaaaa', servedDeploy: null, now }),
    ).toBe(true);
  });

  it('rereads the manifest on a first visit, with or without a stamp', () => {
    expect(manifestNeedsCheck({ checkedAt: null, storedDeploy: null, servedDeploy: 'bbbbbbb', now })).toBe(true);
    expect(manifestNeedsCheck({ checkedAt: null, storedDeploy: null, servedDeploy: null, now })).toBe(true);
  });
});
