import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';

await mkdir('build', { recursive: true });
await build({
  absWorkingDir: process.cwd(),
  entryPoints: ['server/productionServer.ts'],
  outfile: 'build/server.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'external',
  sourcemap: false,
  legalComments: 'none',
});
console.info('Production server bundled to build/server.mjs');
