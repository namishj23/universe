import { istDayStart, weekOf } from '@universe/contracts';
import { recordActivity } from '../../apps/api/src/platform/activity/service.js';
import type { Db } from '../../apps/api/src/platform/db.js';
import { WELCOME_TEXT } from './platform.js';

// The demo's one story across modules, run after every module seed: the admin's announcement
// and the order, times and read state of Aarav's inbox, as in the design (newest first):
//   Admin Office: "Library open until 23:00 through exam week."   2 hours ago     unread
//   Diya Kulkarni accepted you on her 08:10 ride.                 earlier today   unread
//   Prof. Neha Iyer accepted your mentorship request (Mon 15:30). earlier today   unread
//   Your weekly summary is ready. Only you can see it.            last week       read
//   Welcome to UniVerse.                                          oldest          read
// Only rows this seed run created are re-dated or removed, so running it again changes nothing.

export const ANNOUNCEMENT_TEXT = 'Library open until 23:00 through exam week.';
const MIN = 60_000;

export async function seedStory(db: Db, seedStartedAt: Date, now = new Date()): Promise<void> {
  const [aarav, admin, diya, neha] = await Promise.all(
    [
      'student@universe.test',
      'admin@universe.test',
      'student2@universe.test',
      'mentor@universe.test',
    ].map((email) => db.user.findUnique({ where: { email }, select: { id: true } })),
  );
  if (!aarav || !admin || !diya || !neha) return;

  const announced = await db.activityEvent.count({
    where: {
      recipientId: aarav.id,
      type: 'platform.announcement',
      payload: { path: ['message'], equals: ANNOUNCEMENT_TEXT },
    },
  });
  if (announced === 0) {
    const everyone = await db.user.findMany({ where: { isActive: true }, select: { id: true } });
    await recordActivity(db, {
      recipients: everyone.map((u) => u.id),
      actorId: admin.id,
      module: 'platform',
      type: 'platform.announcement',
      payload: { message: ANNOUNCEMENT_TEXT },
    });
  }

  const announceAt = new Date(now.getTime() - 120 * MIN);
  // "Earlier today" (Asia/Kolkata), but always older than the announcement.
  const today = (minutesAgo: number, rank: number) =>
    new Date(
      Math.min(
        Math.max(now.getTime() - minutesAgo * MIN, istDayStart(now).getTime() + rank * MIN),
        announceAt.getTime() - rank * 20 * MIN,
      ),
    );
  const summaryAt = new Date(
    weekOf(new Date(now.getTime() - 7 * 86_400_000)).start.getTime() + 9 * 60 * MIN,
  );
  const fresh = { createdAt: { gte: seedStartedAt } };
  const date = (where: object, createdAt: Date, read: boolean) =>
    db.activityEvent.updateMany({
      where: { ...fresh, ...where },
      data: { createdAt, readAt: read ? createdAt : null },
    });

  await date(
    { type: 'platform.announcement', payload: { path: ['message'], equals: ANNOUNCEMENT_TEXT } },
    announceAt,
    false,
  );
  await db.activityEvent.updateMany({
    where: {
      ...fresh,
      recipientId: admin.id,
      payload: { path: ['message'], equals: ANNOUNCEMENT_TEXT },
    },
    data: { readAt: announceAt },
  });
  const mine = { recipientId: aarav.id };
  await date({ ...mine, type: 'rides.seat_accepted', actorId: diya.id }, today(160, 2), false);
  await date({ ...mine, type: 'hub.request_accepted', actorId: neha.id }, today(285, 1), false);
  await date({ ...mine, type: 'wellbeing.weekly_summary' }, summaryAt, true);
  await date(
    {
      ...mine,
      type: 'platform.announcement',
      payload: { path: ['message'], equals: WELCOME_TEXT },
    },
    new Date(summaryAt.getTime() - 86_400_000),
    true,
  );
  // Side effects of building the demo through the services (e.g. the completed ride's events):
  // not part of Aarav's story, so this run's extras go.
  await db.activityEvent.deleteMany({
    where: {
      ...fresh,
      ...mine,
      NOT: [
        { type: 'platform.announcement' },
        { type: 'rides.seat_accepted', actorId: diya.id },
        { type: 'hub.request_accepted', actorId: neha.id },
        { type: 'wellbeing.weekly_summary' },
      ],
    },
  });
}
