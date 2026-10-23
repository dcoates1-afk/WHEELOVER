import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isAbsolute, relative, resolve } from 'node:path';
import type { Plugin } from 'vite';
import { WebSocketServer } from 'ws';
import { createAisRelay } from './aisRelay';
import { createDepthHandler } from './depthProxy';
import { createOverpassHandler } from './overpassProxy';

/**
 * Dev/preview server glue: the Overpass proxy at /api/overpass and the AIS
 * relay at /ws/ais. The AIS key stays in this process.
 */
export function marnavServer(options: { aisKey: string }): Plugin {
  const configuredMarineDir = process.env.WHEELOVER_MARINE_DATA_DIR;
  const marineDir = configuredMarineDir ? resolve(configuredMarineDir) : null;

  const serveMarine = async (req: IncomingMessage, res: ServerResponse, pathname: string) => {
    if (!marineDir) return false;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      res.end('Method not allowed');
      return true;
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      res.statusCode = 400;
      res.end('Invalid path');
      return true;
    }
    const file = resolve(marineDir, `.${decoded}`);
    const rel = relative(marineDir, file);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
      res.statusCode = 403;
      res.end('Forbidden');
      return true;
    }
    try {
      const info = await stat(file);
      if (!info.isFile()) throw new Error('not a file');
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Length', info.size);
      res.setHeader('Cache-Control', 'no-cache');
      if (req.method === 'HEAD') {
        res.end();
        return true;
      }
      createReadStream(file).pipe(res);
    } catch {
      res.statusCode = 404;
      res.end('Not found');
    }
    return true;
  };

  return {
    name: 'marnav-server',
    configureServer(server) {
      const log = (message: string) => server.config.logger.info(`[WHEELOVER] ${message}`);

      server.middlewares.use('/api/overpass', createOverpassHandler(log));
      server.middlewares.use('/api/depth', createDepthHandler(log));
      server.middlewares.use('/marine-db', (req, res, next) => {
        if (!marineDir) {
          next();
          return;
        }
        const path = (req.url ?? '/').split('?')[0] || '/';
        const requested = path === '/' ? '/manifest.json' : path;
        void serveMarine(req, res, requested);
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
