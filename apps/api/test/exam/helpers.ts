import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ModuleId } from '@universe/contracts';
import { createApp } from '../../src/app.js';
import { loadModules } from '../../src/platform/modules/index.js';
import { createPlatform } from '../../src/platform/modules/platform.js';
import type { ServiceConfig } from '../../src/platform/services.js';

export const TOKEN = 'test-service-token-0123456789abcdefghijklmnop';

export interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: Buffer;
}

/** A stand-in for the exam service: records each request, answers with `handler`. */
export async function fakeService() {
  const seen: Seen[] = [];
  let handler = (_req: IncomingMessage, res: ServerResponse, _body: Buffer) => {
    res.setHeader('Content-Type', 'application/json');
    res.end('{"ok":true}');
  };
  const server: Server = createServer((req, res) => {
    // Live routes answer at once; others after the whole body (like a real service).
    if (req.url?.startsWith('/exam/live/')) {
      seen.push({
        method: req.method ?? '',
        url: req.url,
        headers: req.headers,
        body: Buffer.alloc(0),
      });
      handler(req, res, Buffer.alloc(0));
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
      handler(req, res, body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  return {
    url,
    seen,
    respond(fn: typeof handler) {
      handler = fn;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** The app with the exam module installed against `url` (the env leaves it unset in tests). */
export async function examApp(url: URL) {
  const services: Partial<Record<ModuleId, ServiceConfig>> = { exam: { url, token: TOKEN } };
  const platform = createPlatform({ services: { get: (id) => services[id] } });
  const modules = await loadModules({ platform });
  return { app: createApp({ modules, services }), modules };
}
