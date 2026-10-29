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
import { audit } from '../audit/index.js';
import { prisma } from '../db.js';
import { ApiError, asyncHandler, IdParam } from '../http.js';
import { authOf, requireAuth, requireRole } from '../auth/guards.js';
import { isSessionLive } from '../auth/sessions.js';
import { newestFirst, olderThan, toPage } from '../paging.js';
import { addStream, removeStream, type Stream } from './broker.js';
import { actorSelect, pushUnreadCounts, toActivityEvent, transaction } from './service.js';

const HEARTBEAT_MS = 25_000;
const REPLAY_LIMIT = 100;

export const activityRoutes = Router();
activityRoutes.use(requireAuth);

activityRoutes.get(
  '/',
  asyncHandler(async (req, res) => {
    const { user } = authOf(req);
    const { cursor, limit } = PageQuery.parse(req.query);
    const rows = await prisma.activityEvent.findMany({
      where: { recipientId: user.id, ...olderThan(cursor) },
      orderBy: [...newestFirst],
      take: limit + 1,
      include: actorSelect,
    });
    const body: Page<ActivityEvent> = toPage(rows, limit, toActivityEvent);
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
    const recorded = await transaction(async (tx, emit) => {
      const sent = await emit({
        recipients: recipients.map((r) => r.id),
        actorId: user.id,
        module: 'platform',
        type: 'platform.announcement',
        payload: { message },
      });
      await audit.record(tx, {
        actorId: user.id,
        action: 'platform.announcement_sent',
        metadata: { recipients: sent.length, ...(roles && { roles }) },
        requestId: req.id,
      });
      return sent;
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

    res.writeHead(200, {
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
      sessionId,
      send(event, data, id) {
        if (closed) return;
        if (event === 'activity' && id) lastId = id;
        res.write(
          `${lastId ? `id: ${lastId}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
        );
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
            createdAt: { gte: anchor.createdAt },
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
    const count = await prisma.activityEvent.count({
      where: { recipientId: user.id, readAt: null },
    });
    stream.send('unread-count', { count } satisfies UnreadCount);
  }),
);
