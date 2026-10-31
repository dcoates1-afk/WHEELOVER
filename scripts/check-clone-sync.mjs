#!/usr/bin/env node
/**
 * Compares this checkout with the desktop clone, file by file, so the clone is
 * never pushed with a file the workspace already has.
 *
 * `git status` only names files git already tracks, so a new module can sit
 * untracked in the workspace, never reach the clone, and only fail on Render's
 * `tsc --noEmit` — which is exactly how TrackingPanel.tsx went missing. This
 * walks both trees with `git ls-files --cached --others --exclude-standard`,
 * which picks up untracked files while leaving ignored ones alone.
 *
 * Line endings are folded before comparing: the two checkouts disagree on CRLF
 * for many files, and that must never block a push.
 *
 * Usage:
 *   node scripts/check-clone-sync.mjs [--source <workspace>] [--target <clone>]
 *
 * Defaults: the repository holding this script, and $WHEELOVER_CLONE or
 * ~/Documents/WHEELOVER.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ownRepo = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Directories that ship with the app. Anything else is scratch. */
const APP_DIRS = ['src', 'shared', 'server', 'scripts', 'public'];
const ROOT_FILES = new Set([
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'vite.config.ts',
  'index.html',
  'README.md',
  'render.yaml',
  '.gitignore',
]);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'backup', 'artifacts', 'data-raw']);
const SKIP_SUFFIXES = ['.patch', '.diff', '.bundle', '.pid', '.log', '.tmp'];
/** How many paths to name per finding before summarising the rest. */
const LIST_LIMIT = 25;
/** Files are read in small batches so a 400 MB archive does not serialise. */
const BATCH = 24;

const HELP = `Compares a workspace checkout with the desktop clone, file by file.

  --source <dir>  workspace to read (default: the repository holding this script)
  --target <dir>  clone to compare (default: $WHEELOVER_CLONE or ~/Documents/WHEELOVER)
  --help          show this message

Exits 0 when the clone holds every file with the same content, 1 when a file is
missing from the clone or differs, and 2 when the arguments are unusable.`;

function usageProblem(message) {
  console.error(`check-clone-sync: ${message}`);
  console.error('Run with --help for usage.');
  process.exit(2);
}

function parseArgs(argv) {
  const args = { source: null, target: null };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--help' || flag === '-h') {
      console.log(HELP);
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

/** Every file git would carry: tracked, plus untracked ones it does not ignore. */
function gitFiles(directory, { cachedOnly = false } = {}) {
  try {
    const listing = execFileSync(
      'git',
      ['-C', directory, 'ls-files', '-z', '--cached', ...(cachedOnly ? [] : ['--others', '--exclude-standard'])],
      { maxBuffer: 128 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return listing.toString('utf8').split('\0').filter(Boolean);
  } catch (error) {
    if (error?.status === 128 || error?.stderr?.toString().includes('not a git repository')) {
      usageProblem(`${directory} is not a git checkout`);
    }
    throw error;
  }
}

function isCompared(pathname) {
  if (SKIP_SUFFIXES.some((suffix) => pathname.toLowerCase().endsWith(suffix))) return false;
  const segments = pathname.split('/');
  if (segments.some((segment) => SKIP_DIRS.has(segment) || segment.toLowerCase().endsWith('.tmp'))) return false;
  if (segments.length === 1) return ROOT_FILES.has(pathname);
  return APP_DIRS.includes(segments[0]);
}

/**
 * True when both files hold the same text. A CRLF checkout and an LF checkout of
 * the same file differ in size, so the folded text decides those cases; binary
 * files are never folded.
 */
async function sameContent(leftPath, rightPath) {
  const [left, right] = await Promise.all([readFile(leftPath), readFile(rightPath)]);
  if (left.equals(right)) return true;
  if (left.includes(0) || right.includes(0)) return false;
  return left.toString('utf8').replace(/\r\n/g, '\n') === right.toString('utf8').replace(/\r\n/g, '\n');
}

function chunks(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function describe(paths) {
  const shown = paths.slice(0, LIST_LIMIT).map((pathname) => `  ${pathname}`);
  if (paths.length > LIST_LIMIT) shown.push(`  … and ${paths.length - LIST_LIMIT} more`);
  return shown.join('\n');
}

const args = parseArgs(process.argv.slice(2));
let source = args.source ?? ownRepo;
const target = args.target ?? process.env.WHEELOVER_CLONE ?? resolve(homedir(), 'Documents', 'WHEELOVER');

// Run from inside the clone with no arguments: check the workspace the hook was
// installed for instead of comparing the clone with itself.
if (!args.source && resolve(source) === resolve(target) && existsSync(resolve(target, '.git/clone-sync.json'))) {
  try {
    source = resolve(JSON.parse(await readFile(resolve(target, '.git/clone-sync.json'), 'utf8')).workspace);
  } catch {
    // A damaged config just leaves the default in place, which is reported below.
  }
}

if (source === target) usageProblem('source and target are the same directory');

const sourceFiles = gitFiles(source).filter(isCompared);
const sourceSet = new Set(sourceFiles);
const targetFiles = new Set(gitFiles(target).filter(isCompared));
const targetTracked = new Set(gitFiles(target, { cachedOnly: true }).filter(isCompared));

const missing = [];
const differing = [];
let compared = 0;

for (const batch of chunks(sourceFiles, BATCH)) {
  await Promise.all(batch.map(async (pathname) => {
    if (!targetFiles.has(pathname)) {
      missing.push(pathname);
      return;
    }
    try {
      if (await sameContent(resolve(source, pathname), resolve(target, pathname))) compared += 1;
      else differing.push(pathname);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      // A file git still tracks but the workspace has deleted cannot be copied;
      // one deleted from the clone is a difference that would be pushed.
      if (existsSync(resolve(source, pathname))) differing.push(pathname);
    }
  }));
}

const onlyInClone = [...targetTracked].filter((pathname) => !sourceSet.has(pathname)).sort();
missing.sort();
differing.sort();

// One stream, in reading order: a hook's stdout and stderr can reach the
// terminal out of order, and the exit code already carries the result.
console.log(`check-clone-sync: ${source}`);
console.log(`             against ${target}`);
console.log(`              ${compared} files match`);

let problems = 0;
if (missing.length) {
  problems += missing.length;
  console.log(`\nFAIL ${missing.length} ${missing.length === 1 ? 'file is' : 'files are'} missing from the clone:\n${describe(missing)}`);
}
if (differing.length) {
  problems += differing.length;
  console.log(`\nFAIL ${differing.length} ${differing.length === 1 ? 'file differs' : 'files differ'}:\n${describe(differing)}`);
}
if (onlyInClone.length) {
  problems += onlyInClone.length;
  console.log(`\nFAIL ${onlyInClone.length} ${onlyInClone.length === 1 ? 'file is' : 'files are'} in the clone but not in the workspace:\n${describe(onlyInClone)}`);
}

if (problems) {
  console.log('\nRefusing to push: copy the files across, or delete the stale ones, then try again.');
  process.exit(1);
}
console.log('\nPASS the clone matches the workspace.');
