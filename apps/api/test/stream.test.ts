import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import request from 'supertest';
import { ActivityEvent } from '@universe/contracts';
import { createApp } from '../src/app.js';
import { connectedUserIds } from '../src/platform/activity/broker.js';
import { login, seed } from './helpers.js';

interface Message {
  id?: string;
  event: string;
  data: string;
}

let server: Server;
let baseUrl: string;
beforeAll(async () => {
  await seed();
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.closeAllConnections();
  server.close();
});

/** Opens the SSE stream and exposes a "wait for the next matching message" helper. */
async function openStream(cookie: string, lastEventId?: string) {
  const abort = new AbortController();
  const res = await fetch(`${baseUrl}/api/activity/stream`, {
    headers: { cookie, ...(lastEventId && { 'last-event-id': lastEventId }) },
    signal: abort.signal,
  });
  if (!res.body) throw new Error('no body');
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  const queue: Message[] = [];
  let buffer = '';

  async function next(match: (m: Message) => boolean, timeoutMs = 1000): Promise<Message> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const index = queue.findIndex(match);
      if (index >= 0) return queue.splice(index, 1)[0] as Message;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('timed out waiting for an SSE message');
      let timer: NodeJS.Timeout | undefined;
      const chunk = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('timed out waiting for an SSE message')),
            remaining,
          );
        }),
      ]).finally(() => clearTimeout(timer));
      if (chunk.done) throw new Error('stream ended');
      buffer += chunk.value;
      let end: number;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const message: Message = { event: 'message', data: '' };
        for (const line of block.split('\n')) {
          if (line.startsWith('id: ')) message.id = line.slice(4);
          else if (line.startsWith('event: ')) message.event = line.slice(7);
          else if (line.startsWith('data: ')) message.data = line.slice(6);
        }
        if (block.split('\n').some((l) => !l.startsWith(':'))) queue.push(message);
      }
    }
  }
  return { res, next, close: () => abort.abort() };
}

const isActivity = (message: string) => (m: Message) =>
  m.event === 'activity' &&
  (ActivityEvent.parse(JSON.parse(m.data)).payload as { message: string }).message === message;

it('delivers an announcement live and replays missed events after a reconnect', async () => {
  const admin = await login('admin@universe.test');
  const student = await login('student@universe.test');
  const announce = (message: string) =>
    request(admin.app)
      .post('/api/activity/announcements')
      .set('Cookie', admin.cookie)
      .set('X-CSRF-Token', admin.csrfToken)
      .send({ message, roles: ['student'] })
      .expect(200);

  const first = await openStream(student.cookie);
  expect(first.res.headers.get('content-type')).toBe('text/event-stream');
  expect(first.res.headers.get('cache-control')).toBe('no-cache, no-transform');
  expect(first.res.headers.get('x-accel-buffering')).toBe('no');
  const initial = await first.next((m) => m.event === 'unread-count');
  expect(JSON.parse(initial.data)).toEqual({ count: 1 });

  const sentAt = Date.now();
  await announce('live!');
  const live = await first.next(isActivity('live!'), 1000);
  expect(Date.now() - sentAt).toBeLessThan(1000);
  expect(live.id).toBeDefined();
  const count = await first.next((m) => m.event === 'unread-count');
  expect(count.id).toBe(live.id);
  expect(JSON.parse(count.data)).toEqual({ count: 2 });

  first.close();
  await vi.waitFor(() => expect(connectedUserIds([student.user.id])).toEqual([]));

  await announce('missed one');
  await announce('missed two');

  const second = await openStream(student.cookie, live.id);
  const one = await second.next((m) => m.event === 'activity');
  const two = await second.next((m) => m.event === 'activity');
  expect(
    [one, two].map((m) => (JSON.parse(m.data) as { payload: { message: string } }).payload.message),
  ).toEqual(['missed one', 'missed two']);
  second.close();
});

it('refuses the stream without a session', async () => {
  const res = await fetch(`${baseUrl}/api/activity/stream`);
  expect(res.status).toBe(401);
});
