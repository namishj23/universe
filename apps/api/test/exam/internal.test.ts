import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express, { type Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiErrorBody } from '@universe/contracts';
import { prisma } from '../../src/platform/db.js';
import { claimServiceEvent, sweepServiceEvents } from '../../src/platform/services.js';
import { login, seed, userId } from '../helpers.js';
import { openStream } from '../sse.js';
import { examApp, fakeService, TOKEN } from './helpers.js';

let svc: Awaited<ReturnType<typeof fakeService>>;
let app: Express;
beforeAll(async () => {
  await seed();
  svc = await fakeService();
  ({ app } = await examApp(svc.url));
});
afterAll(() => svc.close());

const post = (path: string, body: object, token: string | null = TOKEN) => {
  const r = request(app).post(`/internal/exam${path}`);
  return (token === null ? r : r.set('X-Service-Token', token)).send(body);
};
const codeOf = (body: unknown) => ApiErrorBody.parse(body).error.code;
const key = () => `k-${randomUUID()}`;
const activity = (overrides: object = {}) => ({
  idempotencyKey: key(),
  type: 'exam.flag_created',
  recipients: { role: 'invigilator' },
  params: { flagId: randomUUID(), clipId: randomUUID(), examId: randomUUID(), seatLabel: 'B-12' },
  ...overrides,
});

describe('the service token and source', () => {
  it('gives 401 for no token, a wrong token and a wrong-length token', async () => {
    expect(codeOf((await post('/activity', activity(), null).expect(401)).body)).toBe(
      'UNAUTHENTICATED',
    );
    await post('/activity', activity(), TOKEN.replace(/.$/, 'X')).expect(401);
    await post('/activity', activity(), TOKEN.slice(0, 10)).expect(401);
    await post('/activity', activity(), `${TOKEN}x`).expect(401);
  });

  it('gives 403 to a caller that is not on the loopback interface', async () => {
    const outer = express();
    outer.use((req, _res, next) => {
      Object.defineProperty(req.socket, 'remoteAddress', { value: '10.1.2.3', configurable: true });
      next();
    });
    outer.use(app);
    await request(outer)
      .post('/internal/exam/activity')
      .set('X-Service-Token', TOKEN)
      .send(activity())
      .expect(403);
  });

  it('is not reachable through /api and never needs a session or CSRF token', async () => {
    await post('/activity', activity()).expect(202);
    await request(app).post('/api/internal/exam/activity').send(activity()).expect(404);
  });

  it('caps the JSON body at 64 kB', async () => {
    const res = await post('/activity', activity({ params: { pad: 'x'.repeat(70_000) } })).expect(
      413,
    );
    expect(codeOf(res.body)).toBe('PAYLOAD_TOO_LARGE');
  });
});

describe('POST /internal/exam/activity', () => {
  it('stores the platform-written text for every invigilator, once per key', async () => {
    const inv = await userId('invigilator@universe.test');
    const body = activity();
    await post('/activity', body).expect(202, { accepted: true });
    await post('/activity', body).expect(202, { accepted: true });
    const events = await prisma.activityEvent.findMany({
      where: {
        recipientId: inv,
        type: 'exam.flag_created',
        payload: { path: ['flagId'], equals: body.params.flagId },
      },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({
      message: 'New flag for human review at seat B-12.',
    });
    expect(events[0]!.module).toBe('exam');
  });

  it('refuses free text, unknown types and recipients who are not reviewers', async () => {
    await post(
      '/activity',
      activity({
        params: {
          flagId: randomUUID(),
          clipId: randomUUID(),
          examId: randomUUID(),
          message: 'Student was cheating',
        },
      }),
    ).expect(400);
    await post(
      '/activity',
      activity({
        params: {
          flagId: randomUUID(),
          clipId: randomUUID(),
          examId: randomUUID(),
          seatLabel: 'near the window',
        },
      }),
    ).expect(400);
    await post('/activity', activity({ type: 'exam.verdict' })).expect(400);
    await post('/activity', activity({ text: 'hello' })).expect(400);
    const student = await userId('student@universe.test');
    const res = await post('/activity', activity({ recipients: { userIds: [student] } })).expect(
      422,
    );
    expect(codeOf(res.body)).toBe('INVALID_RECIPIENT');
    const admin = await userId('admin@universe.test');
    await post(
      '/activity',
      activity({
        type: 'exam.flag_reviewed',
        recipients: { userIds: [admin] },
        params: { flagId: randomUUID(), decision: 'dismiss' },
      }),
    ).expect(202);
  });
});

describe('POST /internal/exam/audit', () => {
  it('records one exam.* entry per key, by an active reviewer', async () => {
    const inv = await userId('invigilator@universe.test');
    const flag = randomUUID();
    const body = {
      idempotencyKey: key(),
      actorUserId: inv,
      action: 'exam.flag_reviewed',
      targetType: 'exam_flag',
      targetId: flag,
      meta: { decision: 'dismiss', clipId: randomUUID() },
    };
    await post('/audit', body).expect(202);
    await post('/audit', body).expect(202);
    expect(
      await prisma.auditLog.count({
        where: { targetId: flag, action: 'exam.flag_reviewed', actorId: inv },
      }),
    ).toBe(1);
  });

  it('refuses a non-exam action, personal text in meta and a non-reviewer actor', async () => {
    const inv = await userId('invigilator@universe.test');
    const base = {
      idempotencyKey: key(),
      actorUserId: inv,
      targetType: 'exam_flag',
      targetId: randomUUID(),
    };
    await post('/audit', { ...base, action: 'admin.user_updated' }).expect(400);
    await post('/audit', {
      ...base,
      action: 'exam.flag_reviewed',
      meta: { note: 'Seat B-12 looked at a phone' },
    }).expect(400);
    const student = await userId('student@universe.test');
    const res = await post('/audit', {
      ...base,
      actorUserId: student,
      action: 'exam.flag_reviewed',
    }).expect(422);
    expect(codeOf(res.body)).toBe('INVALID_ACTOR');
  });
});

describe('POST /internal/exam/push', () => {
  it('sends exam.job_progress to the user’s open streams', async () => {
    const server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    try {
      const s = await login('invigilator@universe.test', app);
      const stream = await openStream(
        `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        s.cookie,
      );
      await stream.next((m) => m.event === 'unread-count');
      const jobId = randomUUID();
      await post('/push', {
        userId: s.user.id,
        event: 'exam.job_progress',
        data: { jobId, progress: 40, status: 'running' },
      }).expect(202);
      const got = await stream.next((m) => m.event === 'exam.job_progress');
      expect(JSON.parse(got.data)).toEqual({ jobId, progress: 40, status: 'running' });
      stream.close();
    } finally {
      server.close();
    }
  });
});

describe('idempotency keys', () => {
  it('are claimed once and forgotten after 7 days', async () => {
    const k = key();
    expect(await claimServiceEvent(prisma, 'exam', k)).toBe(true);
    expect(await claimServiceEvent(prisma, 'exam', k)).toBe(false);
    await sweepServiceEvents(new Date(Date.now() + 8 * 24 * 60 * 60 * 1000));
    expect(await claimServiceEvent(prisma, 'exam', k)).toBe(true);
  });
});
