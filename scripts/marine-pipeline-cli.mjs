#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { promoteCandidate, recoverPromotion, writeJournal, writeMarineSource, writeVerifiedChecksum } from './marine-pipeline-core.mjs';

const [command, ...args] = process.argv.slice(2);
try {
  if (command === 'checksum' && args.length === 2) {
    console.log(await writeVerifiedChecksum(args[0], args[1]));
  } else if (command === 'write-journal' && args.length === 2) {
    await writeJournal(args[0], JSON.parse(args[1]));
  } else if (command === 'write-source' && args.length === 2) {
    await writeMarineSource(args[0], args[1]);
  } else if (command === 'promote' && args.length === 2) {
    await promoteCandidate(JSON.parse(args[0]), JSON.parse(args[1]));
  } else if (command === 'recover' && args.length === 2) {
    const paths = JSON.parse(args[0]);
    const journal = JSON.parse(args[1]);
    await recoverPromotion(paths, journal);
    console.log('Recovered interrupted PBF promotion.');
  } else {
    throw new Error('Usage: marine-pipeline-cli.mjs checksum <md5-file> <data-file> | write-journal <path> <json> | write-source <path> <planet-fingerprint> | promote <paths-json> <journal-json> | recover <paths-json> <journal-json>');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
