import { beforeAll, describe, expect, it } from 'vitest';
import { hub } from '@universe/contracts';
import { prisma } from '../../src/platform/db.js';
import {
  expectError,
  hoursFromNow,
  setupHub,
  slot,
  user,
  type Hub,
  type Session,
} from './helpers.js';

let h: Hub;
beforeAll(async () => {
  h = await setupHub();
});

const parse = (res: { body: unknown }) => hub.MentorshipRequest.parse(res.body);
const ask = (s: Session, mentor: Session, extra: object = {}) =>
  s.http.post('/api/hub/requests').send({ mentorId: mentor.user.id, ...extra });
const act = (s: Session, id: string, action: string, body: object = {}) =>
  s.http.post(`/api/hub/requests/${id}/${action}`).send(body);
const events = (userId: string, type: string) =>
  prisma.activityEvent.findMany({
    where: { recipientId: userId, type },
    orderBy: { createdAt: 'desc' },
  });

async function mentorWith(capacity = 3) {
  const m = await user(h, 'mentor', 'Test Mentor');
  await m.http
    .put('/api/hub/me')
    .send({ mentorExpertise: ['DP'], mentorCapacity: capacity, mentorDepartment: 'IT' })
    .expect(200);
  return m;
}

describe('mentorship lifecycle', () => {
  it('one-click request → mentor sees the student card → accept books the earliest open slot', async () => {
    const mentor = await mentorWith();
    const student = await user(h, 'student', 'Asha Student');
    await student.http
      .put('/api/hub/me')
      .send({ year: 'TE', branch: 'Computer Engineering' })
      .expect(200);
    await student.http
      .put('/api/hub/prep/topics')
      .send({ topicIds: ['dsa-dp'] })
      .expect(200);
    await student.http.post('/api/hub/prep/dsa-dp/increment').send({ delta: 5 }).expect(200);
    const soon = await slot(mentor, 0.5); // under an hour away: never auto-booked
    const later = await slot(mentor, 48);
    const latest = await slot(mentor, 72);

    const created = parse(await ask(student, mentor, { note: 'Help with DP please.' }).expect(201));
    expect(created).toMatchObject({ status: 'pending', slot: null, note: 'Help with DP please.' });
    const received = await events(mentor.user.id, 'hub.request_received');
    expect(received[0]?.payload).toMatchObject({
      requestId: created.id,
      studentName: 'Asha Student',
      note: 'Help with DP please.',
    });
    expectError(await ask(student, mentor), 409, 'REQUEST_EXISTS');

    const incoming = hub.pages.requests.parse(
      (await mentor.http.get('/api/hub/requests/incoming?status=pending').expect(200)).body,
    );
    expect(incoming.items[0]).toMatchObject({
      id: created.id,
      note: 'Help with DP please.',
      student: { name: 'Asha Student', year: 'TE', branch: 'Computer Engineering', dsaPercent: 14 }, // 5/35
    });

    const accepted = parse(await act(mentor, created.id, 'accept').expect(200));
    expect(accepted.status).toBe('accepted');
    expect(accepted.slot?.id).toBe(later.id);
    expect(accepted.slot?.status).toBe('booked');
    const note = await events(student.user.id, 'hub.request_accepted');
    expect(note[0]?.payload).toMatchObject({
      requestId: created.id,
      startsAt: later.startsAt,
      mentorName: 'Test Mentor',
    });

    const mine = hub.pages.requests.parse(
      (await student.http.get('/api/hub/requests/mine').expect(200)).body,
    );
    expect(mine.items.map((r) => r.status)).toEqual(['accepted']);
    const slots = hub.pages.slots.parse((await mentor.http.get('/api/hub/slots').expect(200)).body);
    expect(slots.items.map((s) => [s.id, s.status, s.booking?.studentName ?? null])).toEqual([
      [soon.id, 'open', null],
      [later.id, 'booked', 'Asha Student'],
      [latest.id, 'open', null],
    ]);

    // Complete only after the session has started.
    expectError(await act(mentor, created.id, 'complete'), 409, 'SESSION_NOT_STARTED');
    await prisma.hubMentorSlot.update({
      where: { id: later.id },
      data: { startsAt: hoursFromNow(-2), endsAt: hoursFromNow(-1) },
    });
    expect(parse(await act(mentor, created.id, 'complete').expect(200)).status).toBe('completed');
    expectError(await act(student, created.id, 'cancel'), 409, 'REQUEST_CLOSED');
  });

  it('accepts the requested slot, or another one the mentor picks; 409 NO_OPEN_SLOT when none is open', async () => {
    const mentor = await mentorWith();
    const a = await user(h);
    const b = await user(h);
    const s1 = await slot(mentor, 30);
    const s2 = await slot(mentor, 40);
    const ra = parse(await ask(a, mentor, { slotId: s2.id }).expect(201));
    expect(ra.slot?.id).toBe(s2.id);
    expect(parse(await act(mentor, ra.id, 'accept').expect(200)).slot?.id).toBe(s2.id);
    const rb = parse(await ask(b, mentor).expect(201));
    expectError(await act(mentor, rb.id, 'accept', { slotId: s2.id }), 409, 'SLOT_TAKEN');
    expect(parse(await act(mentor, rb.id, 'accept', { slotId: s1.id }).expect(200)).slot?.id).toBe(
      s1.id,
    );

    const c = await user(h);
    const rc = parse(await ask(c, mentor).expect(201));
    expectError(await act(mentor, rc.id, 'accept'), 409, 'NO_OPEN_SLOT');
    expect(parse(await act(mentor, rc.id, 'decline').expect(200)).status).toBe('declined');
    expect((await events(c.user.id, 'hub.request_declined'))[0]?.payload).toMatchObject({
      requestId: rc.id,
    });
    expectError(await act(mentor, rc.id, 'accept'), 409, 'REQUEST_NOT_PENDING');
  });

  it('two students racing for one slot: exactly one is accepted', async () => {
    const mentor = await mentorWith();
    const only = await slot(mentor, 30);
    const a = await user(h);
    const b = await user(h);
    const ra = parse(await ask(a, mentor, { slotId: only.id }).expect(201));
    const rb = parse(await ask(b, mentor, { slotId: only.id }).expect(201));
    const results = await Promise.all([act(mentor, ra.id, 'accept'), act(mentor, rb.id, 'accept')]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      await prisma.hubMentorshipRequest.count({ where: { slotId: only.id, status: 'accepted' } }),
    ).toBe(1);
    expect((await prisma.hubMentorSlot.findUniqueOrThrow({ where: { id: only.id } })).status).toBe(
      'booked',
    );
  });

  it('never accepts beyond capacity, and refuses new requests to a full mentor', async () => {
    const mentor = await mentorWith(1);
    await slot(mentor, 30);
    await slot(mentor, 40);
    const a = await user(h);
    const b = await user(h);
    const ra = parse(await ask(a, mentor).expect(201));
    const rb = parse(await ask(b, mentor).expect(201));
    await act(mentor, ra.id, 'accept').expect(200);
    expectError(await act(mentor, rb.id, 'accept'), 409, 'MENTOR_FULL');
    expectError(await ask(await user(h), mentor), 409, 'MENTOR_FULL');
  });

  it('cancelling an accepted request frees the slot and tells the other party', async () => {
    const mentor = await mentorWith();
    const s = await slot(mentor, 30);
    const student = await user(h, 'student', 'Cancel Student');
    const r = parse(await ask(student, mentor, { slotId: s.id }).expect(201));
    await act(mentor, r.id, 'accept').expect(200);
    expect(parse(await act(student, r.id, 'cancel').expect(200)).status).toBe('cancelled');
    expect((await prisma.hubMentorSlot.findUniqueOrThrow({ where: { id: s.id } })).status).toBe(
      'open',
    );
    expect((await events(mentor.user.id, 'hub.request_cancelled'))[0]?.payload).toMatchObject({
      requestId: r.id,
      byName: 'Cancel Student',
      startsAt: s.startsAt,
    });
    // A new request is allowed once the old one is closed; the mentor can cancel too.
    const again = parse(await ask(student, mentor).expect(201));
    await act(mentor, again.id, 'cancel').expect(200);
    expect((await events(student.user.id, 'hub.request_cancelled'))[0]?.payload).toMatchObject({
      requestId: again.id,
    });
  });

  it('gives 404 to anyone who is not a party (admins may read)', async () => {
    const mentor = await mentorWith();
    const student = await user(h);
    const r = parse(await ask(student, mentor).expect(201));
    const stranger = await user(h);
    const otherMentor = await mentorWith();
    await stranger.http.get(`/api/hub/requests/${r.id}`).expect(404);
    await otherMentor.http.get(`/api/hub/requests/${r.id}`).expect(404);
    expectError(await act(stranger, r.id, 'cancel'), 404);
    expectError(await act(otherMentor, r.id, 'accept'), 404);
    expectError(await act(student, r.id, 'accept'), 404); // only the request's mentor may accept
    await student.http.get(`/api/hub/requests/${r.id}`).expect(200);
    const admin = await user(h, 'admin');
    await admin.http.get(`/api/hub/requests/${r.id}`).expect(200);
    await admin.http.post(`/api/hub/requests/${r.id}/accept`).send({}).expect(403);
  });

  it('validates requests: unknown mentor, self, someone else’s slot', async () => {
    const mentor = await mentorWith();
    const other = await mentorWith();
    const otherSlot = await slot(other, 30);
    const student = await user(h);
    expectError(
      await student.http.post('/api/hub/requests').send({ mentorId: student.user.id }),
      400,
    );
    expectError(
      await student.http.post('/api/hub/requests').send({ mentorId: (await user(h)).user.id }),
      404,
    );
    expectError(await ask(student, mentor, { slotId: otherSlot.id }), 409, 'SLOT_TAKEN');
    expectError(await ask(student, mentor, { note: 'x'.repeat(501) }), 400);
    expectError(await ask(student, mentor, { status: 'accepted' }), 400);
  });
});

describe('slots', () => {
  it('rejects overlapping slots in the database, and lets a cancelled slot be re-created', async () => {
    const mentor = await mentorWith();
    const s = await slot(mentor, 30, 60);
    const start = new Date(s.startsAt);
    const at = (offsetMin: number, minutes: number) => ({
      startsAt: new Date(start.getTime() + offsetMin * 60_000).toISOString(),
      endsAt: new Date(start.getTime() + (offsetMin + minutes) * 60_000).toISOString(),
    });
    expectError(await mentor.http.post('/api/hub/slots').send(at(30, 60)), 409, 'SLOT_OVERLAP');
    expectError(await mentor.http.post('/api/hub/slots').send(at(0, 60)), 409, 'SLOT_OVERLAP');
    await mentor.http.post('/api/hub/slots').send(at(60, 30)).expect(201); // touching is fine
    // The constraint itself, bypassing the API.
    await expect(
      prisma.hubMentorSlot.create({
        data: {
          mentorId: mentor.user.id,
          startsAt: new Date(start.getTime() + 10 * 60_000),
          endsAt: new Date(start.getTime() + 50 * 60_000),
        },
      }),
    ).rejects.toThrow(/hub_mentor_slots_no_overlap/);
    await mentor.http.delete(`/api/hub/slots/${s.id}`).expect(204);
    await mentor.http.delete(`/api/hub/slots/${s.id}`).expect(404);
    await mentor.http.post('/api/hub/slots').send(at(0, 60)).expect(201);
  });

  it('validates length and time, refuses booked slots and non-mentors', async () => {
    const mentor = await mentorWith();
    const start = hoursFromNow(30);
    const send = (minutes: number, from = start) =>
      mentor.http.post('/api/hub/slots').send({
        startsAt: from.toISOString(),
        endsAt: new Date(from.getTime() + minutes * 60_000).toISOString(),
      });
    expectError(await send(20), 400);
    expectError(await send(181), 400);
    expectError(await send(60, hoursFromNow(-1)), 400);
    const s = await slot(mentor, 50);
    const student = await user(h);
    const r = parse(await ask(student, mentor, { slotId: s.id }).expect(201));
    await act(mentor, r.id, 'accept').expect(200);
    expectError(await mentor.http.delete(`/api/hub/slots/${s.id}`), 409, 'SLOT_BOOKED');
    expectError(
      await student.http
        .post('/api/hub/slots')
        .send({ startsAt: start.toISOString(), endsAt: hoursFromNow(31).toISOString() }),
      403,
      'NOT_A_MENTOR',
    );
    const other = await mentorWith();
    await other.http.delete(`/api/hub/slots/${s.id}`).expect(404);
  });

  it('lets a peer-mentor student offer slots and be requested', async () => {
    const peer = await user(h, 'student', 'Peer Senior');
    await peer.http
      .put('/api/hub/me')
      .send({ isPeerMentor: true, mentorExpertise: ['Graphs'] })
      .expect(200);
    const s = await slot(peer, 30);
    const junior = await user(h);
    const r = parse(await ask(junior, peer).expect(201));
    expect(parse(await act(peer, r.id, 'accept').expect(200)).slot?.id).toBe(s.id);
  });
});
