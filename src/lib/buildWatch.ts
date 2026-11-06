/**
 * Comparing the running bundle against the deployment that answers it.
 *
 * The commit is the thing worth comparing: a rebuild of the same commit ships
 * the same JavaScript, so it is not worth interrupting anyone over, while a
 * different commit means the code on screen has been superseded.
 */

const COMMIT_PATTERN = /^[0-9a-f]{7,40}$/;

/** The commit a `/build-info.json` reply names, or null when it names none. */
export function servedCommit(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const commit = (body as { commit?: unknown }).commit;
  if (typeof commit !== 'string') return null;
  const trimmed = commit.trim().toLowerCase();
  return COMMIT_PATTERN.test(trimmed) ? trimmed : null;
}

/**
 * Whether the running code is older than the deployment answering it.
 *
 * Answers false whenever either side is unknown. A check that failed, a deploy
 * mid-flight or a reply mangled by a proxy is not news, and a chart in use must
 * not sprout a banner over a doubt.
 */
export function isSupersededBuild(running: unknown, served: unknown): boolean {
  const mine = typeof running === 'string' ? running.trim().toLowerCase() : '';
  const theirs = typeof served === 'string' ? served.trim().toLowerCase() : '';
  if (!COMMIT_PATTERN.test(mine) || !COMMIT_PATTERN.test(theirs)) return false;
  return mine !== theirs;
}

/** Seven characters is the shorthand the build log and the banner both use. */
export function shortCommit(commit: string): string {
  return commit.trim().slice(0, 7);
}
