import { Router } from 'express';
import { z } from 'zod';
import {
  AnnouncementRequest,
  PageQuery,
  type ActivityEvent,
  type AnnouncementResponse,
  type Page,
  type UnreadCount,
} from '@universe/contracts';
import { prisma } from '../db.js';
import { ApiError, asyncHandler } from '../http.js';
import { authOf, requireAuth, requireRole } from '../auth/guards.js';
import { isSessionLive } from '../auth/sessions.js';
import { addStream, removeStream, type Stream } from './broker.js';
import { actorSelect, emit, pushUnreadCounts, toActivityEvent } from './service.js';

const HEARTBEAT_MS = 25_000;
const REPLAY_LIMIT = 100;
const newestFirst = [{ createdAt: 'desc' }, { id: 'desc' }] as const;

const Cursor = z.tuple([z.iso.datetime(), z.uuid()]);
const encodeCursor = (e: ActivityEvent) => Buffer.from(`${e.createdAt}|${e.id}`).toString('base64url');
function decodeCursor(cursor: string) {
  const [createdAt, id] = Cursor.parse(Buffer.from(cursor, 'base64url').toString().split('|'));
  return { createdAt: new Date(createdAt), id };
}
const IdParam = z.object({ id: z.uuid() }).strict();

export const activityRoutes = Router();
activityRoutes.use(requireAuth);

activityRoutes.get(
  '/',
  asyncHandler(async (req, res) => {
    const { user } = authOf(req);
    const { cursor, limit } = PageQuery.parse(req.query);
    const after = cursor ? decodeCursor(cursor) : undefined;
    const rows = await prisma.activityEvent.findMany({
      where: {
        recipientId: user.id,
        ...(after && {
          OR: [
            { createdAt: { lt: after.createdAt } },
            { createdAt: after.createdAt, id: { lt: after.id } },
          ],
        }),
      },
      orderBy: [...newestFirst],
      take: limit + 1,
      include: actorSelect,
    });
    const items = rows.slice(0, limit).map(toActivityEvent);
    const last = items.at(-1);
    const body: Page<ActivityEvent> = {
      items,
      nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
    };
    res.json(body);
  }),
);

activityRoutes.get(
  '/unread-count',
  asyncHandler(async (req, res) => {
    const count = await prisma.activityEvent.count({
      where: { recipientId: authOf(req).user.id, readAt: null },
    });
    const body: UnreadCount = { count };
    res.json(body);
  }),
);

activityRoutes.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    const { user } = authOf(req);
    await prisma.activityEvent.updateMany({
      where: { recipientId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    await pushUnreadCounts([user.id]);
    res.status(204).end();
  }),
);

activityRoutes.post(
  '/:id/read',
  asyncHandler(async (req, res) => {
    const { user } = authOf(req);
    const { id } = IdParam.parse(req.params);
    const { count } = await prisma.activityEvent.updateMany({
      where: { id, recipientId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    // 404 (not 403) for someone else's event, so IDs cannot be probed.
    if (count === 0) {
      const own = await prisma.activityEvent.findFirst({
        where: { id, recipientId: user.id },
        select: { id: true },
      });
      if (!own) throw new ApiError(404, 'NOT_FOUND', 'Not found');
    }
    await pushUnreadCounts([user.id]);
    res.status(204).end();
  }),
);

activityRoutes.post(
  '/announcements',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { user } = authOf(req);
    const { message, roles } = AnnouncementRequest.parse(req.body);
    const recipients = await prisma.user.findMany({
      where: { isActive: true, ...(roles && { role: { in: roles } }) },
      select: { id: true },
    });
    const recorded = await emit({
      recipients: recipients.map((r) => r.id),
      actorId: user.id,
      module: 'platform',
      type: 'platform.announcement',
      payload: { message },
    });
    const body: AnnouncementResponse = { recipients: recorded.length };
    res.json(body);
  }),
);

activityRoutes.get(
  '/stream',
  asyncHandler(async (req, res) => {
    const { user, sessionId } = authOf(req);
    const lastEventId = z.uuid().safeParse(req.get('last-event-id'));

    res.status(200).set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    // Every message carries the id of the newest activity event this stream has delivered, so
    // `unread-count` messages never move the browser's Last-Event-ID past an undelivered event.
    let lastId = lastEventId.success ? lastEventId.data : undefined;
    let closed = false;
    const stream: Stream = {
      send(event, data, id) {
        if (closed) return;
        if (event === 'activity' && id) lastId = id;
        res.write(`${lastId ? `id: ${lastId}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      },
      close() {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        removeStream(user.id, stream);
        res.end();
      },
    };
    const heartbeat = setInterval(() => {
      isSessionLive(sessionId).then(
        (live) => (live ? res.write(': heartbeat\n\n') : stream.close()),
        () => stream.close(),
      );
    }, HEARTBEAT_MS);
    req.on('close', () => stream.close());

    // Register before replaying so nothing emitted meanwhile is missed; clients de-duplicate by id.
    addStream(user.id, stream);

    if (lastEventId.success) {
      const anchor = await prisma.activityEvent.findFirst({
        where: { id: lastEventId.data, recipientId: user.id },
        select: { id: true, createdAt: true },
      });
      if (anchor) {
        const missed = await prisma.activityEvent.findMany({
          where: {
            recipientId: user.id,
            OR: [
              { createdAt: { gt: anchor.createdAt } },
              { createdAt: anchor.createdAt, id: { gt: anchor.id } },
            ],
          },
          orderBy: [...newestFirst],
          take: REPLAY_LIMIT,
          include: actorSelect,
        });
        for (const row of missed.reverse()) stream.send('activity', toActivityEvent(row), row.id);
      }
    } else {
      const newest = await prisma.activityEvent.findFirst({
        where: { recipientId: user.id },
        orderBy: [...newestFirst],
        select: { id: true },
      });
      lastId = newest?.id;
    }
    const count = await prisma.activityEvent.count({ where: { recipientId: user.id, readAt: null } });
    stream.send('unread-count', { count } satisfies UnreadCount);
  }),
);
