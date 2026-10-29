import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { pageOf, ActivityEvent, ApiErrorBody, UnreadCount } from '@universe/contracts';
import { z } from 'zod';
import { addStream, removeStream, type Stream } from '../src/platform/activity/broker.js';
import { emit, transaction } from '../src/platform/activity/service.js';
import { prisma } from '../src/platform/db.js';
import { login, seed, userId } from './helpers.js';

const FeedPage = pageOf(ActivityEvent);

let student: string;
let student2: string;
beforeAll(async () => {
  await seed();
  student = await userId('student@universe.test');
  student2 = await userId('student2@universe.test');
});

const fakeStream = () => ({ send: vi.fn<Stream['send']>(), close: vi.fn<Stream['close']>() });

describe('emit', () => {
  it('rejects an unknown type', async () => {
    const input = {
      recipients: student,
      module: 'platform',
      type: 'platform.nope',
      payload: {},
    } as const;
    // @ts-expect-error unknown types are rejected at compile time too
    await expect(emit(input)).rejects.toThrow(/Unknown activity type/);
  });

  it('rejects a bad payload and a type from another module', async () => {
    const base = { recipients: student, type: 'platform.announcement' } as const;
    await expect(emit({ ...base, module: 'platform', payload: { message: '' } })).rejects.toThrow(
      z.ZodError,
    );
    await expect(
      emit({ ...base, module: 'platform', payload: { message: 'x'.repeat(501) } }),
    ).rejects.toThrow(z.ZodError);
    await expect(emit({ ...base, module: 'hub', payload: { message: 'hi' } })).rejects.toThrow(
      /does not belong to module hub/,
    );
  });

  it('stores nothing and pushes nothing when the transaction rolls back', async () => {
    const stream = fakeStream();
    addStream(student2, stream);
    const before = await prisma.activityEvent.count();
    await expect(
      transaction(async (_tx, emit) => {
        await emit({
          recipients: student2,
          module: 'platform',
          type: 'platform.announcement',
          payload: { message: 'never delivered' },
        });
        throw new Error('module write failed');
      }),
    ).rejects.toThrow('module write failed');
    expect(await prisma.activityEvent.count()).toBe(before);
    expect(stream.send).not.toHaveBeenCalled();

    // The same call that commits is pushed once, after the commit.
    const [recorded] = await transaction((_tx, emit) =>
      emit({
        recipients: student2,
        module: 'platform',
        type: 'platform.announcement',
        payload: { message: 'delivered' },
      }),
    );
    expect(stream.send).toHaveBeenCalledWith('activity', recorded?.event, recorded?.event.id);
    expect(stream.send).toHaveBeenCalledWith('unread-count', { count: 2 }, undefined);
    removeStream(student2, stream);
  });
});

describe('feed', () => {
  it('pages newest first, with stable, non-overlapping pages even when timestamps tie', async () => {
    const createdAt = new Date();
    await prisma.activityEvent.createMany({
      data: Array.from({ length: 25 }, (_, i) => ({
        recipientId: student,
        module: 'platform' as const,
        type: 'platform.announcement',
        payload: { message: `tie ${i}` },
        createdAt,
      })),
    });
    const { app, cookie } = await login('student@universe.test');
    const total = await prisma.activityEvent.count({ where: { recipientId: student } });

    const seen: z.infer<typeof ActivityEvent>[] = [];
    let cursor: string | null = null;
    do {
      const res = await request(app)
        .get('/api/activity')
        .query({ limit: 10, ...(cursor && { cursor }) })
        .set('Cookie', cookie)
        .expect(200);
      const page = FeedPage.parse(res.body);
      expect(page.items.length).toBeLessThanOrEqual(10);
      seen.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);

    expect(seen).toHaveLength(total);
    expect(new Set(seen.map((e) => e.id)).size).toBe(total);
    const expected = await prisma.activityEvent.findMany({
      where: { recipientId: student },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    expect(seen.map((e) => e.id)).toEqual(expected.map((e) => e.id));
  });

  it('rejects a limit above 100 and a malformed cursor', async () => {
    const { app, cookie } = await login('student@universe.test');
    const res = await request(app).get('/api/activity?limit=101').set('Cookie', cookie).expect(400);
    expect(ApiErrorBody.parse(res.body).error.code).toBe('VALIDATION_FAILED');
    await request(app).get('/api/activity?cursor=bm9wZQ').set('Cookie', cookie).expect(400);
    await request(app).get('/api/activity?extra=1').set('Cookie', cookie).expect(400);
  });
});

describe('read state', () => {
  it("returns 404 for someone else's event and changes nothing", async () => {
    const [theirs] = await emit({
      recipients: student2,
      module: 'platform',
      type: 'platform.announcement',
      payload: { message: 'for student2' },
    });
    const { app, cookie, csrfToken } = await login('student@universe.test');
    await request(app)
      .post(`/api/activity/${theirs?.event.id}/read`)
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrfToken)
      .expect(404);
    const row = await prisma.activityEvent.findUniqueOrThrow({
      where: { id: theirs?.event.id ?? '' },
    });
    expect(row.readAt).toBeNull();
  });

  it('marks one event and then all events read', async () => {
    const { app, cookie, csrfToken } = await login('student@universe.test');
    const unread = async () =>
      UnreadCount.parse(
        (await request(app).get('/api/activity/unread-count').set('Cookie', cookie).expect(200))
          .body,
      ).count;
    const start = await unread();
    expect(start).toBeGreaterThan(1);

    const mine = await prisma.activityEvent.findFirstOrThrow({ where: { recipientId: student } });
    const markOne = () =>
      request(app)
        .post(`/api/activity/${mine.id}/read`)
        .set('Cookie', cookie)
        .set('X-CSRF-Token', csrfToken);
    await markOne().expect(204);
    await markOne().expect(204); // already read: still 204, timestamp unchanged
    expect(await unread()).toBe(start - 1);

    await request(app)
      .post('/api/activity/read-all')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrfToken)
      .expect(204);
    expect(await unread()).toBe(0);
  });
});
