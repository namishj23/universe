// Everything the hub shares with, or asks of, other modules, all through the platform:
// its publicApi (sessions, weekly goal), the dashboard's week items, the ride link to a mentor
// session (rides), the stop check for slots (rides) and the opt-in focus minutes (wellbeing).
import {
  istDate,
  weekOf,
  type PublicApiImpl,
  type PublicUser,
  type WeekProviderItem,
} from '@universe/contracts';
import type { Platform } from '../../platform/modules/index.js';
import type { PrepService } from './prep.js';
import { errors, isMentor, type Db, type User } from './shared.js';

const IST_MS = 330 * 60_000;
/** The ride link asks to arrive this long before the session starts. */
export const RIDE_LEAD_MINUTES = 15;

const istClock = (d: Date) => new Date(d.getTime() + IST_MS).toISOString().slice(11, 16);

/** `/rides?to=…&date=…&arriveBy=…`: a ride that arrives 15 minutes before `startsAt` (IST). */
export const rideLinkFor = (stopId: string, startsAt: Date) => {
  const arrive = new Date(startsAt.getTime() - RIDE_LEAD_MINUTES * 60_000);
  const q = new URLSearchParams({ to: stopId, date: istDate(arrive), arriveBy: istClock(arrive) });
  return { href: `/rides?${q.toString()}` };
};

export function integration(p: Platform, prep: PrepService) {
  const db = p.prisma;
  const E = errors(p);

  /** 422 unless rides knows the stop. Without the rides module no stop can be checked. */
  async function assertStop(user: User, stopId: string) {
    const stop = await p.modules.get('rides')?.findStop({ actor: user, stopId });
    if (!stop) throw E.fail(422, 'STOP_NOT_FOUND', 'That stop is not on the campus ride map.');
  }

  /** Ride links for the given stops (only stops a car can reach); failures just mean none. */
  async function drivableStops(user: User, stopIds: readonly string[]) {
    const rides = p.modules.get('rides');
    const ids = [...new Set(stopIds)];
    if (!rides || ids.length === 0) return new Set<string>();
    const found = await Promise.all(
      ids.map((stopId) => rides.findStop({ actor: user, stopId }).catch(() => null)),
    );
    return new Set(found.flatMap((s) => (s?.drivable ? [s.id] : [])));
  }

  /** `{ focusStudyMinutesThisWeek }` only when the student shares it (wellbeing decides). */
  async function focus(user: User): Promise<{ focusStudyMinutesThisWeek?: number }> {
    try {
      const minutes = await p.modules
        .get('wellbeing')
        ?.studyMinutesThisWeek({ actor: user, userId: user.id });
      return typeof minutes === 'number' ? { focusStudyMinutesThisWeek: minutes } : {};
    } catch {
      return {};
    }
  }

  const sessionInclude = {
    slot: true,
    student: { select: { user: { select: { name: true } } } },
    mentor: { select: { user: { select: { name: true } } } },
  } as const;

  /**
   * Accepted sessions the user is a party to, starting in [from, to), soonest first. Two
   * queries (as student, as mentor) so each side seeks its own index instead of an OR scan.
   */
  async function acceptedSessions(x: Db, userId: string, from: Date, to: Date) {
    const side = (party: 'studentId' | 'mentorId') =>
      x.hubMentorshipRequest.findMany({
        where: { status: 'accepted', [party]: userId, slot: { startsAt: { gte: from, lt: to } } },
        include: sessionInclude,
        take: 100,
      });
    const rows = (await Promise.all([side('studentId'), side('mentorId')])).flat();
    const start = (r: (typeof rows)[number]) => r.slot?.startsAt.getTime() ?? 0;
    return rows.sort((a, b) => start(a) - start(b)).slice(0, 100);
  }

  const publicApi: PublicApiImpl<'hub'> = {
    async sessionsForUser({ actor, from, to }) {
      const rows = await acceptedSessions(db, actor.id, from, to);
      return rows.flatMap((r) =>
        r.slot
          ? [
              {
                requestId: r.id,
                startsAt: r.slot.startsAt,
                endsAt: r.slot.endsAt,
                as: r.studentId === actor.id ? ('student' as const) : ('mentor' as const),
                withName: r.studentId === actor.id ? r.mentor.user.name : r.student.user.name,
                locationLabel: r.slot.locationLabel,
                locationStopId: r.slot.locationStopId,
              },
            ]
          : [],
      );
    },
    async weeklyGoal({ actor }) {
      if (actor.role !== 'student') return null;
      const view = await prep.get(actor.id);
      if (view.tracks.length === 0) return null;
      const { target, done, left, weekEndsAt } = view.week;
      return { target, done, left, weekEndsAt: new Date(weekEndsAt) };
    },
  };

  /** The week strip: sessions, the Saturday goal deadline, a mentor's waiting requests. */
  async function weekItems(user: PublicUser, range: { from: Date; to: Date }) {
    if (user.role === 'admin') return [];
    const profile =
      user.role === 'student'
        ? await db.hubProfile.findUnique({ where: { userId: user.id } })
        : null;
    const mentoring = isMentor(user.role, profile);
    const [sessions, pending, tentative, goal] = await Promise.all([
      acceptedSessions(db, user.id, range.from, range.to),
      mentoring
        ? db.hubMentorshipRequest.count({ where: { mentorId: user.id, status: 'pending' } })
        : 0,
      mentoring
        ? db.hubMentorshipRequest.findMany({
            where: {
              mentorId: user.id,
              status: 'pending',
              slot: { startsAt: { gte: range.from, lt: range.to } },
            },
            include: sessionInclude,
            take: 20,
          })
        : [],
      user.role === 'student'
        ? publicApi.weeklyGoal({ actor: user }, AbortSignal.timeout(1500))
        : null,
    ]);
    const items: WeekProviderItem[] = [];
    if (pending > 0)
      items.push({
        at: new Date().toISOString(),
        title: `${pending} mentorship ${pending === 1 ? 'request' : 'requests'}`,
        status: { label: 'waiting', tone: 'warn' },
        confirmed: true,
        href: '/hub/requests',
      });
    for (const r of sessions) {
      if (!r.slot) continue;
      const asStudent = r.studentId === user.id;
      items.push({
        at: r.slot.startsAt.toISOString(),
        title: asStudent
          ? `Mentor session, ${r.mentor.user.name}`
          : `Session with ${r.student.user.name}`,
        status: asStudent ? { label: 'accepted', tone: 'ok' } : { label: 'confirmed', tone: 'ok' },
        confirmed: true,
        href: asStudent ? '/hub/mentors' : '/hub/requests',
      });
    }
    for (const r of tentative)
      if (r.slot)
        items.push({
          at: r.slot.startsAt.toISOString(),
          title: `Session with ${r.student.user.name}`,
          status: { label: 'tentative', tone: 'warn' },
          confirmed: false,
          href: '/hub/requests',
        });
    if (goal) {
      // All day on Saturday, the week's last day (Asia/Kolkata).
      const saturday = new Date(weekOf().end.getTime() - 86_400_000);
      items.push({
        at: saturday.toISOString(),
        allDay: true,
        title: `Prep goal ends, ${goal.left} left`,
        confirmed: true,
        href: '/hub/prep',
      });
    }
    return items.slice(0, 50);
  }

  return { assertStop, drivableStops, focus, publicApi, weekItems };
}

export type Integration = ReturnType<typeof integration>;
