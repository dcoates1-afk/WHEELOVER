import { describe, expect, it } from 'vitest';
import { isSupersededBuild, servedCommit, shortCommit } from './buildWatch';

const RUNNING = 'e66672e1a2b3c4d5e6f708091011121314151617';
const NEXT = 'b5d5f0d1a2b3c4d5e6f708091011121314151617';

describe('servedCommit', () => {
  it('reads the commit a deployment publishes', () => {
    expect(servedCommit({ commit: NEXT, branch: 'main', builtAt: '2026-11-06T12:52:00Z' })).toBe(NEXT);
  });

  it('accepts the abbreviations the build script might publish', () => {
    expect(servedCommit({ commit: 'b5d5f0d' })).toBe('b5d5f0d');
  });

  it('rejects a reply that names no usable commit', () => {
    expect(servedCommit({ builtAt: '2026-11-06T12:52:00Z' })).toBeNull();
    expect(servedCommit({ commit: 42 })).toBeNull();
    expect(servedCommit({ commit: '  ' })).toBeNull();
    expect(servedCommit({ commit: 'not-a-commit' })).toBeNull();
    expect(servedCommit(null)).toBeNull();
    expect(servedCommit('<html>502 Bad Gateway</html>')).toBeNull();
  });
});

describe('isSupersededBuild', () => {
  it('is true once the deployment has moved to another commit', () => {
    expect(isSupersededBuild(RUNNING, NEXT)).toBe(true);
  });

  it('is false for the same commit, however it is written', () => {
    expect(isSupersededBuild(RUNNING, RUNNING)).toBe(false);
    expect(isSupersededBuild(RUNNING, ` ${RUNNING.toUpperCase()} `)).toBe(false);
  });

  it('stays quiet when either side is unknown', () => {
    expect(isSupersededBuild('', NEXT)).toBe(false);
    expect(isSupersededBuild(RUNNING, null)).toBe(false);
    expect(isSupersededBuild(null, null)).toBe(false);
    expect(isSupersededBuild(RUNNING, 'stale')).toBe(false);
  });
});

describe('shortCommit', () => {
  it('matches the abbreviation the build log prints', () => {
    expect(shortCommit(RUNNING)).toBe('e66672e');
  });
});
