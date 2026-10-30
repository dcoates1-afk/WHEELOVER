import { basename } from 'node:path';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, readFile, rename, rm, writeFile } from 'node:fs/promises';

export function parseMd5(text, expectedFilename) {
  const match = text.trim().match(/^([a-f0-9]{32})\s+[* ]?(.+?)\s*$/i);
  if (!match) throw new Error('The MD5 file is not in the expected checksum format');
  const filename = basename(match[2].trim());
  if (filename !== basename(expectedFilename)) throw new Error(`Checksum names ${filename}, expected ${basename(expectedFilename)}`);
  return match[1].toLowerCase();
}

export async function writeJournal(path, journal) {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(journal, null, 2)}\n`, 'utf8');
  await rename(temporary, path);
}

export async function writeMarineSource(path, planetFingerprint) {
  if (typeof planetFingerprint !== 'string' || !/^\d+:\d+:\d+$/.test(planetFingerprint)) {
    throw new Error('Invalid planet fingerprint');
  }
  // Version 4 adds complete GDAL all_tags exports, including numbered lights;
  // earlier intermediate extracts may have silently lost numbered sector tags.
  await writeJournal(path, { version: 4, planetFingerprint });
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function commitBootstrapMarker(path, marker) {
  if (!path || !marker) return;
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
  await rename(temporary, path);
}

export async function promoteCandidate(paths, journal) {
  if (!(await exists(paths.planet)) || !(await exists(paths.candidate))) {
    throw new Error('Both current and candidate PBF files must exist before promotion');
  }
  journal.phase = 'cleanup-previous';
  await writeJournal(paths.journal, journal);
  // The journal distinguishes this cleanup window from a crash during the
  // two-file promotion, where the previous PBF must remain recoverable.
  await rm(paths.previous, { force: true });
  journal.phase = 'candidate-ready';
  await writeJournal(paths.journal, journal);
  await rename(paths.planet, paths.previous);
  try {
    await rename(paths.candidate, paths.planet);
  } catch (error) {
    await rename(paths.previous, paths.planet);
    throw error;
  }
  journal.phase = 'promoted';
  await writeJournal(paths.journal, journal);
  if (journal.bootstrap) await commitBootstrapMarker(paths.bootstrapMarker, { initializedAt: Date.now(), replicationUrl: journal.replicationUrl });
  await rm(paths.journal, { force: true });
}

export async function recoverPromotion(paths, journal) {
  const planet = await exists(paths.planet);
  const candidate = await exists(paths.candidate);
  const previous = await exists(paths.previous);

  if (journal.phase === 'cleanup-previous') {
    if (!planet || !candidate) throw new Error('Cannot resume backup cleanup without both current and candidate PBFs.');
    await rm(paths.previous, { force: true });
    journal.phase = 'candidate-ready';
    await writeJournal(paths.journal, journal);
    return recoverPromotion(paths, journal);
  }

  if (journal.phase === 'candidate-ready') {
    if (planet && candidate && !previous) {
      await rename(paths.planet, paths.previous);
      await rename(paths.candidate, paths.planet);
    } else if (!planet && candidate && previous) {
      await rename(paths.candidate, paths.planet);
    } else if (planet && !candidate && previous) {
      // Both file moves completed before the journal phase update.
    } else {
      throw new Error('Ambiguous candidate-ready files; inspect the planet, candidate and previous PBFs.');
    }
    journal.phase = 'promoted';
    await writeJournal(paths.journal, journal);
  } else if (journal.phase === 'promoted') {
    if (!planet || candidate) throw new Error('Promoted journal does not match PBF files.');
  } else {
    throw new Error(`Unsupported promotion journal phase: ${journal.phase}`);
  }

  if (journal.bootstrap) await commitBootstrapMarker(paths.bootstrapMarker, { initializedAt: Date.now(), replicationUrl: journal.replicationUrl });
  await rm(paths.journal, { force: true });
  return { recovered: true };
}

export async function writeVerifiedChecksum(expectedPath, actualPath) {
  const expected = parseMd5(await readFile(expectedPath, 'utf8'), basename(actualPath));
  const hash = createHash('md5');
  for await (const chunk of createReadStream(actualPath)) hash.update(chunk);
  const actual = hash.digest('hex');
  if (actual !== expected) throw new Error(`MD5 mismatch; expected ${expected}, got ${actual}`);
  return actual;
}
