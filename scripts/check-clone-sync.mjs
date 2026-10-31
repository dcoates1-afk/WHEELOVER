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
 * `--fix` copies the missing and stale files across, then checks again, so the
 * hook can be answered with one command instead of a manual copy.
 *
 * Usage:
 *   node scripts/check-clone-sync.mjs [--source <workspace>] [--target <clone>] [--fix]
 *
 * The workspace is discovered when it is not given: the path recorded by the
 * hook, then the most recently edited Freebuff worktree holding this project,
 * then the checkout the script lives in. A Freebuff worktree path changes every
 * session, so discovery is what keeps the hook working without a re-install.
 *
 * Defaults: the workspace found above, and $WHEELOVER_CLONE or
 * ~/Documents/WHEELOVER.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, stat } from 'node:fs/promises';
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
/** Where Freebuff keeps one checkout per thread: <root>/<thread>/<hash>. */
const WORKTREES_ROOT = process.env.WHEELOVER_WORKTREES ?? resolve(homedir(), '.freebuff', 'worktrees');
const CONFIG = '.git/clone-sync.json';
const SKIP_SUFFIXES = ['.patch', '.diff', '.bundle', '.pid', '.log', '.tmp'];
/** How many paths to name per finding before summarising the rest. */
const LIST_LIMIT = 25;
/** Files are read in small batches so a 400 MB archive does not serialise. */
const BATCH = 24;

const HELP = `Compares a workspace checkout with the desktop clone, file by file.

  --source <dir>  workspace to read (default: found automatically)
  --target <dir>  clone to compare (default: $WHEELOVER_CLONE or ~/Documents/WHEELOVER)
  --fix           copy missing and stale files into the clone, then check again
  --help          show this message

Without --source the workspace is taken from $WHEELOVER_WORKSPACE, then the path
the hook recorded, then the most recently edited Freebuff worktree of this
project. Exits 0 when the clone holds every file with the same content, 1 when a
file is missing from the clone or differs, and 2 when no workspace can be found
or the arguments are unusable.`;

function usageProblem(message) {
  console.error(`check-clone-sync: ${message}`);
  console.error('Run with --help for usage.');
  process.exit(2);
}

function parseArgs(argv) {
  const args = { source: null, target: null, fix: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--help' || flag === '-h') {
      console.log(HELP);
      process.exit(0);
    }
    if (flag === '--fix') {
      args.fix = true;
      continue;
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

/** A checkout of this project: the script that is running is its marker. */
function isWorkspace(directory) {
  return existsSync(resolve(directory, 'scripts', 'check-clone-sync.mjs'));
}

/** Newest edit under the directories a session actually works in. */
async function newestEdit(directory) {
  let newest = 0;
  async function walk(relative) {
    let entries;
    try {
      entries = await readdir(resolve(directory, relative), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(path);
        continue;
      }
      try {
        const info = await stat(resolve(directory, path));
        if (info.mtimeMs > newest) newest = info.mtimeMs;
      } catch {
        // A file removed mid-walk cannot be the newest edit.
      }
    }
  }
  for (const root of ['src', 'shared', 'server', 'scripts']) await walk(root);
  return newest;
}

/** Freebuff checkouts of this project, most recently edited first. */
async function freebuffWorkspaces() {
  let threads;
  try {
    threads = await readdir(WORKTREES_ROOT, { withFileTypes: true });
  } catch {
    return []; // No Freebuff worktrees on this machine.
  }
  const found = [];
  for (const thread of threads) {
    if (!thread.isDirectory()) continue;
    let checkouts;
    try {
      checkouts = await readdir(resolve(WORKTREES_ROOT, thread.name), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const checkout of checkouts) {
      if (!checkout.isDirectory()) continue;
      const directory = resolve(WORKTREES_ROOT, thread.name, checkout.name);
      if (!isWorkspace(directory) || directory === target) continue;
      found.push({ directory, edited: await newestEdit(directory) });
    }
  }
  return found.sort((left, right) => right.edited - left.edited).map((entry) => entry.directory);
}

/** The workspace a previous install pinned, if it still exists. */
async function recordedWorkspace() {
  try {
    const config = JSON.parse(await readFile(resolve(target, CONFIG), 'utf8'));
    return config.workspace ? resolve(config.workspace) : null;
  } catch {
    return null;
  }
}

const args = parseArgs(process.argv.slice(2));
const target = args.target ?? process.env.WHEELOVER_CLONE ?? resolve(homedir(), 'Documents', 'WHEELOVER');

let source = null;
let sourceNote = 'set with --source';
if (args.source) {
  source = args.source;
} else if (process.env.WHEELOVER_WORKSPACE) {
  if (!isWorkspace(process.env.WHEELOVER_WORKSPACE)) {
    usageProblem(`WHEELOVER_WORKSPACE points at ${process.env.WHEELOVER_WORKSPACE}, which is not a checkout of this project`);
  }
  source = resolve(process.env.WHEELOVER_WORKSPACE);
  sourceNote = 'set by WHEELOVER_WORKSPACE';
}

if (!source) {
  const recorded = await recordedWorkspace();
  if (recorded && recorded !== target && isWorkspace(recorded)) {
    source = recorded;
    sourceNote = 'the workspace recorded when the hook was installed';
  }
}

if (!source) {
  // A path that no longer exists is normal: Freebuff makes a new worktree per
  // session, so look for the one that was worked in most recently.
  const found = await freebuffWorkspaces();
  if (found.length) {
    [source] = found;
    sourceNote = found.length === 1
      ? 'the only Freebuff worktree of this project'
      : `the most recently edited of ${found.length} Freebuff worktrees`;
  }
}

if (!source && ownRepo !== target && isWorkspace(ownRepo)) {
  source = ownRepo;
  sourceNote = 'the checkout holding this script';
}

if (!source) {
  usageProblem(`no workspace of this project found under ${WORKTREES_ROOT}: pass --source <dir>, or set WHEELOVER_WORKSPACE`);
}
if (source === target) usageProblem('source and target are the same directory');

/** Compares both trees; paths are relative and use forward slashes. */
async function compareTrees() {
  // A file deleted in the workspace but not yet `git rm`-ed still sits in its
  // index. Counting it as present made the clone's copy invisible here, so a
  // deleted module could ride along for ever; only files on disk count.
  const sourceFiles = gitFiles(source).filter((pathname) => isCompared(pathname) && existsSync(resolve(source, pathname)));
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
  return { compared, missing: missing.sort(), differing: differing.sort(), onlyInClone };
}

/**
 * Copies the missing and stale files from the workspace into the clone. Files
 * that exist only in the clone are left alone: removing one from the repository
 * is the pusher's decision, not a sync script's.
 */
async function copyIntoClone(paths) {
  const copied = [];
  for (const pathname of paths) {
    const from = resolve(source, pathname);
    if (!existsSync(from)) continue; // Deleted in the workspace; nothing to copy.
    const to = resolve(target, pathname);
    await mkdir(dirname(to), { recursive: true });
    await copyFile(from, to);
    copied.push(pathname);
  }
  return copied;
}

let result = await compareTrees();
let copied = [];
if (args.fix && (result.missing.length || result.differing.length)) {
  copied = await copyIntoClone([...result.missing, ...result.differing].sort());
  result = await compareTrees();
}

const { compared, missing, differing, onlyInClone } = result;

// One stream, in reading order: a hook's stdout and stderr can reach the
// terminal out of order, and the exit code already carries the result.
console.log(`check-clone-sync: ${source}`);
console.log(`             against ${target}`);
console.log(`                from ${sourceNote}`);
console.log(`              ${compared} ${compared === 1 ? 'file matches' : 'files match'}`);

if (copied.length) {
  console.log(`\nCopied ${copied.length} ${copied.length === 1 ? 'file' : 'files'} into the clone:\n${describe(copied)}`);
  console.log('They are copied, not staged: commit them before pushing, or the push carries the old version.');
}

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
  const hints = [];
  if (missing.length || differing.length) {
    hints.push(`${args.fix ? 'Some files could not be copied; check them by hand.' : '`npm run sync:check -- --fix` copies them across.'}`);
  }
  if (onlyInClone.length) {
    const command = `git -C "${target}" rm ${onlyInClone.map((pathname) => `"${pathname}"`).join(' ')}`;
    hints.push(`files the workspace no longer has are removed by hand (commit any edits they carry first):\n  ${command}`);
  }
  console.log(`\nRefusing to push: ${hints.join(' ')}`);
  process.exit(1);
}
console.log(copied.length ? '\nPASS the clone matches the workspace now.' : '\nPASS the clone matches the workspace.');
