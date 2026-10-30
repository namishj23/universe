// The hub card on the unified dashboard, per role.
import { istDate, istDateStart, weekOf, type HubDashboardSummary } from '@universe/contracts';
import type { z } from 'zod';
import type { Platform } from '../../platform/modules/index.js';
import { config } from './config.js';
import type { MentorService } from './mentors.js';
import type { PrepService } from './prep.js';
import type { User } from './shared.js';

type Summary = z.infer<typeof HubDashboardSummary>;

/** Academic terms are Jan–Jun and Jul–Dec (Asia/Kolkata). */
export function termStart(now: Date): Date {
  const [year, month] = istDate(now).split('-').map(Number) as [number, number];
  return istDateStart(`${year}-${month <= 6 ? '01' : '07'}-01`);
}

export function dashboardService(p: Platform, prep: PrepService, mentors: MentorService) {
  const db = p.prisma;

  async function student(user: User): Promise<Summary> {
    const since = new Date(Date.now() - config.newResourceDays * 86_400_000);
    const [view, subjects] = await Promise.all([
      prep.get(user.id),
      db.$queryRaw<{ subject: string; n: number }[]>`
        SELECT subject, count(*)::int AS n FROM hub_resources
        WHERE deleted_at IS NULL AND created_at >= ${since}
        GROUP BY subject ORDER BY count(*) DESC, max(created_at) DESC`,
    ]);
    return {
      kind: 'student',
      dsa: view.dsa,
      newResources: {
        count: subjects.reduce((s, r) => s + r.n, 0),
        topSubject: subjects[0]?.subject ?? null,
      },
      goal: { done: view.week.done, target: view.week.target },
      status: view.week.status,
    };
  }

  async function mentor(user: User): Promise<Summary> {
    const now = new Date();
    const [pendingRequests, mentees, next] = await Promise.all([
      db.hubMentorshipRequest.count({ where: { mentorId: user.id, status: 'pending' } }),
      db.hubMentorshipRequest.findMany({
        where: {
          mentorId: user.id,
          status: { in: ['accepted', 'completed'] },
          decidedAt: { gte: termStart(now) },
        },
        distinct: ['studentId'],
        select: { studentId: true },
      }),
      db.hubMentorSlot.findFirst({
        where: {
          mentorId: user.id,
          status: 'booked',
          startsAt: { gte: now },
          requests: { some: { status: 'accepted' } },
        },
        orderBy: { startsAt: 'asc' },
        select: { startsAt: true },
      }),
    ]);
    return {
      kind: 'mentor',
      pendingRequests,
      menteesThisTerm: mentees.length,
      nextSessionAt: next ? next.startsAt.toISOString() : null,
    };
  }

  async function admin(): Promise<Summary> {
    const [resourcesTotal, resourcesThisWeek, all] = await Promise.all([
      db.hubResource.count({ where: { deletedAt: null } }),
      db.hubResource.count({ where: { deletedAt: null, createdAt: { gte: weekOf().start } } }),
      mentors.candidates(db, {}),
    ]);
    return {
      kind: 'admin',
      resourcesTotal,
      resourcesThisWeek,
      mentorsNearCapacity: all.filter(
        (c) => c.capacity > 0 && c.mentees >= config.nearCapacityShare * c.capacity,
      ).length,
    };
  }

  return (user: User): Promise<Summary> =>
    user.role === 'admin' ? admin() : user.role === 'mentor' ? mentor(user) : student(user);
}
