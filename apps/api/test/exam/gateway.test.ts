import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleInfo } from '@universe/contracts';
import { ApiErrorBody } from '@universe/contracts';
import { createApp } from '../../src/app.js';
import { TIMEOUTS } from '../../src/modules/exam/gateway.js';
import { prisma } from '../../src/platform/db.js';
import { loadModules } from '../../src/platform/modules/index.js';
import { as, login, seed } from '../helpers.js';
import { examApp, fakeService, TOKEN } from './helpers.js';

let svc: Awaited<ReturnType<typeof fakeService>>;
let app: Express;
beforeAll(async () => {
  await seed();
  svc = await fakeService();
  ({ app } = await examApp(svc.url));
});
afterAll(() => svc.close());

// One sign-in per account (the login limiter allows 10 a minute per app).
const sessions = new Map<string, Awaited<ReturnType<typeof login>>>();
const signIn = async (email: string) => {
  let s = sessions.get(email);
  if (!s) sessions.set(email, (s = await login(email, app)));
  return s;
};

const driverEmail = async () =>
  (await prisma.user.findFirstOrThrow({ where: { role: 'driver', isActive: true } })).email;

describe('who may use the gateway', () => {
  it('lets invigilators and admins through and refuses every other role', async () => {
    for (const email of ['invigilator@universe.test', 'admin@universe.test']) {
      const s = await signIn(email);
      await as(s).get('/api/exam/flags?status=open').expect(200, { ok: true });
    }
    const before = svc.seen.length;
    for (const email of ['student@universe.test', 'mentor@universe.test', await driverEmail()]) {
      const s = await signIn(email);
      const res = await as(s).get('/api/exam/flags').expect(403);
      expect(ApiErrorBody.parse(res.body).error.code).toBe('FORBIDDEN');
    }
    await request(app).get('/api/exam/flags').expect(401);
    expect(svc.seen.length).toBe(before);
  });

  it('lists "Exam Review" in /api/modules for reviewers only', async () => {
    const inv = await signIn('invigilator@universe.test');
    const list = (await as(inv).get('/api/modules').expect(200)).body as ModuleInfo[];
    expect(list.find((m) => m.id === 'exam')).toMatchObject({
      label: 'Exam Review',
      basePath: '/api/exam',
    });
    const st = await signIn('student@universe.test');
    expect(
      ((await as(st).get('/api/modules')).body as ModuleInfo[]).map((m) => m.id),
    ).not.toContain('exam');
  });

  it('enforces CSRF and the Origin check before forwarding', async () => {
    const s = await signIn('invigilator@universe.test');
    const before = svc.seen.length;
    await request(app)
      .post('/api/exam/flags/x/review')
      .set('Cookie', s.cookie)
      .send({})
      .expect(403);
    await as(s)
      .post('/api/exam/flags/x/review')
      .set('Origin', 'https://evil.example')
      .send({})
      .expect(403);
    expect(svc.seen.length).toBe(before);
    await as(s)
      .post('/api/exam/flags/x/review')
      .send({ decision: 'dismiss', note: 'ok' })
      .expect(200);
  });

  it('is absent (404, not in /api/modules) when the service is not configured', async () => {
    const plain = createApp({ modules: await loadModules() });
    const s = await login('invigilator@universe.test', plain);
    await as(s).get('/api/exam/flags').expect(404);
    expect(((await as(s).get('/api/modules')).body as ModuleInfo[]).map((m) => m.id)).not.toContain(
      'exam',
    );
  });
});

describe('what crosses the gateway', () => {
  it('sends only the allow-listed headers and the real identity', async () => {
    const s = await signIn('invigilator@universe.test');
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: 'invigilator@universe.test' },
    });
    svc.seen.length = 0;
    await as(s)
      .get('/api/exam/clips?limit=5&cursor=abc')
      .set('Authorization', 'Bearer stolen')
      .set('X-Service-Token', 'forged')
      .set('X-UniVerse-User-Id', '00000000-0000-4000-8000-000000000000')
      .set('X-UniVerse-User-Role', 'admin')
      .set('X-Forwarded-For', '10.0.0.1')
      .set('Range', 'bytes=0-9')
      .set('If-None-Match', '"v1"')
      .expect(200);
    const got = svc.seen[0]!;
    expect(got.url).toBe('/exam/clips?limit=5&cursor=abc');
    expect(got.headers.cookie).toBeUndefined();
    expect(got.headers.authorization).toBeUndefined();
    expect(got.headers['x-forwarded-for']).toBeUndefined();
    expect(got.headers['x-service-token']).toBe(TOKEN);
    expect(got.headers['x-universe-user-id']).toBe(user.id);
    expect(got.headers['x-universe-user-role']).toBe('invigilator');
    expect(decodeURIComponent(String(got.headers['x-universe-user-name']))).toBe(user.name);
    expect(got.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(got.headers.range).toBe('bytes=0-9');
    expect(got.headers['if-none-match']).toBe('"v1"');
  });

  it('streams the JSON body unparsed, byte for byte', async () => {
    const s = await signIn('admin@universe.test');
    svc.seen.length = 0;
    const raw = '{"decision":"follow_up",  "note":"seat B-12"}';
    await as(s)
      .post('/api/exam/flags/abc/review')
      .set('Content-Type', 'application/json')
      .send(raw)
      .expect(200);
    expect(svc.seen[0]!.body.toString()).toBe(raw);
  });

  it('drops Set-Cookie, adds nosniff and the security headers, passes 206 and Content-Range', async () => {
    svc.respond((_req, res) => {
      res.writeHead(206, {
        'Content-Type': 'video/mp4',
        'Content-Range': 'bytes 0-9/100',
        'Accept-Ranges': 'bytes',
        'Set-Cookie': 'sessionid=evil; Path=/',
        'X-Powered-By': 'Django',
      });
      res.end(Buffer.alloc(10, 1));
    });
    const s = await signIn('invigilator@universe.test');
    const res = await as(s).get('/api/exam/clips/abc/video').set('Range', 'bytes=0-9').expect(206);
    expect(res.headers['content-range']).toBe('bytes 0-9/100');
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
    svc.respond((_req, res) => res.end('{"ok":true}'));
  });

  it('refuses dot segments that would leave /exam/ upstream', async () => {
    const s = await signIn('invigilator@universe.test');
    svc.seen.length = 0;
    await as(s).get('/api/exam/%2e%2e/admin/').expect(404);
    await as(s).get('/api/exam/clips/..%2fadmin').expect(404);
    expect(svc.seen).toHaveLength(0);
  });
});

describe('limits and failures', () => {
  const rawRequest = async (
    port: number,
    cookie: string,
    csrf: string,
    headers: Record<string, string | number>,
    body?: (write: (chunk: Buffer) => boolean) => Promise<void>,
  ) =>
    new Promise<{ status: number; body: string }>((resolve, reject) => {
      let status = 0;
      let text = '';
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port,
          method: 'POST',
          path: '/api/exam/clips',
          headers: { cookie, 'x-csrf-token': csrf, ...headers },
        },
        (res) => {
          status = res.statusCode ?? 0;
          res.on('data', (c: Buffer) => (text += c.toString()));
          res.on('end', () => resolve({ status, body: text }));
          res.on('error', () => resolve({ status, body: text }));
        },
      );
      // The server closes the socket after refusing the body: EPIPE/ECONNRESET on our side.
      req.on('error', (err) =>
        status ? setTimeout(() => resolve({ status, body: text }), 50) : reject(err),
      );
      if (!body) {
        req.end();
        return;
      }
      body((c) => req.write(c)).then(
        () => req.end(),
        () => {},
      );
    });

  it('gives 413 past 200 MB: a declared length at once, a streamed body as it crosses', async () => {
    const server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    const port = (server.address() as AddressInfo).port;
    try {
      const s = await signIn('invigilator@universe.test');
      const declared = await rawRequest(port, s.cookie, s.csrfToken, {
        'content-type': 'application/octet-stream',
        'content-length': 200 * 1024 * 1024 + 1,
      });
      expect(declared.status).toBe(413);
      expect(ApiErrorBody.parse(JSON.parse(declared.body)).error.code).toBe('FILE_TOO_LARGE');

      svc.seen.length = 0;
      const chunk = Buffer.alloc(1024 * 1024, 7);
      let stop = false;
      const streamed = await rawRequest(
        port,
        s.cookie,
        s.csrfToken,
        { 'content-type': 'application/octet-stream', 'transfer-encoding': 'chunked' },
        async (write) => {
          for (let i = 0; i < 202 && !stop; i++)
            if (!write(chunk)) await new Promise((r) => setTimeout(r, 1));
        },
      );
      stop = true;
      expect(streamed.status).toBe(413);
      expect(svc.seen).toHaveLength(0); // the service never got a complete request
    } finally {
      server.close();
    }
  }, 30_000);

  it('gives 503 MODULE_UNAVAILABLE when the service is down', async () => {
    const down = await fakeService();
    await down.close();
    const { app: downApp } = await examApp(down.url);
    const s = await login('invigilator@universe.test', downApp);
    const res = await as(s).get('/api/exam/flags').expect(503);
    expect(ApiErrorBody.parse(res.body).error).toMatchObject({
      code: 'MODULE_UNAVAILABLE',
      message: 'Exam review is unavailable right now.',
    });
  });

  it('gives 503 when the service sends no headers in time', async () => {
    svc.respond(() => {}); // never answers
    const saved = TIMEOUTS.headersMs;
    TIMEOUTS.headersMs = 300;
    try {
      const s = await signIn('invigilator@universe.test');
      const started = Date.now();
      await as(s).get('/api/exam/flags').expect(503);
      expect(Date.now() - started).toBeLessThan(2_000);
    } finally {
      TIMEOUTS.headersMs = saved;
      svc.respond((_req, res) => res.end('{"ok":true}'));
    }
  });

  it('shows the service summary on the dashboard', async () => {
    svc.respond((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(
        req.url === '/exam/dashboard-summary'
          ? '{"openFlags":3,"lastProcessedAt":"2026-10-30T02:00:00Z"}'
          : '{"ok":true}',
      );
    });
    const s = await signIn('invigilator@universe.test');
    const res = await as(s).get('/api/dashboard').expect(200);
    const entry = (
      res.body as { modules: { id: string; status: string; data?: unknown }[] }
    ).modules.find((m) => m.id === 'exam');
    expect(entry).toEqual({
      id: 'exam',
      status: 'ok',
      data: { openFlags: 3, lastProcessedAt: '2026-10-30T02:00:00Z' },
    });
    svc.respond((_req, res) => res.end('{"ok":true}'));
  });
});
