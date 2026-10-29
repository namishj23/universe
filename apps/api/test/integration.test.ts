// P6: modules reach each other only through `platform.modules.get(id)` (validated, 500 ms,
// never another module's tables), the week strip's providers, and the cross-module features.
import { Router } from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ApiErrorBody,
  hub,
  istDate,
  weekOf,
  WeekResponse,
  type PublicUser,
} from '@universe/contracts';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/platform/auth/password.js';
import { prisma } from '../src/platform/db.js';
import {
  loadModules,
  validateModules,
  type ModuleDefinition,
} from '../src/platform/modules/index.js';
import {
  createPlatform,
  installModules,
  platform as sharedPlatform,
  PUBLIC_CALL_TIMEOUT_MS,
} from '../src/platform/modules/platform.js';
import { runSeed } from '../../../prisma/seed/run.js';
import { as, login, PASSWORD } from './helpers.js';

let modules: ModuleDefinition[];
const idOf = async (email: string) =>
  (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
const actor = async (email: string) => {
  const u = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { id: u.id, role: u.role } as Pick<PublicUser, 'id' | 'role'>;
};

beforeAll(async () => {
  modules = await loadModules();
  await runSeed(PASSWORD);
});

const signIn = async (email: string, mods = modules) => {
  const s = await login(email, createApp({ modules: mods }));
  return { ...s, http: as(s) };
};

let n = 0;
/** A new student with no hub, rides or wellbeing history, signed in. */
async function freshStudent() {
  n += 1;
  const email = `fresh${n}.${Date.now()}@universe.test`;
  await prisma.user.create({
    data: {
      email,
      name: `Fresh Student ${n}`,
      role: 'student',
      passwordHash: await hashPassword(PASSWORD),
    },
  });
  return signIn(email);
}

const fakeWellbeing = (impl: (input: unknown) => Promise<unknown>): ModuleDefinition => ({
  id: 'wellbeing',
  label: 'Wellbeing',
  order: 30,
  roles: ['student'],
  router: Router(),
  publicApi: { studyMinutesThisWeek: impl },
});

describe('platform.modules.get', () => {
  it('returns another module’s read-only functions, or undefined when it is not installed', () => {
    const p = sharedPlatform();
    expect(Object.keys(p.modules.get('rides') ?? {}).sort()).toEqual([
      'findStop',
      'searchStops',
      'upcomingForUser',
    ]);
    expect(Object.keys(p.modules.get('hub') ?? {}).sort()).toEqual([
      'sessionsForUser',
      'weeklyGoal',
    ]);
    expect(createPlatform().modules.get('rides')).toBeUndefined();
  });

  it('validates input and output at the boundary', async () => {
    const rides = sharedPlatform().modules.get('rides')!;
    const a = await actor('student@universe.test');
    await expect(rides.findStop({ actor: a, stopId: 'not-a-stop' })).rejects.toThrow(
      /invalid input/,
    );
    await expect(
      rides.findStop({ actor: a, stopId: '00000000-0000-0000-0000-000000000000' }),
    ).resolves.toBeNull();

    const p = createPlatform();
    installModules(p, [fakeWellbeing(() => Promise.resolve(-5))]);
    await expect(
      p.modules.get('wellbeing')!.studyMinutesThisWeek({ actor: a, userId: a.id }),
    ).rejects.toMatchObject({ status: 503, code: 'MODULE_UNAVAILABLE' });
  });

  it('gives up after 500 ms with 503 MODULE_UNAVAILABLE, and a throwing module the same', async () => {
    const a = await actor('student@universe.test');
    const p = createPlatform();
    installModules(p, [fakeWellbeing(() => new Promise((r) => setTimeout(() => r(1), 2_000)))]);
    const started = Date.now();
    await expect(
      p.modules.get('wellbeing')!.studyMinutesThisWeek({ actor: a, userId: a.id }),
    ).rejects.toMatchObject({ status: 503, code: 'MODULE_UNAVAILABLE' });
    expect(Date.now() - started).toBeLessThan(PUBLIC_CALL_TIMEOUT_MS + 300);

    installModules(p, [fakeWellbeing(() => Promise.reject(new Error('boom')))]);
    await expect(
      p.modules.get('wellbeing')!.studyMinutesThisWeek({ actor: a, userId: a.id }),
    ).rejects.toMatchObject({ status: 503 });
  });

  it('refuses a module whose publicApi is not exactly its contract', () => {
    const def = fakeWellbeing(() => Promise.resolve(null));
    expect(() =>
      validateModules([
        { folder: 'wellbeing', value: { ...def, publicApi: { other: () => Promise.resolve(1) } } },
      ]),
    ).toThrow(/publicApi must implement exactly studyMinutesThisWeek/);
    expect(() =>
      validateModules([
        {
          folder: 'exam',
          value: { ...def, id: 'exam', publicApi: { x: () => Promise.resolve(1) } },
        },
      ]),
    ).toThrow(/publicApiRegistry/);
  });
});

describe('rides publicApi', () => {
  it('finds and searches stops by name, short name or id', async () => {
    const rides = sharedPlatform().modules.get('rides')!;
    const a = await actor('mentor@universe.test');
    const gate = await prisma.ridesNode.findFirstOrThrow({ where: { name: 'SPIT Main Gate' } });
    expect(await rides.findStop({ actor: a, stopId: gate.id })).toEqual({
      id: gate.id,
      name: 'SPIT Main Gate',
      shortName: 'MAIN GATE',
      area: 'campus',
      drivable: true,
    });
    expect((await rides.searchStops({ actor: a, q: 'library' }))[0]).toMatchObject({
      name: 'Library',
      drivable: false,
    });
    expect((await rides.searchStops({ actor: a, q: 'BORIVALI' }))[0]?.name).toBe(
      'Borivali Station',
    );
    expect((await rides.searchStops({ actor: a, q: gate.id }))[0]?.id).toBe(gate.id);
    expect(await rides.searchStops({ actor: a, q: 'nowhere at all' })).toEqual([]);
  });

  it('upcomingForUser returns only the actor’s own rides', async () => {
    const rides = sharedPlatform().modules.get('rides')!;
    const from = new Date();
    const to = new Date(from.getTime() + 8 * 86_400_000);
    const aarav = await rides.upcomingForUser({
      actor: await actor('student@universe.test'),
      from,
      to,
    });
    expect(aarav.map((r) => [r.kind, r.status]).sort()).toEqual([
      ['booking', 'confirmed'],
      ['booking', 'requested'],
      ['request', 'searching'],
    ]);
    expect(aarav.find((r) => r.status === 'confirmed')?.driverName).toBe('Diya Kulkarni');
    const kabir = await rides.upcomingForUser({
      actor: await actor('kabir.shah@universe.test'),
      from,
      to,
    });
    expect(kabir.filter((r) => r.kind === 'offer')).toHaveLength(2);
    expect(kabir.some((r) => r.driverName === 'Diya Kulkarni')).toBe(false);
  });
});

describe('hub publicApi', () => {
  it('sessionsForUser and weeklyGoal show only the actor’s own', async () => {
    const api = sharedPlatform().modules.get('hub')!;
    const from = new Date();
    const to = new Date(from.getTime() + 8 * 86_400_000);
    const mine = await api.sessionsForUser({
      actor: await actor('student@universe.test'),
      from,
      to,
    });
    expect(mine.map((s) => [s.as, s.withName])).toEqual([['student', 'Prof. Neha Iyer']]);
    const neha = await api.sessionsForUser({
      actor: await actor('mentor@universe.test'),
      from,
      to,
    });
    expect(neha.map((s) => [s.as, s.withName])).toEqual([['mentor', 'Aarav Mehta']]);
    const stranger = await freshStudent();
    expect(await api.sessionsForUser({ actor: stranger.user, from, to })).toHaveLength(0);
    expect(await api.weeklyGoal({ actor: await actor('student@universe.test') })).toMatchObject({
      target: 20,
      done: 14,
      left: 6,
    });
    expect(await api.weeklyGoal({ actor: await actor('mentor@universe.test') })).toBeNull();
  });
});

describe('wellbeing publicApi', () => {
  it('studyMinutesThisWeek: a number only for yourself with sharing on; a mentor gets null', async () => {
    const api = sharedPlatform().modules.get('wellbeing')!;
    const aarav = await actor('student@universe.test');
    const neha = await actor('mentor@universe.test');
    expect(await api.studyMinutesThisWeek({ actor: aarav, userId: aarav.id })).toBeNull();
    await prisma.wbSettings.update({
      where: { userId: aarav.id },
      data: { shareStudyWithHub: true },
    });
    try {
      expect(await api.studyMinutesThisWeek({ actor: aarav, userId: aarav.id })).toEqual(
        expect.any(Number),
      );
      expect(await api.studyMinutesThisWeek({ actor: neha, userId: aarav.id })).toBeNull();
      const admin = await actor('admin@universe.test');
      expect(await api.studyMinutesThisWeek({ actor: admin, userId: aarav.id })).toBeNull();
    } finally {
      await prisma.wbSettings.update({
        where: { userId: aarav.id },
        data: { shareStudyWithHub: false },
      });
    }
  });
});

describe('week providers', () => {
  const weekFor = async (email: string, mods = modules) => {
    const s = await signIn(email, mods);
    return WeekResponse.parse((await s.http.get('/api/dashboard/week').expect(200)).body);
  };

  it('a role sees items only from the modules it may use', async () => {
    const student = await weekFor('student@universe.test');
    expect(student.modules.map((m) => m.id)).toEqual(['hub', 'rides', 'wellbeing']);
    const admin = await weekFor('admin@universe.test');
    expect(admin.modules.map((m) => m.id)).toEqual(['hub', 'rides']);
    expect(admin.days.flatMap((d) => d.items)).toEqual([]);
    const driver = await weekFor('ramesh.patil@drivers.universe.test');
    expect(driver.modules.map((m) => m.id)).toEqual(['rides']);
    const invigilator = await weekFor('invigilator@universe.test');
    expect(invigilator.modules).toEqual([]);
    expect(invigilator.days.flatMap((d) => d.items)).toEqual([]);
  });

  it('isolates a failing provider', async () => {
    const broken = modules.map((m) =>
      m.id === 'rides' ? { ...m, weekItems: () => Promise.reject(new Error('down')) } : m,
    );
    const body = await weekFor('student@universe.test', broken);
    expect(body.modules).toEqual([
      { id: 'hub', status: 'ok' },
      { id: 'rides', status: 'error' },
      { id: 'wellbeing', status: 'ok' },
    ]);
    const items = body.days.flatMap((d) => d.items);
    expect(items.some((i) => i.module === 'rides')).toBe(false);
    expect(items.some((i) => i.module === 'hub')).toBe(true);
  });

  it('works without the rides module (and hub then can’t name stops)', async () => {
    const p = createPlatform();
    const all = await loadModules({ platform: p });
    const noRides = all.filter((m) => m.id !== 'rides');
    installModules(p, noRides);
    const body = await weekFor('student@universe.test', noRides);
    expect(body.modules.map((m) => m.id)).toEqual(['hub', 'wellbeing']);

    const mentor = await signIn('arjun.menon@universe.test', noRides);
    const gate = await prisma.ridesNode.findFirstOrThrow({ where: { name: 'SPIT Main Gate' } });
    const startsAt = new Date(Date.now() + 9 * 86_400_000);
    const slot = (locationStopId?: string) => ({
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + 3_600_000).toISOString(),
      ...(locationStopId && { locationStopId }),
    });
    const res = await mentor.http.post('/api/hub/slots').send(slot(gate.id)).expect(422);
    expect(ApiErrorBody.parse(res.body).error.code).toBe('STOP_NOT_FOUND');
    await mentor.http.post('/api/hub/slots').send(slot()).expect(201);
  });
});

describe('Student Hub → Rides', () => {
  it('validates a slot’s stop through rides.findStop', async () => {
    const mentor = await signIn('sameer.joshi@universe.test');
    const gate = await prisma.ridesNode.findFirstOrThrow({ where: { name: 'SPIT Main Gate' } });
    const startsAt = new Date(Date.now() + 10 * 86_400_000);
    const body = (locationStopId: string) => ({
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + 3_600_000).toISOString(),
      locationStopId,
    });
    const bad = await mentor.http
      .post('/api/hub/slots')
      .send(body('11111111-2222-3333-4444-555555555555'))
      .expect(422);
    expect(ApiErrorBody.parse(bad.body).error.code).toBe('STOP_NOT_FOUND');
    const ok = await mentor.http.post('/api/hub/slots').send(body(gate.id)).expect(201);
    expect(hub.MySlot.parse(ok.body).locationStopId).toBe(gate.id);
  });

  it('gives accepted sessions at a drivable stop a ride link 15 minutes early; walk-only stops none', async () => {
    const kavita = await signIn('kavita.nair@universe.test');
    const student = await freshStudent();
    const library = await prisma.ridesNode.findFirstOrThrow({ where: { name: 'Library' } });
    const gate = await prisma.ridesNode.findFirstOrThrow({ where: { name: 'SPIT Main Gate' } });
    const kavitaId = await idOf('kavita.nair@universe.test');
    // Kavita is at capacity in the seed: make room for this check.
    await prisma.hubProfile.update({ where: { userId: kavitaId }, data: { mentorCapacity: 10 } });
    const link = async (stopId: string, days: number) => {
      const startsAt = new Date(Date.now() + days * 86_400_000);
      startsAt.setUTCSeconds(0, 0);
      const slot = hub.MySlot.parse(
        (
          await kavita.http
            .post('/api/hub/slots')
            .send({
              startsAt: startsAt.toISOString(),
              endsAt: new Date(startsAt.getTime() + 3_600_000).toISOString(),
              locationStopId: stopId,
            })
            .expect(201)
        ).body,
      );
      const { id } = hub.MentorshipRequest.parse(
        (
          await student.http
            .post('/api/hub/requests')
            .send({ mentorId: kavitaId, slotId: slot.id })
            .expect(201)
        ).body,
      );
      const accepted = hub.MentorshipRequest.parse(
        (await kavita.http.post(`/api/hub/requests/${id}/accept`).send({}).expect(200)).body,
      );
      await student.http.post(`/api/hub/requests/${id}/cancel`).send({}).expect(200);
      return { accepted, startsAt };
    };
    const atGate = await link(gate.id, 11);
    const arrive = new Date(atGate.startsAt.getTime() - 15 * 60_000);
    const hhmm = new Date(arrive.getTime() + 330 * 60_000).toISOString().slice(11, 16);
    expect(atGate.accepted.rideLink).toEqual({
      href: `/rides?to=${gate.id}&date=${istDate(arrive)}&arriveBy=${encodeURIComponent(hhmm)}`,
    });
    expect((await link(library.id, 12)).accepted.rideLink).toBeNull();
  });

  it('POST /api/rides/requests takes arriveBy instead of pickupTime (pickup = arrive − drive time)', async () => {
    const s = await signIn('rahul.verma@universe.test');
    const [from, to] = await Promise.all(
      ['Malad', 'SPIT Main Gate'].map((name) =>
        prisma.ridesNode.findFirstOrThrow({ where: { name } }),
      ),
    );
    const route = (await s.http.get(`/api/rides/route?from=${from!.id}&to=${to!.id}`).expect(200))
      .body as { durationS: number };
    const arriveBy = new Date(Date.now() + 3 * 86_400_000);
    arriveBy.setUTCSeconds(0, 0);
    const res = await s.http
      .post('/api/rides/requests')
      .send({ pickupNodeId: from!.id, dropNodeId: to!.id, arriveBy: arriveBy.toISOString() })
      .expect(201);
    const expected = Math.floor((arriveBy.getTime() - route.durationS * 1000) / 60_000) * 60_000;
    expect(Date.parse((res.body as { pickupTime: string }).pickupTime)).toBe(expected);

    const both = { pickupNodeId: from!.id, dropNodeId: to!.id };
    await s.http
      .post('/api/rides/requests')
      .send({ ...both, arriveBy: arriveBy.toISOString(), pickupTime: arriveBy.toISOString() })
      .expect(400);
    await s.http.post('/api/rides/requests').send(both).expect(400);
  });
});

describe('Wellbeing → Student Hub (opt-in)', () => {
  it('adds focusStudyMinutesThisWeek to prep and the dashboard only when shared, and nothing else', async () => {
    const s = await signIn('student@universe.test');
    const prep = async () =>
      (await s.http.get('/api/hub/prep').expect(200)).body as Record<string, unknown>;
    const card = async () =>
      (
        (await s.http.get('/api/dashboard').expect(200)).body as {
          modules: { id: string; data?: Record<string, unknown> }[];
        }
      ).modules.find((m) => m.id === 'hub')?.data;

    const off = await prep();
    expect(off).not.toHaveProperty('focusStudyMinutesThisWeek');
    expect(await card()).not.toHaveProperty('focusStudyMinutesThisWeek');

    await s.http.put('/api/wellbeing/settings').send({ shareStudyWithHub: true }).expect(200);
    const on = await prep();
    const week = await prisma.wbDailyTotal.aggregate({
      where: {
        userId: s.user.id,
        category: 'study',
        date: { gte: new Date(`${weekOf().startDate}T00:00:00Z`) },
      },
      _sum: { minutes: true },
    });
    expect(on.focusStudyMinutesThisWeek).toBe(week._sum.minutes ?? 0);
    expect(Object.keys(on).sort()).toEqual(
      [...Object.keys(off), 'focusStudyMinutesThisWeek'].sort(),
    );
    expect({ ...on, focusStudyMinutesThisWeek: undefined }).toEqual({
      ...off,
      focusStudyMinutesThisWeek: undefined,
    });
    expect((await card())?.focusStudyMinutesThisWeek).toBe(on.focusStudyMinutesThisWeek);

    // Study not counted: nothing, even with sharing on.
    await s.http
      .put('/api/wellbeing/settings')
      .send({ categories: ['communication', 'social', 'entertainment'] })
      .expect(200);
    expect(await prep()).not.toHaveProperty('focusStudyMinutesThisWeek');
    await s.http
      .put('/api/wellbeing/settings')
      .send({
        shareStudyWithHub: false,
        categories: ['study', 'communication', 'social', 'entertainment'],
      })
      .expect(200);
  });

  it('never shows the mentor a student’s focus minutes', async () => {
    const aarav = await signIn('student@universe.test');
    await aarav.http.put('/api/wellbeing/settings').send({ shareStudyWithHub: true }).expect(200);
    const neha = await signIn('mentor@universe.test');
    const incoming = await neha.http.get('/api/hub/requests/incoming').expect(200);
    expect(JSON.stringify(incoming.body)).not.toMatch(/focus|wellbeing|minutes/i);
    const student = await neha.http.get(`/api/hub/students/${aarav.user.id}`).expect(200);
    expect(JSON.stringify(student.body)).not.toMatch(/focus|wellbeing|minutes/i);
    await aarav.http.put('/api/wellbeing/settings').send({ shareStudyWithHub: false }).expect(200);
  });
});

it('every route still needs sign-in', async () => {
  await request(createApp({ modules })).get('/api/dashboard/week').expect(401);
});
