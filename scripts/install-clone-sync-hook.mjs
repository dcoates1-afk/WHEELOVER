#!/usr/bin/env node
/**
 * Installs the pre-push hook that keeps the desktop clone honest.
 *
 * The hook compares the clone with the workspace through check-clone-sync.mjs and
 * stops the push when a file is missing or stale, so a workspace-only module
 * cannot reach GitHub and fail Render's type check. The checker finds the
 * current Freebuff worktree on its own, so a new session needs no re-install;
 * `--source` pins one workspace if discovery would be ambiguous.
 *
 * Usage (run inside the clone):
 *   node scripts/install-clone-sync-hook.mjs [--source <workspace>]
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const CONFIG = '.git/clone-sync.json';
const HOOK = '.git/hooks/pre-push';

const HOOK_SOURCE = `#!/bin/sh
# Installed by scripts/install-clone-sync-hook.mjs — refuses to push a clone that
# has drifted from the Freebuff workspace it is built from. The checker finds the
# current workspace itself; WHEELOVER_WORKSPACE pins a specific one.
set -eu
root=$(git rev-parse --show-toplevel)
exec node "$root/scripts/check-clone-sync.mjs" --target "$root"
`;

function usageProblem(message) {
  console.error(`install-clone-sync-hook: ${message}`);
  process.exit(2);
}

function parseArgs(argv) {
  const args = { source: null, target: null };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--help' || flag === '-h') {
      console.log('Installs the pre-push sync check in the desktop clone.\n\n'
        + '  --source <dir>  pin one workspace instead of finding the current one\n'
        + '  --target <dir>  clone to install into (default: the current repository)\n');
      process.exit(0);
    }
    if (flag !== '--source' && flag !== '--target') usageProblem(`unknown argument "${flag}"`);
    const value = argv[index + 1];
    if (!value) usageProblem(`${flag} needs a directory`);
    args[flag.slice(2)] = resolve(value);
    index += 1;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const requested = args.target ?? process.cwd();

let root;
try {
  root = execFileSync('git', ['-C', requested, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
} catch {
  usageProblem(`${requested} is not a git checkout`);
}

if (!existsSync(resolve(root, 'scripts/check-clone-sync.mjs'))) {
  usageProblem(`${root} has no scripts/check-clone-sync.mjs to run`);
}

if (args.source) {
  if (!existsSync(resolve(args.source, 'scripts/check-clone-sync.mjs'))) {
    usageProblem(`${args.source} is not a checkout of this project`);
  }
  if (resolve(args.source) === resolve(root)) {
    usageProblem('that is this clone; pin the workspace it is built from');
  }
  await writeFile(resolve(root, CONFIG), `${JSON.stringify({ workspace: args.source }, null, 2)}\n`);
} else if (existsSync(resolve(root, CONFIG))) {
  // Discovery is the default now; a pin from an older session would only get in
  // the way when that workspace disappears.
  await rm(resolve(root, CONFIG));
}

await writeFile(resolve(root, HOOK), HOOK_SOURCE);
await chmod(resolve(root, HOOK), 0o755);

console.log(`installed ${resolve(root, HOOK)}`);
console.log(`  clone:     ${root}`);
console.log(`  workspace: ${args.source ? `${args.source} (pinned)` : 'found automatically at push time'}`);
console.log('A push is refused while the clone is missing a file or holds an older copy.');
