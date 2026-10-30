import { beforeAll, describe, expect, it } from 'vitest';
import { wellbeing } from '@universe/contracts';
import { prisma } from '../../src/platform/db.js';
import {
  addDays,
  codeOf,
  daysAgo,
  setupWellbeing,
  today,
  tracking,
  user,
  type Wb,
} from './helpers.js';

let w: Wb;
beforeAll(async () => {
  w = await setupWellbeing();
});

const put = (s: Awaited<ReturnType<typeof user>>, rows: unknown[]) =>
  s.http.put('/api/wellbeing/totals').send({ rows });

describe('settings and tracking', () => {
  it('starts with tracking off, four counted categories, 90 days, no sharing', async () => {
    const s = await user(w);
    const res = await s.http.get('/api/wellbeing/settings').expect(200);
    expect(wellbeing.Settings.parse(res.body)).toMatchObject({
      tracking: 'off',
      pausedSince: null,
      categories: ['study', 'communication', 'social', 'entertainment'],
      retentionDays: 90,
      shareStudyWithHub: false,
    });
  });

  it('records when tracking was paused, keeps it on a second pause, clears it on resume', async () => {
    const s = await user(w);
    const first = await s.http
      .post('/api/wellbeing/tracking')
      .send({ state: 'paused' })
      .expect(200);
    expect(wellbeing.Settings.parse(first.body).pausedSince).not.toBeNull();
    const again = await s.http
      .post('/api/wellbeing/tracking')
      .send({ state: 'paused' })
      .expect(200);
    expect(wellbeing.Settings.parse(again.body).pausedSince).toBe(
      wellbeing.Settings.parse(first.body).pausedSince,
    );
    const on = await s.http.post('/api/wellbeing/tracking').send({ state: 'on' }).expect(200);
    expect(on.body).toMatchObject({ tracking: 'on', pausedSince: null });
    await s.http.post('/api/wellbeing/tracking').send({ state: 'sleeping' }).expect(400);
  });

  it('validates settings strictly and keeps rows of a category turned off', async () => {
    const s = await tracking(w);
    await put(s, [{ date: today(), category: 'social', minutes: 30 }]).expect(200);
    const res = await s.http
      .put('/api/wellbeing/settings')
      .send({ categories: ['social', 'study'], retentionDays: 30, shareStudyWithHub: true })
      .expect(200);
    expect(res.body).toMatchObject({ categories: ['study', 'social'], retentionDays: 30 });
    await s.http
      .put('/api/wellbeing/settings')
      .send({ categories: ['study'] })
      .expect(200);
    const summary = {
      body: wellbeing.Summary.parse((await s.http.get('/api/wellbeing/summary').expect(200)).body),
    };
    expect(summary.body.recordCount).toBe(1); // stored row kept
    expect(summary.body.todayMinutes).toBe(0); // but not counted
    expect(summary.body.categories).toContainEqual({
      category: 'social',
      minutes: 30,
      counted: false,
    });
    for (const body of [
      {},
      { retentionDays: 6 },
      { retentionDays: 366 },
      { categories: ['study', 'study'] },
      { categories: ['games'] },
      { tracking: 'on' },
      { shareStudyWithHub: 'yes' },
    ])
      await s.http.put('/api/wellbeing/settings').send(body).expect(400);
  });
});

describe('PUT /totals', () => {
  it('upserts rows and refuses unknown fields such as a domain', async () => {
    const s = await tracking(w);
    await put(s, [{ date: daysAgo(1), category: 'study', minutes: 10 }]).expect(200, { stored: 1 });
    await put(s, [{ date: daysAgo(1), category: 'study', minutes: 25 }]).expect(200);
    const rows = await s.http.get('/api/wellbeing/records').expect(200);
    expect(wellbeing.RecordsPage.parse(rows.body).items).toEqual([
      { date: daysAgo(1), category: 'study', minutes: 25 },
    ]);
    await put(s, [
      { date: daysAgo(1), category: 'study', minutes: 5, domain: 'youtube.com' },
    ]).expect(400);
    await s.http.put('/api/wellbeing/totals').send({ rows: [], url: 'x' }).expect(400);
  });

  it.each(['paused', 'off'] as const)(
    'refuses uploads while tracking is %s (409)',
    async (state) => {
      const s = await tracking(w);
      await s.http.post('/api/wellbeing/tracking').send({ state }).expect(200);
      const res = await put(s, [{ date: today(), category: 'study', minutes: 5 }]).expect(409);
      expect(codeOf(res.body)).toBe('TRACKING_PAUSED');
      expect(await prisma.wbDailyTotal.count({ where: { userId: s.user.id } })).toBe(0);
    },
  );

  it('refuses a category the user does not count (422), storing nothing from the request', async () => {
    const s = await tracking(w);
    const res = await put(s, [
      { date: today(), category: 'study', minutes: 5 },
      { date: today(), category: 'other', minutes: 5 },
    ]).expect(422);
    expect(codeOf(res.body)).toBe('CATEGORY_NOT_COUNTED');
    expect(await prisma.wbDailyTotal.count({ where: { userId: s.user.id } })).toBe(0);
  });

  it('refuses future dates and dates outside retention (Asia/Kolkata)', async () => {
    const s = await tracking(w);
    const future = await put(s, [{ date: addDays(today(), 1), category: 'study', minutes: 5 }]);
    expect([future.status, codeOf(future.body)]).toEqual([422, 'FUTURE_DATE']);
    const old = await put(s, [{ date: daysAgo(91), category: 'study', minutes: 5 }]);
    expect([old.status, codeOf(old.body)]).toEqual([422, 'OUTSIDE_RETENTION']);
    await put(s, [{ date: daysAgo(90), category: 'study', minutes: 5 }]).expect(200);
    await put(s, [{ date: '2026-02-30', category: 'study', minutes: 5 }]).expect(400);
  });

  it('refuses more than 1440 minutes in a day, counting rows already stored', async () => {
    const s = await tracking(w);
    await put(s, [{ date: daysAgo(2), category: 'study', minutes: 1441 }]).expect(400);
    await put(s, [{ date: daysAgo(2), category: 'study', minutes: 1000 }]).expect(200);
    const over = await put(s, [{ date: daysAgo(2), category: 'social', minutes: 441 }]).expect(422);
    expect(codeOf(over.body)).toBe('DAY_OVER_LIMIT');
    await put(s, [{ date: daysAgo(2), category: 'social', minutes: 440 }]).expect(200);
    // Replacing a stored row counts its new value, not old + new.
    await put(s, [
      { date: daysAgo(2), category: 'study', minutes: 900 },
      { date: daysAgo(2), category: 'social', minutes: 540 },
    ]).expect(200);
  });

  it('holds the 1440 limit under concurrent uploads (row lock on settings)', async () => {
    const s = await tracking(w);
    const results = await Promise.all(
      (['study', 'communication', 'social', 'entertainment'] as const).map((category) =>
        put(s, [{ date: daysAgo(3), category, minutes: 500 }]),
      ),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(2);
    const stored = await prisma.wbDailyTotal.aggregate({
      where: { userId: s.user.id },
      _sum: { minutes: true },
    });
    expect(stored._sum.minutes).toBe(1000);
  });

  it('caps an upload at 31 days and rejects duplicate rows', async () => {
    const s = await tracking(w);
    const days = Array.from({ length: 32 }, (_, i) => ({
      date: daysAgo(i),
      category: 'study',
      minutes: 1,
    }));
    await put(s, days).expect(400);
    await put(s, days.slice(0, 31)).expect(200, { stored: 31 });
    await put(s, [
      { date: today(), category: 'study', minutes: 1 },
      { date: today(), category: 'study', minutes: 2 },
    ]).expect(400);
  });
});

describe('timestamps', () => {
  it('returns settings timestamps on the real clock (not shifted by the database time zone)', async () => {
    const s = await user(w);
    const before = Date.now();
    const res = await s.http.get('/api/wellbeing/settings').expect(200);
    const paused = await s.http
      .post('/api/wellbeing/tracking')
      .send({ state: 'paused' })
      .expect(200);
    for (const at of [
      wellbeing.Settings.parse(res.body).updatedAt,
      wellbeing.Settings.parse(paused.body).pausedSince ?? '',
    ])
      expect(Math.abs(Date.parse(at) - before)).toBeLessThan(60_000);
  });
});
