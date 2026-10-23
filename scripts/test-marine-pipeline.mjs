#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseMd5, promoteCandidate, recoverPromotion } from './marine-pipeline-core.mjs';

const md5 = '0123456789abcdef0123456789abcdef';
assert.equal(parseMd5(`${md5}  planet.osm.pbf\n`, 'planet.osm.pbf'), md5);
assert.equal(parseMd5(`${md5} *planet.osm.pbf\n`, 'planet.osm.pbf'), md5);
assert.throws(() => parseMd5(`${md5} other.pbf`, 'planet.osm.pbf'), /names other.pbf/);
assert.throws(() => parseMd5('not a checksum', 'planet.osm.pbf'), /format/);

const dir = await mkdtemp(join(tmpdir(), 'marine-pipeline-'));
const paths = {
  planet: join(dir, 'planet.osm.pbf'),
  candidate: join(dir, 'planet-candidate.osm.pbf'),
  previous: join(dir, 'planet-previous.osm.pbf'),
  journal: join(dir, 'promotion-journal.json'),
};
try {
  await writeFile(paths.planet, 'old planet');
  await writeFile(paths.previous, 'older backup');
  await writeFile(paths.candidate, 'new planet');
  const journal = { schema: 1, phase: 'candidate-ready', createdAt: Date.now() };
  await promoteCandidate(paths, journal);
  assert.equal(await readFile(paths.planet, 'utf8'), 'new planet');
  assert.equal(await readFile(paths.previous, 'old planet').catch(() => ''), '');
  await assert.rejects(readFile(paths.journal));

  await writeFile(paths.candidate, 'next planet');
  const interrupted = { schema: 1, phase: 'candidate-ready', createdAt: Date.now() };
  await writeFile(paths.journal, JSON.stringify(interrupted));
  await rm(paths.planet);
  await writeFile(paths.previous, 'old planet');
  assert.deepEqual(await recoverPromotion(paths, interrupted), { recovered: true });
  assert.equal(await readFile(paths.planet, 'utf8'), 'next planet');
  assert.equal(await readFile(paths.previous, 'utf8'), 'old planet');

  const ambiguous = { schema: 1, phase: 'candidate-ready', createdAt: Date.now() };
  await writeFile(paths.candidate, 'stray candidate');
  await assert.rejects(recoverPromotion(paths, ambiguous), /Ambiguous/);
  console.log('PASS marine pipeline: checksum validation, candidate promotion, interrupted recovery, ambiguous-state safety');
} finally {
  await rm(dir, { recursive: true, force: true });
}
