import { beforeAll, describe, expect, it } from 'vitest';
import { hub, istDate } from '@universe/contracts';
import { prisma } from '../../src/platform/db.js';
import { account, countQueries, setupHub, user, type Hub } from './helpers.js';

let h: Hub;
beforeAll(async () => {
  h = await setupHub();
});

const list = async (s: Awaited<ReturnType<typeof account>>) =>
  hub.MentorList.parse((await s.http.get('/api/hub/mentors').expect(200)).body);

describe('mentor ranking with the seed data', () => {
  it('ranks Neha, Sameer, Arjun, Kavita for Aarav, with components, slots and his request', async () => {
    const aarav = await account(h, 'student@universe.test');
    const body = await list(aarav);
    expect(body.items.map((m) => m.name)).toEqual([
      'Prof. Neha Iyer',
      'Dr. Sameer Joshi',
      'Prof. Arjun Menon',
      'Prof. Kavita Nair',
    ]);
    expect(body.items.map((m) => m.score)).toEqual([0.6663, 0.5691, 0.567, 0.4234]);
    expect(body.weakTopics.map((t) => t.name)).toEqual(['Dynamic Programming', 'Greedy', 'Graphs']);
    const [neha] = body.items;
    expect(neha).toMatchObject({
      rank: 1,
      department: 'Computer Engg.',
      expertise: ['DP', 'Graphs', 'System design'],
      capacity: 3,
      capacityLeft: 2,
      slotsThisWeek: 2,
      coveredTopics: ['Dynamic Programming', 'Graphs'],
      reason: 'Covers two of your weakest topics: Dynamic Programming and Graphs.',
      components: {
        match: 0.7217,
        weakTopicCoverage: 0.6289,
        interestOverlap: 1,
        availability: 0.5,
        load: 0.3333,
      },
    });
    expect(neha?.nextSlots).toHaveLength(2);
    // "Accepted · Mon 15:30" (Asia/Kolkata).
    expect(neha?.myRequest.status).toBe('accepted');
    if (neha?.myRequest.status === 'accepted') {
      const start = new Date(neha.myRequest.startsAt);
      const ist = new Date(start.getTime() + 330 * 60_000);
      expect([ist.getUTCDay(), ist.getUTCHours(), ist.getUTCMinutes()]).toEqual([1, 15, 30]);
    }
    expect(body.items[3]?.reason).toContain('Currently mentoring 5 students.');
    expect(body.items.slice(1).every((m) => m.myRequest.status === 'none')).toBe(true);
  });

  it('shows Diya her pending request with Neha', async () => {
    const diya = await account(h, 'student2@universe.test');
    const neha = (await list(diya)).items.find((m) => m.name === 'Prof. Neha Iyer');
    expect(neha?.myRequest.status).toBe('pending');
  });

  it('hides mentors with capacity 0 and full mentors, unless the caller already has a live request', async () => {
    const kavita = await prisma.user.findUniqueOrThrow({
      where: { email: 'kavita.nair@universe.test' },
    });
    const arjun = await prisma.user.findUniqueOrThrow({
      where: { email: 'arjun.menon@universe.test' },
    });
    await prisma.hubProfile.update({ where: { userId: kavita.id }, data: { mentorCapacity: 5 } }); // full
    await prisma.hubProfile.update({ where: { userId: arjun.id }, data: { mentorCapacity: 0 } });
    try {
      const aarav = await account(h, 'student@universe.test');
      expect((await list(aarav)).items.map((m) => m.name)).toEqual([
        'Prof. Neha Iyer',
        'Dr. Sameer Joshi',
      ]);
      // Diya is one of Kavita's mentees: Kavita stays in her list even though she is full.
      const diya = await account(h, 'student2@universe.test');
      const names = (await list(diya)).items.map((m) => m.name);
      expect(names).toContain('Prof. Kavita Nair');
      expect(names).not.toContain('Prof. Arjun Menon');
    } finally {
      await prisma.hubProfile.update({ where: { userId: kavita.id }, data: { mentorCapacity: 8 } });
      await prisma.hubProfile.update({ where: { userId: arjun.id }, data: { mentorCapacity: 3 } });
    }
  });

  it('never ranks the student themself (a peer mentor) and ranks them for others', async () => {
    const peer = await user(h, 'student', 'Peer Mentor');
    await peer.http
      .put('/api/hub/me')
      .send({
        isPeerMentor: true,
        mentorExpertise: ['Dynamic Programming'],
        mentorDepartment: 'Computer Engg.',
      })
      .expect(200);
    expect((await list(peer)).items.map((m) => m.mentorId)).not.toContain(peer.user.id);
    const aarav = await account(h, 'student@universe.test');
    const mine = (await list(aarav)).items.find((m) => m.mentorId === peer.user.id);
    // "Dynamic Programming" normalises to the DP tag: coverage .6857 / 1.8324.
    expect(mine?.components.weakTopicCoverage).toBe(0.3742);
    await prisma.hubProfile.update({
      where: { userId: peer.user.id },
      data: { isPeerMentor: false },
    });
  });

  it('pages the ranked list with a cursor', async () => {
    const aarav = await account(h, 'student@universe.test');
    const first = hub.MentorList.parse(
      (await aarav.http.get('/api/hub/mentors?limit=3').expect(200)).body,
    );
    expect(first.items).toHaveLength(3);
    const rest = hub.MentorList.parse(
      (await aarav.http.get(`/api/hub/mentors?limit=3&cursor=${first.nextCursor}`).expect(200))
        .body,
    );
    expect(rest.items.map((m) => m.rank)).toEqual([4]);
    expect(rest.nextCursor).toBeNull();
  });

  it('uses the same number of queries for 4 or 9 mentors (no N+1)', async () => {
    const aarav = await account(h, 'student@universe.test');
    const before = await countQueries(() => aarav.http.get('/api/hub/mentors').expect(200));
    for (let i = 0; i < 5; i += 1) await user(h, 'mentor', `Extra Mentor ${i}`);
    const after = await countQueries(() =>
      aarav.http.get('/api/hub/mentors?limit=100').expect(200),
    );
    expect(after).toBe(before);
    await prisma.user.updateMany({
      where: { name: { startsWith: 'Extra Mentor' } },
      data: { isActive: false },
    });
  });

  it("returns a mentor's public profile to any hub role, and 404 for a non-mentor", async () => {
    const neha = await prisma.user.findUniqueOrThrow({ where: { email: 'mentor@universe.test' } });
    const admin = await account(h, 'admin@universe.test');
    const profile = hub.MentorProfile.parse(
      (await admin.http.get(`/api/hub/mentors/${neha.id}`).expect(200)).body,
    );
    expect(profile).toMatchObject({ name: 'Prof. Neha Iyer', capacityLeft: 2, slotsThisWeek: 2 });
    expect(
      profile.openSlots.every((s) => istDate(new Date(s.startsAt)) >= istDate(new Date())),
    ).toBe(true);
    const aarav = await account(h, 'student@universe.test');
    await admin.http.get(`/api/hub/mentors/${aarav.user.id}`).expect(404);
  });

  it("ranks every mentor for admins against all students' weak topics", async () => {
    const admin = await account(h, 'admin@universe.test');
    const body = hub.AdminMentorList.parse(
      (await admin.http.get('/api/hub/admin/mentors').expect(200)).body,
    );
    expect(body.items.map((m) => m.name).sort()).toEqual(
      ['Dr. Sameer Joshi', 'Prof. Arjun Menon', 'Prof. Kavita Nair', 'Prof. Neha Iyer'].sort(),
    );
    const kavita = body.items.find((m) => m.name === 'Prof. Kavita Nair');
    expect(kavita).toMatchObject({
      mentees: 5,
      capacity: 8,
      slotsThisWeek: 3,
      requestsLast30Days: 5,
    });
    expect(body.items.find((m) => m.name === 'Prof. Neha Iyer')?.requestsLast30Days).toBe(3);
    expect(body.weakTopics).toHaveLength(3);
    expect(body.items[0]?.reason).toMatch(/students' weakest topic/);
    const aarav = await account(h, 'student@universe.test');
    await aarav.http.get('/api/hub/admin/mentors').expect(403);
  });
});
