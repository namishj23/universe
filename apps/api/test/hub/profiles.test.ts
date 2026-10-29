import { beforeAll, describe, expect, it } from 'vitest';
import { hub } from '@universe/contracts';
import { account, expectError, setupHub, user, type Hub } from './helpers.js';

let h: Hub;
beforeAll(async () => {
  h = await setupHub();
});

describe('profile', () => {
  it("returns Aarav's seeded profile, goals and readiness", async () => {
    const aarav = await account(h, 'student@universe.test');
    const me = hub.HubProfile.parse((await aarav.http.get('/api/hub/me').expect(200)).body);
    expect(me).toMatchObject({
      user: { name: 'Aarav Mehta', email: 'student@universe.test', role: 'student' },
      year: 'TE',
      branch: 'Computer Engineering',
      interests: ['Graphs', 'Dynamic Programming', 'System design'],
      targetRole: 'SDE intern',
      targetCompanies: ['Google', 'Microsoft'],
      isMentor: false,
      readiness: { score: 31 },
    });
    const weeks = (Date.parse(me.placementDeadline ?? '') - Date.now()) / (7 * 86_400_000);
    expect(weeks).toBeGreaterThan(5);
    expect(weeks).toBeLessThan(7);
  });

  it('updates with a strict schema and keeps name and email read-only', async () => {
    const s = await user(h);
    const me = hub.HubProfile.parse(
      (
        await s.http
          .put('/api/hub/me')
          .send({
            year: 'SE',
            skills: ['Go', 'go', ' Rust '],
            interests: ['Graphs'],
            placementDeadline: '2027-01-15',
          })
          .expect(200)
      ).body,
    );
    expect(me).toMatchObject({
      year: 'SE',
      skills: ['Go', 'Rust'],
      placementDeadline: '2027-01-15',
    });
    expectError(
      await s.http.put('/api/hub/me').send({ name: 'Someone Else' }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await s.http.put('/api/hub/me').send({ email: 'x@universe.test' }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(await s.http.put('/api/hub/me').send({ year: 'XE' }), 400);
    expectError(
      await s.http
        .put('/api/hub/me')
        .send({ skills: Array.from({ length: 31 }, (_, i) => `s${i}`) }),
      400,
    );
    expectError(await s.http.put('/api/hub/me').send({ skills: ['x'.repeat(41)] }), 400);
    expectError(await s.http.put('/api/hub/me').send({ isPeerMentor: true }), 400); // no expertise
    const after = hub.HubProfile.parse((await s.http.get('/api/hub/me').expect(200)).body);
    expect(after.user.name).toBe(s.user.name);
    expect(after.isPeerMentor).toBe(false);
    // Clearing an optional field.
    expect((await s.http.put('/api/hub/me').send({ year: null }).expect(200)).body).toMatchObject({
      year: null,
    });
  });

  it('lets only students become peer mentors', async () => {
    const mentor = await account(h, 'mentor@universe.test');
    expectError(
      await mentor.http.put('/api/hub/me').send({ isPeerMentor: true, mentorExpertise: ['DP'] }),
      400,
    );
  });
});

describe('privacy', () => {
  it("never shows a student's profile to another student, or to a mentor they have not asked", async () => {
    const aarav = await account(h, 'student@universe.test');
    const other = await user(h);
    await other.http.get(`/api/hub/students/${aarav.user.id}`).expect(404);
    const sameer = await account(h, 'sameer.joshi@universe.test');
    await sameer.http.get(`/api/hub/students/${aarav.user.id}`).expect(404);
  });

  it('shows a mentor only the students who requested them, and only name, year, branch and prep', async () => {
    const neha = await account(h, 'mentor@universe.test');
    const aarav = await account(h, 'student@universe.test');
    const card = (await neha.http.get(`/api/hub/students/${aarav.user.id}`).expect(200))
      .body as object;
    expect(card).toEqual({
      id: aarav.user.id,
      name: 'Aarav Mehta',
      year: 'TE',
      branch: 'Computer Engineering',
      dsaPercent: 62,
      readiness: 31,
    });
    const admin = await account(h, 'admin@universe.test');
    await admin.http.get(`/api/hub/students/${aarav.user.id}`).expect(200);
    // A mentor's id is not a student card.
    await admin.http.get(`/api/hub/students/${neha.user.id}`).expect(404);
  });
});
