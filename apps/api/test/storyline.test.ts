// The demo storyline end to end through the API, against the seeded universe_test, with live
// SSE checks (docs/TEST-SCENARIOS.md "Storyline"). One test on purpose: each step builds on
// the last, as in the live demo.
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  ActivityEvent,
  AuditEntry,
  DashboardResponse,
  hub,
  rides,
  WeekResponse,
  wellbeing,
} from '@universe/contracts';
import { createApp } from '../src/app.js';
import { prisma } from '../src/platform/db.js';
import { loadModules, type ModuleDefinition } from '../src/platform/modules/index.js';
import { runSeed } from '../../../prisma/seed/run.js';
import { as, login, PASSWORD } from './helpers.js';
import { activityOf, openStream } from './sse.js';

let modules: ModuleDefinition[];
let server: Server;
let baseUrl: string;
const streams: { close: () => void }[] = [];

beforeAll(async () => {
  modules = await loadModules();
  await runSeed(PASSWORD);
  server = createApp({ modules }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  for (const s of streams) s.close();
  server.closeAllConnections();
  server.close();
});

/** Signs in (its own app instance: the login limiter is per instance) and opens a live stream. */
async function person(email: string) {
  const session = await login(email, createApp({ modules }));
  const stream = await openStream(baseUrl, session.cookie);
  streams.push(stream);
  await stream.next((m) => m.event === 'unread-count');
  return { ...session, http: as(session), stream };
}

it('runs the demo storyline across platform, hub, rides and wellbeing', async () => {
  // 1. Aarav signs in; the dashboard and his week show the seeded story.
  const aarav = await person('student@universe.test');
  const dashboard = DashboardResponse.parse(
    (await aarav.http.get('/api/dashboard').expect(200)).body,
  );
  expect(dashboard.unreadCount).toBe(3);
  expect(dashboard.modules.map((m) => [m.id, m.status])).toEqual([
    ['hub', 'ok'],
    ['rides', 'ok'],
    ['wellbeing', 'ok'],
  ]);
  const week = WeekResponse.parse((await aarav.http.get('/api/dashboard/week').expect(200)).body);
  const titles = week.days.flatMap((d) => d.items.map((i) => i.title));
  for (const title of [
    'Tracking paused',
    'Ride to SPIT',
    'Return ride',
    'Prep goal ends, 6 left',
    'Weekly summary',
    'Mentor session, Prof. Neha Iyer',
  ])
    expect(titles).toContain(title);

  // 2. He raises his DP progress and the mentor ranking changes.
  const ranking = async () =>
    hub.MentorList.parse((await aarav.http.get('/api/hub/mentors').expect(200)).body).items.map(
      (m) => [m.name, m.score] as const,
    );
  const before = await ranking();
  for (let i = 0; i < 4; i += 1)
    await aarav.http
      .post('/api/hub/prep/dsa-dp/increment')
      .set('Idempotency-Key', randomUUID())
      .send({ delta: 5 })
      .expect(200);
  const after = await ranking();
  // DP was his weakest topic and Neha's strongest match: with +20 solved she drops from #1.
  expect(before[0]?.[0]).toBe('Prof. Neha Iyer');
  expect(after[0]?.[0]).not.toBe('Prof. Neha Iyer');
  expect(after.map(([name]) => name)).toContain('Prof. Neha Iyer');

  // 3. He asks Neha for the Monday 15:30 slot (re-booking the seeded session) and she accepts;
  //    each side's stream gets the event live.
  const neha = await person('mentor@universe.test');
  const mine = hub.pages.requests.parse(
    (await aarav.http.get('/api/hub/requests/mine').expect(200)).body,
  );
  const seeded = mine.items.find(
    (r) => r.status === 'accepted' && r.mentor.name === 'Prof. Neha Iyer',
  );
  if (!seeded?.slot) throw new Error('the seed has no accepted session with Neha');
  await aarav.http.post(`/api/hub/requests/${seeded.id}/cancel`).send({}).expect(200);
  await neha.stream.next(activityOf('hub.request_cancelled'));
  const asked = hub.MentorshipRequest.parse(
    (
      await aarav.http
        .post('/api/hub/requests')
        .send({
          mentorId: seeded.mentor.id,
          slotId: seeded.slot.id,
          note: 'DP after my +20 this week.',
        })
        .expect(201)
    ).body,
  );
  await neha.stream.next(activityOf('hub.request_received', (p) => p.requestId === asked.id));
  await neha.http.post(`/api/hub/requests/${asked.id}/accept`).send({}).expect(200);
  await aarav.stream.next(activityOf('hub.request_accepted', (p) => p.requestId === asked.id));

  // 4. He follows the session's ride link and finds Kabir's offer to that campus stop.
  const session = hub.MentorshipRequest.parse(
    (await aarav.http.get(`/api/hub/requests/${asked.id}`).expect(200)).body,
  );
  if (!session.rideLink) throw new Error('no ride link on the accepted session');
  const link = new URL(session.rideLink.href, 'http://x');
  expect(link.pathname).toBe('/rides');
  const [to, date, arriveBy] = ['to', 'date', 'arriveBy'].map((k) => link.searchParams.get(k));
  expect(arriveBy).toBe('15:15');
  const borivali = await prisma.ridesNode.findFirstOrThrow({ where: { name: 'Borivali Station' } });
  const ride = (
    await aarav.http
      .post('/api/rides/requests')
      .send({ pickupNodeId: borivali.id, dropNodeId: to, arriveBy: `${date}T${arriveBy}:00+05:30` })
      .expect(201)
  ).body as { id: string };
  const matches = rides.OfferMatches.parse(
    (await aarav.http.get(`/api/rides/offers/matches?requestId=${ride.id}`).expect(200)).body,
  );
  const kabirsOffer = matches.matches.find((m) => m.driverFirstName === 'Kabir');
  expect(kabirsOffer).toMatchObject({ eligible: true, booking: null });
  expect(kabirsOffer?.dropNode.id).toBe(to);

  // 5. He asks to join; Kabir sees it live and accepts; Aarav sees that live.
  const kabir = await person('kabir.shah@universe.test');
  await aarav.http
    .post(`/api/rides/offers/${kabirsOffer?.offerId}/bookings`)
    .send({ requestId: ride.id })
    .expect(201);
  await kabir.stream.next(activityOf('rides.seat_requested'));
  const offer = rides.OfferView.parse(
    (await kabir.http.get(`/api/rides/offers/${kabirsOffer?.offerId}`).expect(200)).body,
  );
  const booking = offer.bookings.find((b) => b.passengerFirstName === 'Aarav');
  await kabir.http.post(`/api/rides/bookings/${booking?.id}/accept`).send({}).expect(200);
  await aarav.stream.next(activityOf('rides.seat_accepted'));
  const joined = rides.OfferMatches.parse(
    (await aarav.http.get(`/api/rides/offers/matches?requestId=${ride.id}`).expect(200)).body,
  );
  expect(joined.matches[0]).toMatchObject({
    driverFirstName: 'Kabir',
    booking: { status: 'accepted' },
  });

  // 6. Wellbeing: he resumes tracking, uploads today's totals, exports them, deletes everything.
  await aarav.http.post('/api/wellbeing/tracking').send({ state: 'on' }).expect(200);
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  await aarav.http
    .put('/api/wellbeing/totals')
    .send({ rows: [{ date: today, category: 'study', minutes: 120 }] })
    .expect(200);
  const exported = await aarav.http.get('/api/wellbeing/export').expect(200);
  expect(exported.headers['content-disposition']).toMatch(
    /wellbeing-export-\d{4}-\d{2}-\d{2}\.json/,
  );
  expect(JSON.stringify(exported.body)).toContain('"minutes":120');
  await aarav.http.delete('/api/wellbeing/data').send({ confirm: 'DELETE' }).expect(200);
  const summary = wellbeing.Summary.parse(
    (await aarav.http.get('/api/wellbeing/summary').expect(200)).body,
  );
  expect(summary).toMatchObject({ tracking: 'off', recordCount: 0 });

  // 7. The admin's announcement reaches every signed-in stream.
  const admin = await person('admin@universe.test');
  const driver = await person('ramesh.patil@drivers.universe.test');
  const message = `Storyline check ${randomUUID().slice(0, 8)}: lab 3 closed today.`;
  await admin.http.post('/api/activity/announcements').send({ message }).expect(200);
  for (const p of [aarav, neha, kabir, admin, driver])
    await p.stream.next(activityOf('platform.announcement', (x) => x.message === message));

  // 8. The audit log shows the admin and auth actions, and nothing from wellbeing.
  const audit = {
    items: (
      (await admin.http.get('/api/admin/audit?limit=100').expect(200)).body as { items: unknown[] }
    ).items.map((e) => AuditEntry.parse(e)),
  };
  const actions = new Set(audit.items.map((e) => e.action));
  expect(actions).toContain('auth.login');
  expect(actions).toContain('platform.announcement_sent');
  expect([...actions].some((a) => a.startsWith('wellbeing'))).toBe(false);
  expect(JSON.stringify(audit.items)).not.toMatch(/wellbeing|minutes|study/i);
  const events = await prisma.activityEvent.findMany({ where: { recipientId: aarav.user.id } });
  expect(events.every((e) => ActivityEvent.shape.type.safeParse(e.type).success)).toBe(true);
});

// Person 2's modules (Observatory, Exam) are not in the repo yet. When they ship, add their
// steps here through `platform.modules.get('observatory' | 'exam')` and their routes, e.g. the
// invigilator reviews a flag and the admin's audit log shows exam.flag_reviewed.
it.todo('Person 2 hook: Observatory and Exam steps through their publicApi');
