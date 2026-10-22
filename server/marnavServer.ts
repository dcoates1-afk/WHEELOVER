import type { Plugin } from 'vite';
import { WebSocketServer } from 'ws';
import { createAisRelay } from './aisRelay';
import { createOverpassHandler } from './overpassProxy';
import { createDepthHandler } from './depthProxy';

/**
 * Dev/preview server glue: the Overpass proxy at /api/overpass and the AIS
 * relay at /ws/ais. The AIS key stays in this process.
 */
export function marnavServer(options: { aisKey: string }): Plugin {
  return {
    name: 'marnav-server',
    configureServer(server) {
      const log = (message: string) => server.config.logger.info(`[WHEELOVER] ${message}`);

      server.middlewares.use('/api/overpass', createOverpassHandler(log));
      server.middlewares.use('/api/depth', createDepthHandler(log));

      const relay = createAisRelay({ apiKey: options.aisKey, log });
      const wss = new WebSocketServer({ noServer: true });

      const onUpgrade = (req: import('node:http').IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) => {
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
