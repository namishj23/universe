import { beforeAll, describe, expect, it } from 'vitest';
import { DashboardResponse, istDayStart, wellbeing } from '@universe/contracts';
import { prisma } from '../../src/platform/db.js';
import { account, daysAgo, setupWellbeing, today, tracking, type Wb } from './helpers.js';

let w: Wb;
beforeAll(async () => {
  w = await setupWellbeing();
});

describe("the design's Wellbeing screen (seeded Aarav)", () => {
  it('returns every value the TODAY, LAST 7 DAYS and privacy bar show', async () => {
    const s = await account(w, 'student@universe.test');
    const res = await s.http.get('/api/wellbeing/summary?days=7').expect(200);
    const body = wellbeing.Summary.parse(res.body);
    expect(body.today).toBe(today());
    expect(body.todayMinutes).toBe(212); // 3 h 32 m
    expect(body.categories).toEqual([
      { category: 'study', minutes: 95, counted: true },
      { category: 'communication', minutes: 52, counted: true },
      { category: 'social', minutes: 38, counted: true },
      { category: 'entertainment', minutes: 27, counted: true },
      { category: 'other', minutes: 0, counted: false },
    ]);
    expect(body.series.map((d) => d.minutes)).toEqual([252, 300, 282, 234, 264, 252, 212]);
    expect(body.series.map((d) => d.date)).toEqual([6, 5, 4, 3, 2, 1, 0].map(daysAgo));
    expect(body.average).toBe(264); // 4 h 24 m
    expect(body).toMatchObject({ percentVsAverage: 20, direction: 'under', recordCount: 28 });
    expect(body.tracking).toBe('paused');
    const pausedSince = Date.parse(body.pausedSince ?? '');
    // On the hour two hours ago, or the start of today (IST) when that was yesterday.
    if (pausedSince !== istDayStart(new Date()).getTime()) {
      expect(pausedSince % 3_600_000).toBe(0);
      expect(Date.now() - pausedSince).toBeGreaterThanOrEqual(2 * 3_600_000);
      expect(Date.now() - pausedSince).toBeLessThan(3 * 3_600_000);
    }
  });

  it('shows the same on the dashboard card, to the owner only', async () => {
    const s = await account(w, 'student@universe.test');
    const res = await s.http.get('/api/dashboard').expect(200);
    const entry = DashboardResponse.parse(res.body).modules.find((m) => m.id === 'wellbeing');
    expect(entry).toEqual({
      id: 'wellbeing',
      status: 'ok',
      data: { todayMinutes: 212, percentVsAverage: 20, direction: 'under', tracking: 'paused' },
    });
    const admin = await account(w, 'admin@universe.test');
    const adminDash = await admin.http.get('/api/dashboard').expect(200);
    expect(DashboardResponse.parse(adminDash.body).modules.map((m) => m.id)).not.toContain(
      'wellbeing',
    );
  });

  it('leaves out the comparison when there is no history', async () => {
    const s = await tracking(w);
    await s.http
      .put('/api/wellbeing/totals')
      .send({ rows: [{ date: today(), category: 'study', minutes: 30 }] });
    const body = wellbeing.Summary.parse(
      (await s.http.get('/api/wellbeing/summary').expect(200)).body,
    );
    expect(body.todayMinutes).toBe(30);
    expect(body).not.toHaveProperty('average');
    expect(body).not.toHaveProperty('percentVsAverage');
    expect(body).not.toHaveProperty('direction');
  });

  it('is idempotent to seed again', async () => {
    await w.modules.find((m) => m.id === 'wellbeing')?.seed?.();
    const s = await account(w, 'student@universe.test');
    expect(
      wellbeing.Summary.parse((await s.http.get('/api/wellbeing/summary').expect(200)).body)
        .recordCount,
    ).toBe(28);
  });
});

describe('see my data, delete, export', () => {
  async function withRows() {
    const s = await tracking(w);
    const rows = [0, 1, 2, 3, 4].flatMap((k) =>
      (['study', 'social'] as const).map((category) => ({
        date: daysAgo(k),
        category,
        minutes: 10 + k,
      })),
    );
    await s.http.put('/api/wellbeing/totals').send({ rows }).expect(200);
    return { s, rows };
  }

  it('pages exactly the stored rows, newest day first, with the total', async () => {
    const { s, rows } = await withRows();
    const seen: unknown[] = [];
    let cursor: string | null = null;
    do {
      const res = await s.http
        .get(`/api/wellbeing/records?limit=3${cursor ? `&cursor=${cursor}` : ''}`)
        .expect(200);
      const page = wellbeing.RecordsPage.parse(res.body);
      expect(page.total).toBe(10);
      seen.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toHaveLength(10);
    expect(seen[0]).toEqual({ date: today(), category: 'social', minutes: 10 });
    expect(new Set(seen.map((r) => JSON.stringify(r)))).toEqual(
      new Set(rows.map((r) => JSON.stringify(r))),
    );
    await s.http.get('/api/wellbeing/records?cursor=bm9wZQ').expect(400);
    await s.http.get('/api/wellbeing/records?limit=101').expect(400);
  });

  it('deletes one row (404 the second time) and a date range', async () => {
    const { s } = await withRows();
    await s.http.delete(`/api/wellbeing/records/${daysAgo(0)}/study`).expect(204);
    await s.http.delete(`/api/wellbeing/records/${daysAgo(0)}/study`).expect(404);
    await s.http.delete(`/api/wellbeing/records/${daysAgo(0)}/games`).expect(400);
    const range = await s.http
      .delete(`/api/wellbeing/records?from=${daysAgo(3)}&to=${daysAgo(1)}`)
      .expect(200);
    expect(range.body).toEqual({ deleted: 6 });
    await s.http.delete(`/api/wellbeing/records?from=${daysAgo(1)}&to=${daysAgo(3)}`).expect(400);
    expect(await prisma.wbDailyTotal.count({ where: { userId: s.user.id } })).toBe(3);
  });

  it('exports exactly the stored rows and the settings as a dated download', async () => {
    const { s } = await withRows();
    const res = await s.http.get('/api/wellbeing/export').expect(200);
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="wellbeing-export-${today()}.json"`,
    );
    const doc = wellbeing.ExportDocument.parse(res.body);
    const stored = await prisma.wbDailyTotal.findMany({
      where: { userId: s.user.id },
      orderBy: [{ date: 'asc' }, { category: 'asc' }],
    });
    expect(doc.records).toEqual(
      stored.map((r) => ({
        date: r.date.toISOString().slice(0, 10),
        category: r.category,
        minutes: r.minutes,
      })),
    );
    expect(doc).toMatchObject({ schemaVersion: 1, recordCount: 10 });
    expect(doc.settings.tracking).toBe('on');
  });

  it('deletes everything: count returned, tracking off, only settings left', async () => {
    const { s } = await withRows();
    await prisma.wbWeeklySummary.create({
      data: { userId: s.user.id, weekStart: new Date('2026-10-25') },
    });
    await s.http.delete('/api/wellbeing/data').send({}).expect(400);
    await s.http.delete('/api/wellbeing/data').send({ confirm: 'delete' }).expect(400);
    const res = await s.http.delete('/api/wellbeing/data').send({ confirm: 'DELETE' }).expect(200);
    expect(res.body).toEqual({ deleted: 10 });
    const settings = await s.http.get('/api/wellbeing/settings').expect(200);
    expect(settings.body).toMatchObject({ tracking: 'off', pausedSince: null });
    expect(await prisma.wbDailyTotal.count({ where: { userId: s.user.id } })).toBe(0);
    expect(await prisma.wbWeeklySummary.count({ where: { userId: s.user.id } })).toBe(0);
    expect(await prisma.wbSettings.count({ where: { userId: s.user.id } })).toBe(1);
    const summary = await s.http.get('/api/wellbeing/summary').expect(200);
    expect(summary.body).toMatchObject({ recordCount: 0, todayMinutes: 0, tracking: 'off' });
  });
});
