/**
 * The checker is a CLI, not a module, so these tests drive it the way git does:
 * as a subprocess, against two throwaway git checkouts in a temp directory.
 *
 * The cases are the ones that decide whether a push is safe — a clean pair, a
 * file the clone lacks, a stale copy, a file the workspace deleted, and line
 * endings that must not be mistaken for a difference.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), 'check-clone-sync.mjs');

/** Temp checkouts are removed even when an assertion fails mid-test. */
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(directory, ...args) {
  const result = spawnSync('git', ['-C', directory, ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
}

/**
 * A workspace and a clone, each its own repository. Writes are added to the
 * index so the checker sees them as tracked, exactly as a real checkout would.
 */
function pair() {
  const root = mkdtempSync(join(tmpdir(), 'clone-sync-'));
  roots.push(root);
  const source = join(root, 'workspace');
  const target = join(root, 'clone');
  for (const directory of [source, target]) {
    mkdirSync(directory, { recursive: true });
    git(directory, 'init', '-q');
  }
  return {
    source,
    target,
    /** Write a file and stage it in one checkout. */
    write(directory, path, content) {
      const file = join(directory, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content);
      git(directory, 'add', '--', path);
    },
    /** Delete from the working tree only, leaving the index entry behind. */
    dropFromDisk(directory, path) {
      unlinkSync(join(directory, path));
    },
    run(...extra) {
      const result = spawnSync(
        process.execPath,
        [SCRIPT, '--source', source, '--target', target, ...extra],
        { encoding: 'utf8' },
      );
      return { status: result.status, output: `${result.stdout}${result.stderr}` };
    },
  };
}

describe('check-clone-sync', () => {
  it('passes when both trees hold the same files', () => {
    const checkouts = pair();
    for (const directory of [checkouts.source, checkouts.target]) {
      checkouts.write(directory, 'src/chart.ts', 'export const scale = 1;\n');
    }

    const { status, output } = checkouts.run();

    expect(status).toBe(0);
    expect(output).toContain('1 file matches');
    expect(output).toContain('PASS');
  });

  it('refuses a push while the clone is missing a file', () => {
    const checkouts = pair();
    checkouts.write(checkouts.source, 'src/sheets/VesselSheet.tsx', 'export const sheet = 1;\n');

    const { status, output } = checkouts.run();

    expect(status).toBe(1);
    expect(output).toContain('1 file is missing from the clone');
    expect(output).toContain('src/sheets/VesselSheet.tsx');
    expect(output).toContain('Refusing to push');
  });

  it('reports a stale copy, then copies it across with --fix', () => {
    const checkouts = pair();
    checkouts.write(checkouts.source, 'src/app.tsx', 'export const version = 2;\n');
    checkouts.write(checkouts.target, 'src/app.tsx', 'export const version = 1;\n');

    const blocked = checkouts.run();
    expect(blocked.status).toBe(1);
    expect(blocked.output).toContain('1 file differs');
    expect(blocked.output).toContain('src/app.tsx');

    const fixed = checkouts.run('--fix');
    expect(fixed.status).toBe(0);
    expect(fixed.output).toContain('Copied 1 file into the clone');
    expect(fixed.output).toContain('PASS');
    expect(readFileSync(join(checkouts.target, 'src/app.tsx'), 'utf8')).toBe('export const version = 2;\n');
  });

  it('reports a file the workspace deleted even though its index still lists it', () => {
    const checkouts = pair();
    for (const directory of [checkouts.source, checkouts.target]) {
      checkouts.write(directory, 'src/lib/retired.ts', 'export const retired = true;\n');
    }
    // The workspace deletes the file but has not run `git rm` yet, so
    // `git ls-files` still names it. The clone's copy must not go unreported.
    checkouts.dropFromDisk(checkouts.source, 'src/lib/retired.ts');

    const { status, output } = checkouts.run();

    expect(status).toBe(1);
    expect(output).toContain('1 file is in the clone but not in the workspace');
    expect(output).toContain('src/lib/retired.ts');
    expect(output).toContain('git -C');
    expect(output).toContain('rm');
  });

  it('does not treat a CRLF checkout and an LF checkout as different files', () => {
    const checkouts = pair();
    checkouts.write(checkouts.source, 'src/lib/settings.ts', 'const a = 1;\nconst b = 2;\n');
    checkouts.write(checkouts.target, 'src/lib/settings.ts', 'const a = 1;\r\nconst b = 2;\r\n');

    const { status, output } = checkouts.run();

    expect(status).toBe(0);
    expect(output).toContain('PASS');
  });
});
