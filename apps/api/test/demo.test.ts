// The demo seed tells one story across platform, hub, rides and wellbeing (P6), and
// `npm run demo:reset` rebuilds it. Runs the real seed against universe_test.
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ActivityEvent,
  istDate,
  rides,
  WeekResponse,
  WEEKLY_SUMMARY_TEXT,
  type WeekItem,
} from '@universe/contracts';
import { Prisma } from '../src/generated/prisma/client.js';
import { createApp } from '../src/app.js';
import { prisma } from '../src/platform/db.js';
import { loadModules, type ModuleDefinition } from '../src/platform/modules/index.js';
import { INACTIVE_ACCOUNT } from '../../../prisma/seed/platform.js';
import {
  MODULE_PREFIXES,
  MODULE_TABLES,
  resetDemoData,
  resetPlan,
  resetRefusal,
} from '../../../prisma/seed/reset.js';
import { runSeed } from '../../../prisma/seed/run.js';
import { ANNOUNCEMENT_TEXT } from '../../../prisma/seed/story.js';
import { as, login, PASSWORD } from './helpers.js';

let modules: ModuleDefinition[];
const DAY = 86_400_000;
const dayOf = (offset: number) => istDate(new Date(Date.now() + offset * DAY));

beforeAll(async () => {
  modules = await loadModules();
  await runSeed(PASSWORD);
});

const signIn = async (email: string) => {
  const s = await login(email, createApp({ modules }));
  return { ...s, http: as(s) };
};

/** Every week item with its date. */
async function week(email: string) {
  const s = await signIn(email);
  const res = await s.http.get('/api/dashboard/week').expect(200);
  const body = WeekResponse.parse(res.body);
  expect(body.modules.every((m) => m.status === 'ok')).toBe(true);
  return body.days.flatMap((d) => d.items.map((item) => ({ date: d.date, ...item })));
}
const at = (i: WeekItem) => ('time' in i ? i.time : 'all day');

describe('Aarav (student)', () => {
  it('has the design’s week strip', async () => {
    const items = await week('student@universe.test');
    const find = (title: string) => items.filter((i) => i.title === title);
    expect(find('Tracking paused')).toMatchObject([{ date: dayOf(0), module: 'wellbeing' }]);
    const tomorrow = items.filter((i) => i.date === dayOf(1) && i.module === 'rides');
    expect(tomorrow.map((i) => [at(i), i.title, i.status?.label, i.confirmed])).toEqual([
      ['08:10', 'Ride to SPIT', 'confirmed', true],
      ['17:30', 'Return ride', 'searching', false],
    ]);
    expect(find('Prep goal ends, 6 left')).toMatchObject([
      { module: 'hub', allDay: true, confirmed: true, href: '/hub/prep' },
    ]);
    const summary = find('Weekly summary');
    expect(summary).toMatchObject([{ module: 'wellbeing', time: '09:00' }]);
    expect(new Date(`${summary[0]?.date}T12:00:00Z`).getUTCDay()).toBe(0);
    const session = find('Mentor session, Prof. Neha Iyer');
    expect(session).toMatchObject([
      { module: 'hub', time: '15:30', status: { label: 'accepted', tone: 'ok' } },
    ]);
    expect(new Date(`${session[0]?.date}T12:00:00Z`).getUTCDay()).toBe(1);
    // His seat request on Neha's 08:30 from Malad (the design's driver view) is unconfirmed.
    expect(items.filter((i) => i.date === dayOf(2) && i.module === 'rides')).toMatchObject([
      { title: 'Ride to SPIT', status: { label: 'requested' }, confirmed: false },
    ]);
    expect(items.every((i) => i.href.startsWith('/'))).toBe(true);
  });

  it('has the design’s inbox, newest first, three unread', async () => {
    const s = await signIn('student@universe.test');
    const res = await s.http.get('/api/activity?limit=20').expect(200);
    const events = (res.body as { items: unknown[] }).items.map((e) => ActivityEvent.parse(e));
    expect(events.map((e) => [e.type, e.actor?.name ?? null, e.readAt === null])).toEqual([
      ['platform.announcement', 'Admin Office', true],
      ['rides.seat_accepted', 'Diya Kulkarni', true],
      ['hub.request_accepted', 'Prof. Neha Iyer', true],
      ['wellbeing.weekly_summary', null, false],
      ['platform.announcement', null, false],
    ]);
    expect(events.map((e) => (e.payload as { message?: string }).message)).toEqual([
      ANNOUNCEMENT_TEXT,
      undefined,
      undefined,
      WEEKLY_SUMMARY_TEXT,
      'Welcome to UniVerse.',
    ]);
    const today = istDate(new Date());
    expect(events.slice(1, 3).every((e) => istDate(new Date(e.createdAt)) === today)).toBe(true);
    expect(Date.now() - Date.parse(events[0]!.createdAt)).toBeCloseTo(2 * 3_600_000, -5);
    const unread = await s.http.get('/api/activity/unread-count').expect(200);
    expect(unread.body).toEqual({ count: 3 });
  });

  it('sees Diya joined, Kabir and Ishita eligible and one offer hidden by time', async () => {
    const s = await signIn('student@universe.test');
    const tomorrow810 = await prisma.ridesRequest.findFirstOrThrow({
      where: { userId: s.user.id, status: 'matched', pickupAt: { gt: new Date() } },
    });
    const res = await s.http
      .get(`/api/rides/offers/matches?requestId=${tomorrow810.id}`)
      .expect(200);
    const body = rides.OfferMatches.parse(res.body);
    expect(
      body.matches.map((m) => [m.driverFirstName, m.booking?.status ?? null, m.eligible]),
    ).toEqual([
      ['Diya', 'accepted', true],
      ...(body.matches[1]?.driverFirstName === 'Ishita'
        ? [
            ['Ishita', null, true],
            ['Kabir', null, true],
          ]
        : [
            ['Kabir', null, true],
            ['Ishita', null, true],
          ]),
    ]);
    expect(body.matches[0]).toMatchObject({ seatsLeft: 1, vehicleType: 'car' });
    expect(body.matches.find((m) => m.driverFirstName === 'Kabir')?.minutesApart).toBe(7);
    expect(body.hidden).toMatchObject({ total: 1, reasons: [{ reason: 'time', count: 1 }] });
  });

  it('has a ride link on the Monday session', async () => {
    const s = await signIn('student@universe.test');
    const res = await s.http.get('/api/hub/requests/mine').expect(200);
    const accepted = (
      res.body as { items: { status: string; rideLink: unknown; slot: { startsAt: string } }[] }
    ).items.find((r) => r.status === 'accepted');
    const stop = await prisma.ridesNode.findFirstOrThrow({ where: { name: 'SPIT Main Gate' } });
    expect(accepted?.rideLink).toEqual({
      href: `/rides?to=${stop.id}&date=${istDate(new Date(accepted?.slot.startsAt ?? 0))}&arriveBy=15%3A15`,
    });
  });
});

describe('the rest of the cast', () => {
  it('Neha’s week: waiting requests, Aarav’s session, Diya tentative, her drives', async () => {
    const items = await week('mentor@universe.test');
    const titles = items.map((i) => [i.title, i.status?.label, i.confirmed]);
    expect(titles).toContainEqual(['2 mentorship requests', 'waiting', true]);
    expect(titles).toContainEqual(['Session with Aarav Mehta', 'confirmed', true]);
    expect(titles).toContainEqual(['Session with Diya Kulkarni', 'tentative', false]);
    expect(titles).toContainEqual(['Driving from Malad', '1 of 3 seats', true]);
    expect(titles).toContainEqual(['Driving from Borivali Station', '0 of 3 seats', true]);
  });

  it('Neha’s 08:30 from Malad: Ishita accepted, Kabir and Aarav requesting', async () => {
    const s = await signIn('mentor@universe.test');
    const res = await s.http.get('/api/rides/offers/mine').expect(200);
    const malad = (res.body as { items: unknown[] }).items
      .map((o) => rides.OfferView.parse(o))
      .find((o) => o.origin.name === 'Malad');
    expect(malad?.bookings.map((b) => [b.passengerFirstName, b.status]).sort()).toEqual([
      ['Aarav', 'requested'],
      ['Ishita', 'accepted'],
      ['Kabir', 'requested'],
    ]);
    // Ishita also offers her own ride, on another day.
    const ishita = await prisma.user.findUniqueOrThrow({
      where: { email: 'ishita.rao@universe.test' },
    });
    const own = await prisma.ridesOffer.findFirstOrThrow({ where: { driverId: ishita.id } });
    expect(istDate(own.departAt)).not.toBe(istDate(new Date(malad?.departAt ?? 0)));
  });

  it('Diya drives a three-seat car without women-only rides; Sneha rides women-only', async () => {
    const [diya, sneha] = await Promise.all(
      ['student2@universe.test', 'sneha.patil@universe.test'].map((email) =>
        prisma.user.findUniqueOrThrow({
          where: { email },
          include: { ridesProfile: true, ridesDriver: { include: { vehicle: true } } },
        }),
      ),
    );
    expect(diya?.ridesProfile).toMatchObject({ gender: 'female', womenOnlyGroups: false });
    expect(diya?.ridesDriver).toMatchObject({ kind: 'carpool', status: 'approved' });
    expect(diya?.ridesDriver?.vehicle).toMatchObject({ vehicleType: 'car', seats: 3 });
    expect(sneha?.ridesProfile).toMatchObject({ gender: 'female', womenOnlyGroups: true });
    const approved = await prisma.ridesDriver.findMany({
      where: { kind: 'carpool', status: 'approved' },
      include: { user: { select: { name: true } } },
    });
    expect(approved.map((d) => d.user.name).sort()).toEqual([
      'Diya Kulkarni',
      'Ishita Rao',
      'Kabir Shah',
      'Prof. Neha Iyer',
    ]);
  });

  it('keeps the completed shared ride that feeds Aarav’s savings', async () => {
    const s = await signIn('student@universe.test');
    const res = await s.http.get('/api/rides/stats/me').expect(200);
    const { totals } = rides.RidesStatsReport.parse(res.body);
    expect(totals).toMatchObject({ carpoolTrips: 1 });
    expect(totals.savingsPaise).toBeGreaterThan(0);
  });

  it('shows one inactive account, which cannot sign in', async () => {
    const admin = await signIn('admin@universe.test');
    const res = await admin.http.get(`/api/admin/users?q=${INACTIVE_ACCOUNT.name}`).expect(200);
    expect(res.body).toMatchObject({ items: [{ email: INACTIVE_ACCOUNT.email, isActive: false }] });
    await request(createApp({ modules }))
      .post('/api/auth/login')
      .send({ email: INACTIVE_ACCOUNT.email, password: PASSWORD })
      .expect(401);
  });

  it('only uses @universe.test addresses', async () => {
    expect(
      await prisma.user.count({ where: { NOT: { email: { endsWith: 'universe.test' } } } }),
    ).toBe(0);
  });
});

describe('npm run demo:reset', () => {
  it('refuses anything but a local universe / universe_test with the matching NODE_ENV', () => {
    const url = (host: string, db: string) => `postgresql://u:p@${host}:5432/${db}`;
    expect(resetRefusal(url('localhost', 'universe'), 'development')).toBeNull();
    expect(resetRefusal(url('127.0.0.1', 'universe_test'), 'test')).toBeNull();
    expect(resetRefusal(url('db.example.com', 'universe'), 'development')).toMatch(/host/);
    expect(resetRefusal(url('localhost', 'universe'), 'test')).toMatch(/Refusing/);
    expect(resetRefusal(url('localhost', 'universe_test'), 'development')).toMatch(/Refusing/);
    expect(resetRefusal(url('localhost', 'universe'), 'production')).toMatch(/Refusing/);
    expect(resetRefusal(undefined, 'development')).toMatch(/missing/);
  });

  it('lists every hub, rides and wellbeing table', () => {
    const owned = Object.values(Prisma.ModelName).filter((m) =>
      MODULE_PREFIXES.some((p) => m.startsWith(p)),
    );
    expect([...MODULE_TABLES].sort()).toEqual(owned.sort());
  });

  it('is idempotent: seeding again adds nothing', async () => {
    const before = await resetPlan(prisma);
    await runSeed(PASSWORD);
    expect(await resetPlan(prisma)).toEqual(before);
  });

  it('empties module tables and the feed, keeps users, sessions and the audit log, reseeds', async () => {
    const admin = await signIn('admin@universe.test');
    const kept = async () => ({
      users: await prisma.user.count(),
      audit: await prisma.auditLog.count(),
      sessions: await prisma.session.count(),
    });
    const before = await kept();
    expect(before.audit).toBeGreaterThan(0);
    const plan = await resetPlan(prisma);
    expect(plan.tables.find((t) => t.name === 'RidesOffer')?.rows).toBeGreaterThan(0);

    await resetDemoData(prisma);
    const empty = await resetPlan(prisma);
    expect(empty.tables.every((t) => t.rows === 0)).toBe(true);
    expect(empty.activityEvents).toBe(0);
    expect(empty.files).toBe(0);
    expect(await kept()).toEqual(before);
    await admin.http.get('/api/auth/me').expect(200); // the person running it stays signed in

    await runSeed(PASSWORD);
    const again = await resetPlan(prisma);
    expect(again.tables.map((t) => t.rows)).toEqual(plan.tables.map((t) => t.rows));
    expect(again.activityEvents).toBe(plan.activityEvents);
  });
});
