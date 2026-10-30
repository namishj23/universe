import { beforeAll, describe, expect, it } from 'vitest';
import { hub, istDate, weekOf } from '@universe/contracts';
import { prisma } from '../../src/platform/db.js';
import { idempotencyStore } from '../../src/modules/hub/idempotency.js';
import { readiness, series, weekGoal } from '../../src/modules/hub/prep.js';
import { account, expectError, setupHub, user, type Hub } from './helpers.js';

let h: Hub;
beforeAll(async () => {
  h = await setupHub();
});

const ist = (s: string) => new Date(`${s}+05:30`);

describe('the shared week (Sunday 00:00 to Saturday 23:59:59.999, Asia/Kolkata)', () => {
  it('puts Saturday 23:59 IST and Sunday 00:00 IST in different weeks', () => {
    // Sunday 1 Nov 2026 00:00 IST is Saturday 31 Oct 18:30 UTC.
    expect(weekOf(ist('2026-10-31T23:59:59.999')).startDate).toBe('2026-10-25');
    expect(weekOf(ist('2026-11-01T00:00:00.000')).startDate).toBe('2026-11-01');
    expect(weekOf(ist('2026-11-01T00:00:00.000')).start.toISOString()).toBe(
      '2026-10-31T18:30:00.000Z',
    );
    expect(weekOf(ist('2026-10-29T10:00:00')).endsAt.toISOString()).toBe(
      '2026-10-31T18:29:59.999Z',
    );
    expect(istDate(new Date('2026-10-31T18:29:59Z'))).toBe('2026-10-31');
    expect(istDate(new Date('2026-10-31T18:30:00Z'))).toBe('2026-11-01');
  });

  it('counts a week from its Sunday: +1 then −1 is 0, and last week never counts', () => {
    const at = (s: string, delta: number) => ({ createdAt: ist(s), delta });
    const events = [
      at('2026-10-31T23:30:00', 5), // last week (Saturday night)
      at('2026-11-01T00:10:00', 1),
      at('2026-11-01T00:20:00', -1),
      at('2026-11-02T09:00:00', 3),
    ];
    // Monday 2 Nov 12:00 IST: 1.5 days of 7 elapsed, so 20 × 0.2143 = 4.3 expected.
    const g = weekGoal(events, 20, ist('2026-11-02T12:00:00'));
    expect(g).toMatchObject({
      done: 3,
      left: 17,
      target: 20,
      weekStart: '2026-11-01',
      expectedByNow: 4.3,
      status: 'behind',
    });
    expect(g.weekEndsAt).toBe('2026-11-07T18:29:59.999Z');
    expect(weekGoal([at('2026-11-01T00:10:00', -2)], 20, ist('2026-11-01T01:00:00')).done).toBe(0);
    expect(weekGoal([at('2026-11-02T09:00:00', 5)], 20, ist('2026-11-02T12:00:00')).status).toBe(
      'on_track',
    );
  });
});

describe('formulas', () => {
  it('computes readiness with the configured weights (hand-worked)', () => {
    // DSA 118/190 = .6211, core 10/40 = .25, aptitude 0, interview 2/5 = .4, resume 1/1.
    const r = readiness([
      { track: 'dsa', solved: 118, total: 190 },
      { track: 'core', solved: 4, total: 20 },
      { track: 'core', solved: 6, total: 20 },
      { track: 'interview', solved: 2, total: 5 },
      { track: 'resume', solved: 1, total: 1 },
    ]);
    // .5 × .6211 + .2 × .25 + .15 × 0 + .1 × .4 + .05 × 1 = .4505
    expect(r.score).toBe(45);
    expect(r.tracks).toEqual({ dsa: 62, aptitude: 0, core: 25, interview: 40, resume: 100 });
    expect(readiness([]).score).toBe(0);
  });

  it('builds the 30-day series backwards from today, ignoring changes from before a topic was tracked', () => {
    const now = ist('2026-11-02T12:00:00');
    const tracked = [
      { topicId: 'a', solved: 5, trackedSince: ist('2026-10-01T00:00:00') },
      { topicId: 'b', solved: 2, trackedSince: ist('2026-11-01T08:00:00') }, // re-tracked yesterday
    ];
    const events = [
      { topicId: 'a', delta: 3, createdAt: ist('2026-10-30T10:00:00') },
      { topicId: 'a', delta: 2, createdAt: ist('2026-11-02T09:00:00') },
      { topicId: 'b', delta: 4, createdAt: ist('2026-10-20T10:00:00') }, // before re-tracking: ignored
      { topicId: 'b', delta: 2, createdAt: ist('2026-11-01T09:00:00') },
    ];
    const s = series(tracked, events, now);
    expect(s).toHaveLength(30);
    expect(s.at(-1)).toEqual({ date: '2026-11-02', solved: 7 });
    expect(s.at(-2)).toEqual({ date: '2026-11-01', solved: 5 });
    expect(s.at(-3)).toEqual({ date: '2026-10-31', solved: 3 });
    expect(s.at(-5)).toEqual({ date: '2026-10-29', solved: 0 });
    expect(s[0]?.date).toBe('2026-10-04');
  });

  it('runs a repeated idempotency key once and forgets failed ones', async () => {
    let t = 0;
    const store = idempotencyStore(1000, 10, () => t);
    let runs = 0;
    const work = () => Promise.resolve(++runs);
    const [a, b] = await Promise.all([store.run('k', work), store.run('k', work)]);
    expect([a.value, b.value, b.replayed, runs]).toEqual([1, 1, true, 1]);
    t = 1001; // expired
    expect((await store.run('k', work)).value).toBe(2);
    await expect(store.run('bad', () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect((await store.run('bad', work)).replayed).toBe(false);
  });
});

describe('prep API', () => {
  it("returns Aarav's DSA sheet, goal and series from the seed", async () => {
    const aarav = await account(h, 'student@universe.test');
    const view = hub.PrepView.parse((await aarav.http.get('/api/hub/prep').expect(200)).body);
    expect(view.dsa).toEqual({ solved: 118, total: 190, percent: 62 });
    expect(view.tracks.map((t) => t.track)).toEqual(['dsa']);
    expect(view.tracks[0]?.topics.map((t) => `${t.name} ${t.solved}/${t.total}`)).toEqual([
      'Arrays & Strings 44/50',
      'Linked Lists 18/20',
      'Trees 21/30',
      'Graphs 16/30',
      'Dynamic Programming 11/35',
      'Greedy 8/25',
    ]);
    expect(view.week).toMatchObject({
      target: 20,
      done: 14,
      left: 6,
      weekStart: weekOf().startDate,
    });
    expect(view.readiness.score).toBe(31); // .5 × 118/190
    expect(view.series.at(-1)?.solved).toBe(118);
    expect(view.series.every((p, i, all) => i === 0 || p.solved >= (all[i - 1]?.solved ?? 0))).toBe(
      true,
    );
    expect(view.untracked.map((t) => t.topicId)).toContain('core-os');
  });

  it('tracks topics, increments within bounds and corrects mistakes', async () => {
    const s = await user(h);
    const empty = hub.PrepView.parse((await s.http.get('/api/hub/prep').expect(200)).body);
    expect(empty.tracks).toEqual([]);
    expect(empty.untracked).toHaveLength(13);
    await s.http
      .put('/api/hub/prep/topics')
      .send({ topicIds: ['res-review', 'int-mock'] })
      .expect(200);
    expectError(await s.http.put('/api/hub/prep/topics').send({ topicIds: ['nope-topic'] }), 400);

    const inc = (topic: string, delta: number) =>
      s.http.post(`/api/hub/prep/${topic}/increment`).send({ delta });
    const first = hub.IncrementResponse.parse((await inc('res-review', 1).expect(200)).body);
    expect(first.topic).toMatchObject({ solved: 1, total: 1, percent: 100 });
    expect(first.week.done).toBe(1);
    expectError(await inc('res-review', 1), 409, 'PROGRESS_OUT_OF_RANGE'); // above total
    await inc('res-review', -1).expect(200);
    expectError(await inc('res-review', -1), 409, 'PROGRESS_OUT_OF_RANGE'); // below 0
    expectError(await inc('res-review', 0), 400);
    expectError(await inc('res-review', 6), 400);
    expectError(
      await s.http.post('/api/hub/prep/res-review/increment').send({ delta: 1, extra: 1 }),
      400,
    );
    expectError(await inc('dsa-dp', 1), 404, 'TOPIC_NOT_TRACKED');
    // +1 then −1: this week counts 0.
    const view = hub.PrepView.parse((await s.http.get('/api/hub/prep').expect(200)).body);
    expect(view.week.done).toBe(0);
    expect(await prisma.hubProgressEvent.count({ where: { userId: s.user.id } })).toBe(2);

    // Untracking keeps the history; re-tracking starts again at 0.
    await inc('int-mock', 3).expect(200);
    await s.http
      .put('/api/hub/prep/topics')
      .send({ topicIds: ['res-review'] })
      .expect(200);
    expect(await prisma.hubProgressEvent.count({ where: { userId: s.user.id } })).toBe(3);
    const back = hub.PrepView.parse(
      (
        await s.http
          .put('/api/hub/prep/topics')
          .send({ topicIds: ['res-review', 'int-mock'] })
          .expect(200)
      ).body,
    );
    expect(back.tracks.find((t) => t.track === 'interview')?.solved).toBe(0);
    expect(back.series.at(-1)?.solved).toBe(0);
  });

  it('enforces solved ≤ total in the database too', async () => {
    const s = await user(h);
    await s.http
      .put('/api/hub/prep/topics')
      .send({ topicIds: ['res-review'] })
      .expect(200);
    await expect(
      prisma.hubTopicProgress.update({
        where: { userId_topicId: { userId: s.user.id, topicId: 'res-review' } },
        data: { solved: 2 },
      }),
    ).rejects.toThrow();
  });

  it('ignores a repeated Idempotency-Key, even for a concurrent double-click', async () => {
    const s = await user(h);
    await s.http
      .put('/api/hub/prep/topics')
      .send({ topicIds: ['dsa-dp'] })
      .expect(200);
    const click = (key: string) =>
      s.http.post('/api/hub/prep/dsa-dp/increment').set('Idempotency-Key', key).send({ delta: 1 });
    const [a, b] = await Promise.all([click('click-1'), click('click-1')]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(b.body).toEqual(a.body);
    await click('click-1').expect(200);
    await click('click-2').expect(200);
    const view = hub.PrepView.parse((await s.http.get('/api/hub/prep').expect(200)).body);
    expect(view.dsa.solved).toBe(2);
    expectError(await click('bad key!'), 400, 'INVALID_IDEMPOTENCY_KEY');
    // Keys are per user: another student's same key is a different click.
    const other = await user(h);
    await other.http
      .put('/api/hub/prep/topics')
      .send({ topicIds: ['dsa-dp'] })
      .expect(200);
    await other.http
      .post('/api/hub/prep/dsa-dp/increment')
      .set('Idempotency-Key', 'click-1')
      .send({ delta: 1 })
      .expect(200);
    expect(
      await prisma.hubTopicProgress.findFirst({ where: { userId: other.user.id } }),
    ).toMatchObject({ solved: 1 });
  });

  it("sets this week's goal (1–200)", async () => {
    const s = await user(h);
    const week = hub.WeekGoal.parse(
      (await s.http.put('/api/hub/prep/goal').send({ target: 35 }).expect(200)).body,
    );
    expect(week).toMatchObject({ target: 35, done: 0, weekStart: weekOf().startDate });
    expectError(await s.http.put('/api/hub/prep/goal').send({ target: 0 }), 400);
    expectError(await s.http.put('/api/hub/prep/goal').send({ target: 201 }), 400);
  });

  it('is for students only', async () => {
    const mentor = await account(h, 'mentor@universe.test');
    await mentor.http.get('/api/hub/prep').expect(403);
  });
});
