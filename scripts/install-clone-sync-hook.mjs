#!/usr/bin/env node
/**
 * Installs the pre-push hook that keeps the desktop clone honest.
 *
 * The hook compares the clone with the workspace through check-clone-sync.mjs and
 * stops the push when a file is missing or stale, so a workspace-only module
 * cannot reach GitHub and fail Render's type check. Hooks live in .git/hooks and
 * are not part of the repository, so this installer writes it and records which
 * workspace the clone belongs to — the path changes with every Freebuff worktree.
 *
 * Usage (run inside the clone):
 *   node scripts/install-clone-sync-hook.mjs --source <workspace>
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ownRepo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = '.git/clone-sync.json';
const HOOK = '.git/hooks/pre-push';

const HOOK_SOURCE = `#!/bin/sh
# Installed by scripts/install-clone-sync-hook.mjs — refuses to push a clone that
# has drifted from the workspace it is built from.
set -eu
root=$(git rev-parse --show-toplevel)
workspace=\${WHEELOVER_WORKSPACE:-}
if [ -z "$workspace" ] && [ -f "$root/${CONFIG}" ]; then
  workspace=$(node -e 'const fs = require("node:fs"); process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).workspace)' "$root/${CONFIG}")
fi
if [ -z "$workspace" ] || [ ! -d "$workspace" ]; then
  echo "pre-push: no workspace to check against." >&2
  echo "pre-push: run 'npm run sync:hook -- --source <workspace>' in the clone." >&2
  exit 1
fi
exec node "$root/scripts/check-clone-sync.mjs" --source "$workspace" --target "$root"
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
        + '  --source <dir>  workspace the clone is built from\n'
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

let source = args.source;
if (!source && existsSync(resolve(root, CONFIG))) {
  try {
    source = JSON.parse(await readFile(resolve(root, CONFIG), 'utf8')).workspace ?? null;
  } catch {
    source = null;
  }
}
if (!source && ownRepo !== root) source = ownRepo;
if (!source) usageProblem('no workspace given; pass --source <dir>');
if (!existsSync(resolve(source, 'scripts/check-clone-sync.mjs'))) {
  usageProblem(`${source} has no scripts/check-clone-sync.mjs to run`);
}

await writeFile(resolve(root, CONFIG), `${JSON.stringify({ workspace: source }, null, 2)}\n`);
await writeFile(resolve(root, HOOK), HOOK_SOURCE);
await chmod(resolve(root, HOOK), 0o755);

console.log(`installed ${resolve(root, HOOK)}`);
console.log(`  clone:     ${root}`);
console.log(`  workspace: ${source}`);
console.log('A push is refused while the clone is missing a file or holds an older copy.');
