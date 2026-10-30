// The P7 audit's hub repros (docs/audit/P7-evidence/probes/p7-hub.test.ts.txt), kept as
// permanent regression tests for the P8 fixes, plus the cases each fix needs.
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/platform/db.js';
import { account, setupHub, user, type Hub, type Session } from './helpers.js';

let h: Hub;
beforeAll(async () => {
  h = await setupHub();
}, 120_000);

const ask = async (student: Session, mentorId: string) => {
  await student.http.get('/api/hub/me').expect(200);
  const req = await student.http.post('/api/hub/requests').send({ mentorId });
  expect(req.status, JSON.stringify(req.body)).toBe(201);
  return (req.body as { id: string }).id;
};
const card = (mentor: Session, student: Session) =>
  mentor.http.get(`/api/hub/students/${student.user.id}`);

describe('the student card lasts only as long as the request (P7-006)', () => {
  it('P7-H1: a mentor loses access to a student card once the request is cancelled', async () => {
    const neha = await account(h, 'mentor@universe.test');
    const s = await user(h);
    const id = await ask(s, neha.user.id);
    expect((await card(neha, s)).status).toBe(200);
    await s.http.post(`/api/hub/requests/${id}/cancel`).send({}).expect(200);
    expect((await card(neha, s)).status).toBe(404);
    // Incoming keeps the closed row with the student's name only.
    const incoming = (await neha.http.get('/api/hub/requests/incoming?limit=100').expect(200))
      .body as { items: { id: string; status: string; student: Record<string, unknown> }[] };
    const row = incoming.items.find((r) => r.id === id);
    expect(row?.status).toBe('cancelled');
    expect(row?.student).toEqual({ id: s.user.id, name: s.user.name });
  });

  it('declined → 404', async () => {
    const mentor = await user(h, 'mentor');
    const s = await user(h);
    const id = await ask(s, mentor.user.id);
    await mentor.http.post(`/api/hub/requests/${id}/decline`).send({}).expect(200);
    expect((await card(mentor, s)).status).toBe(404);
  });

  it('a former peer mentor → 404', async () => {
    const peer = await user(h, 'student', 'Peer Mentor P8');
    await peer.http
      .put('/api/hub/me')
      .send({ isPeerMentor: true, mentorExpertise: ['Dynamic Programming'] })
      .expect(200);
    const s = await user(h);
    await ask(s, peer.user.id);
    expect((await card(peer, s)).status).toBe(200);
    await peer.http.put('/api/hub/me').send({ isPeerMentor: false }).expect(200);
    expect((await card(peer, s)).status).toBe(404);
  });

  it('completed: visible for 14 days, 404 after', async () => {
    const mentor = await user(h, 'mentor');
    const s = await user(h);
    const start = new Date(Date.now() + 3 * 86_400_000);
    const slot = (
      await mentor.http
        .post('/api/hub/slots')
        .send({
          startsAt: start.toISOString(),
          endsAt: new Date(start.getTime() + 3_600_000).toISOString(),
        })
        .expect(201)
    ).body as { id: string };
    const id = await ask(s, mentor.user.id);
    const days = (n: number) => new Date(Date.now() - n * 86_400_000);
    await prisma.hubMentorshipRequest.update({
      where: { id },
      data: { status: 'completed', slotId: slot.id, completedAt: days(13) },
    });
    expect((await card(mentor, s)).status).toBe(200);
    await prisma.hubMentorshipRequest.update({ where: { id }, data: { completedAt: days(15) } });
    expect((await card(mentor, s)).status).toBe(404);
  });
});
