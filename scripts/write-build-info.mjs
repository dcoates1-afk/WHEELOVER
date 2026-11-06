#!/usr/bin/env node
/**
 * Write dist/build-info.json so a deployment can name the commit it is running.
 *
 * The post-deploy job in .github/workflows/deploy-render.yml polls
 * /build-info.json and waits for `commit` to equal the pushed SHA. A 200 from
 * the site only proves *something* is answering; this file is what proves the
 * build that push triggered is the one actually serving.
 *
 * The commit comes from Render's RENDER_GIT_COMMIT when the build runs there,
 * and from local git otherwise. `npm run build` runs this after `vite build`,
 * because the Vite build empties dist/.
 *
 *   node scripts/write-build-info.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = resolve(root, 'dist');

function git(args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

const fromRender = Boolean(process.env.RENDER_GIT_COMMIT);
const commit = process.env.RENDER_GIT_COMMIT || process.env.GITHUB_SHA || git(['rev-parse', 'HEAD']);
const branch =
  process.env.RENDER_GIT_BRANCH || process.env.GITHUB_REF_NAME || git(['rev-parse', '--abbrev-ref', 'HEAD']) || null;

if (!commit) {
  throw new Error('cannot determine the commit being built (no RENDER_GIT_COMMIT, GITHUB_SHA or git checkout)');
}

const info = {
  commit,
  branch,
  builtAt: new Date().toISOString(),
  source: fromRender ? 'render' : process.env.GITHUB_SHA ? 'github' : 'git',
};

await mkdir(distDir, { recursive: true });
await writeFile(resolve(distDir, 'build-info.json'), `${JSON.stringify(info, null, 2)}\n`, 'utf8');

console.log(`[build-info] ${commit.slice(0, 7)} (${branch ?? 'detached'}) -> dist/build-info.json`);
