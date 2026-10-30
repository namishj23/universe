import { beforeAll, expect, it } from 'vitest';
import { DashboardResponse, HubDashboardSummary, weekOf } from '@universe/contracts';
import { prisma } from '../../src/platform/db.js';
import { account, setupHub, type Hub } from './helpers.js';

let h: Hub;
beforeAll(async () => {
  h = await setupHub();
});

const summary = async (email: string) => {
  const s = await account(h, email);
  const body = DashboardResponse.parse((await s.http.get('/api/dashboard').expect(200)).body);
  const entry = body.modules.find((m) => m.id === 'hub');
  expect(entry?.status).toBe('ok');
  return HubDashboardSummary.parse(entry?.data);
};

it('matches the seed for a student', async () => {
  expect(await summary('student@universe.test')).toMatchObject({
    kind: 'student',
    dsa: { solved: 118, total: 190, percent: 62 },
    // Resources 1, 2 and 4 days old: OS, DBMS, CN (tie → the most recent upload).
    newResources: { count: 3, topSubject: 'OS' },
    goal: { done: 14, target: 20 },
  });
});

it('matches the seed for a mentor', async () => {
  const s = await summary('mentor@universe.test');
  expect(s).toMatchObject({ kind: 'mentor', pendingRequests: 2, menteesThisTerm: 1 });
  const aaravSlot = await prisma.hubMentorSlot.findFirstOrThrow({
    where: { status: 'booked', mentor: { user: { email: 'mentor@universe.test' } } },
  });
  expect(s.kind === 'mentor' && s.nextSessionAt).toBe(aaravSlot.startsAt.toISOString());
});

it('matches the seed for an admin', async () => {
  const week = weekOf();
  const thisWeek = await prisma.hubResource.count({ where: { createdAt: { gte: week.start } } });
  expect(await summary('admin@universe.test')).toEqual({
    kind: 'admin',
    resourcesTotal: 6,
    resourcesThisWeek: thisWeek,
    // Kavita 5/8 and Neha 1/3 are below 80 %.
    mentorsNearCapacity: 0,
  });
});
