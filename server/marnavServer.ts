import { resolve } from 'node:path';
import type { IncomingMessage } from 'node:http';
import type { Plugin } from 'vite';
import { WebSocketServer } from 'ws';
import { createAisRelay } from './aisRelay';
import { createDepthHandler } from './depthProxy';
import { createOverpassHandler } from './overpassProxy';
import { serveArchiveFile } from './archiveServer';
import { createWreckResearchHandler } from './wreckResearchProxy';
import { createNatura2000Handler } from './natura2000Proxy';

/**
 * Dev/preview server glue: Overpass/depth proxies, local data archives and
 * the AIS relay. Private API keys stay in this process.
 */
export function marnavServer(options: { aisKey: string }): Plugin {
  const configuredMarineDir = process.env.WHEELOVER_MARINE_DATA_DIR;
  const marineDir = configuredMarineDir ? resolve(configuredMarineDir) : null;
  const configuredContourDir = process.env.WHEELOVER_CONTOUR_DATA_DIR;
  const contourDir = configuredContourDir ? resolve(configuredContourDir) : resolve(process.cwd(), 'public', 'contours');

  return {
    name: 'marnav-server',
    configureServer(server) {
      const log = (message: string) => server.config.logger.info(`[WHEELOVER] ${message}`);

      server.middlewares.use('/api/overpass', createOverpassHandler(log));
      server.middlewares.use('/api/depth', createDepthHandler(log));
      server.middlewares.use('/api/wreck-research', createWreckResearchHandler());
      server.middlewares.use('/api/natura2000', createNatura2000Handler());
      server.middlewares.use('/marine-db', (req, res, next) => {
        if (!marineDir) return next();
        const path = (req.url ?? '/').split('?')[0] || '/';
        const requested = path === '/' ? '/manifest.json' : path;
        void serveArchiveFile(marineDir, req, res, requested, () => 'application/json; charset=utf-8');
      });
      server.middlewares.use('/contours', (req, res, next) => {
        if (!contourDir) return next();
        const path = (req.url ?? '/').split('?')[0] || '/';
        const requested = path === '/' ? '/manifest.json' : path;
        void serveArchiveFile(contourDir, req, res, requested, (file) =>
          file.toLowerCase().endsWith('.fgb') ? 'application/flatgeobuf' : 'application/json; charset=utf-8',
        );
      });

      const relay = createAisRelay({ apiKey: options.aisKey, log });
      const wss = new WebSocketServer({ noServer: true });

      const onUpgrade = (req: IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) => {
        let pathname = '/';
        try {
          pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
        } catch {
          pathname = '/';
        }
        if (pathname !== '/ws/ais') return;
        wss.handleUpgrade(req, socket, head, (ws) => relay.attach(ws));
      };

      server.httpServer?.on('upgrade', onUpgrade);
      relay.start();
      log(options.aisKey ? 'AIS relay ready on /ws/ais' : 'AIS relay in simulated mode (no key)');

      server.httpServer?.on('close', () => {
        relay.stop();
        wss.close();
      });
    },
  };
}
