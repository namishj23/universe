import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { closeAllStreams, trackResponse } from '../../src/platform/activity/broker.js';
import { as, login, seed } from '../helpers.js';
import { openStream } from '../sse.js';
import { examApp, fakeService } from '../exam/helpers.js';

// Long-lived responses close with the session: SSE on logout (P7-023), and tracked streams
// (platform.streams.track, the exam gateway's live/ routes) on logout, maxMs and shutdown.
let svc: Awaited<ReturnType<typeof fakeService>>;
let server: Server;
let base: string;
beforeAll(async () => {
  await seed();
  svc = await fakeService();
  // An MJPEG-like endless stream.
  svc.respond((req, res) => {
    if (!req.url?.startsWith('/exam/live/')) return void res.end('{}');
    res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary=frame' });
    const timer = setInterval(() => res.write('--frame\r\n\r\n'), 20);
    res.on('close', () => clearInterval(timer));
  });
  const { app } = await examApp(svc.url);
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.close();
  await svc.close();
});

/** Resolves with how long the body took to end after `t0`. */
async function endsWithin(res: Response, ms: number) {
  const reader = res.body!.getReader();
  const deadline = Date.now() + ms;
  for (;;) {
    const chunk = await Promise.race([
      reader.read().catch(() => ({ done: true as const })),
      new Promise<'timeout'>((r) =>
        setTimeout(() => r('timeout'), Math.max(0, deadline - Date.now())),
      ),
    ]);
    if (chunk === 'timeout') return false;
    if (chunk.done) return true;
  }
}

describe('streams end with the session', () => {
  it('logout ends that session’s SSE stream within 1 s, and not another session’s', async () => {
    const app = createApp();
    const listening = app.listen(0, '127.0.0.1');
    await new Promise((r) => listening.once('listening', r));
    const url = `http://127.0.0.1:${(listening.address() as AddressInfo).port}`;
    try {
      const a = await login('student@universe.test', app);
      const b = await login('student@universe.test', app);
      const sa = await openStream(url, a.cookie);
      const sb = await openStream(url, b.cookie);
      await sa.next((m) => m.event === 'unread-count');
      await sb.next((m) => m.event === 'unread-count');
      await as(a).post('/api/auth/logout').expect(204);
      const ended = (s: typeof sa, ms: number) =>
        s
          .next(() => false, ms)
          .then(
            () => false,
            (err: Error) => err.message === 'stream ended',
          );
      expect(await ended(sa, 1_000)).toBe(true);
      expect(await ended(sb, 300)).toBe(false);
      sb.close();
    } finally {
      listening.close();
    }
  });

  it('a tracked live stream ends on logout', async () => {
    const inv = await loginOn(base, 'invigilator@universe.test');
    const res = await fetch(`${base}/api/exam/live/sessions/x/stream`, {
      headers: { cookie: inv.cookie },
    });
    expect(res.status).toBe(200);
    await fetch(`${base}/api/auth/logout`, {
      method: 'POST',
      headers: { cookie: inv.cookie, 'x-csrf-token': inv.csrfToken },
    });
    expect(await endsWithin(res, 1_000)).toBe(true);
  });

  it('a tracked live stream ends on shutdown', async () => {
    const inv = await loginOn(base, 'admin@universe.test');
    const res = await fetch(`${base}/api/exam/live/sessions/x/stream`, {
      headers: { cookie: inv.cookie },
    });
    expect(res.status).toBe(200);
    closeAllStreams();
    expect(await endsWithin(res, 1_000)).toBe(true);
  });

  it('a tracked response is closed after maxMs', async () => {
    let destroyed = false;
    let onClose = () => {};
    trackResponse(
      'u',
      's',
      { destroy: () => ((destroyed = true), onClose()), once: (_e, fn) => (onClose = fn) },
      50,
    );
    await new Promise((r) => setTimeout(r, 120));
    expect(destroyed).toBe(true);
  });
});

async function loginOn(url: string, email: string) {
  const res = await fetch(`${url}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: process.env.SEED_DEMO_PASSWORD }),
  });
  const body = (await res.json()) as { csrfToken: string };
  return { cookie: res.headers.getSetCookie()[0]!.split(';')[0]!, csrfToken: body.csrfToken };
}
