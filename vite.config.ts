/// <reference types="vitest" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { marnavServer } from './server/marnavServer';

/**
 * Hostname the Cloud preview reaches this dev server on. It changes when the
 * workspace is restored, so it is read from the environment and only falls back
 * to the hostname baked in at build time.
 */
const PREVIEW_HOST =
  process.env.WHEELOVER_PREVIEW_HOST ||
  'pv-4e1b47965a0a-05f65da5-7a5d-4af7-b152-2ed6510895f4.style.dev';

const ALLOWED_HOSTS = Array.from(new Set([PREVIEW_HOST, 'localhost', '127.0.0.1']));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const port = Number(env.WHEELOVER_PORT || 3000);

  return {
    plugins: [react(), marnavServer({ aisKey: env.AISSTREAM_API_KEY ?? '' })],
    server: {
      host: '0.0.0.0',
      port,
      strictPort: true,
      allowedHosts: ALLOWED_HOSTS,
    },
    preview: {
      host: '0.0.0.0',
      port,
      allowedHosts: ALLOWED_HOSTS,
    },
    build: {
      target: 'es2020',
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  };
});
