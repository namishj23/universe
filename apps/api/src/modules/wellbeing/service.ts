// Wellbeing data on the server: settings and one total in minutes per category per day.
// Every function takes the caller's own user id from the session, so no route can reach
// another person's rows. Nothing here logs or audits values (P5 decision).
import { istDate, weekOf, wellbeing as wb } from '@universe/contracts';
import type { Platform } from '../../platform/modules/index.js';

type Category = wb.Category;
type Tx = Parameters<Parameters<Platform['transaction']>[0]>[0];
type Db = Platform['prisma'] | Tx;

const CATEGORIES = wb.Category.options;
const DAY_MS = 86_400_000;
export const DAY_LIMIT = 1440;

/** `YYYY-MM-DD` ↔ the UTC-midnight `Date` Prisma uses for `@db.Date`. */
export const toDate = (day: string) => new Date(`${day}T00:00:00.000Z`);
export const toDay = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (day: string, n: number) =>
  toDay(new Date(toDate(day).getTime() + n * DAY_MS));

interface SettingsRow {
  tracking: string;
  pausedSince: Date | null;
  categories: string[];
  retentionDays: number;
  shareStudyWithHub: boolean;
  updatedAt: Date;
}

const inOrder = (cs: readonly string[]) => CATEGORIES.filter((c) => cs.includes(c));

export const toSettings = (s: SettingsRow): wb.Settings => ({
  tracking: wb.TrackingState.parse(s.tracking),
  pausedSince: s.pausedSince?.toISOString() ?? null,
  categories: inOrder(s.categories),
  retentionDays: s.retentionDays,
  shareStudyWithHub: s.shareStudyWithHub,
  updatedAt: s.updatedAt.toISOString(),
});

const toRow = (r: { date: Date; category: string; minutes: number }): wb.TotalRow => ({
  date: toDay(r.date),
  category: wb.Category.parse(r.category),
  minutes: r.minutes,
});

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

export function wellbeingService(p: Platform) {
  const db = p.prisma;
  const fail = (status: number, code: string, message: string) =>
    new p.http.ApiError(status, code, message);

  /**
   * Settings are created on first use with the defaults (tracking off). `updated_at` comes from
   * the JS clock, not the database's: the pg adapter reads timestamps in the session time zone,
   * so a database-clock value would come back shifted when that zone is not UTC (PROGRESS.md).
   */
  const ensure = (x: Db, userId: string) =>
    x.$executeRaw`INSERT INTO wb_settings (user_id, updated_at) VALUES (${userId}::uuid, ${new Date()})
      ON CONFLICT (user_id) DO NOTHING`;

  async function settingsRow(userId: string) {
    await ensure(db, userId);
    return db.wbSettings.findUniqueOrThrow({ where: { userId } });
  }

  /** Locks the user's settings row: uploads, tracking changes and deletes queue behind it. */
  async function lockSettings(tx: Tx, userId: string) {
    await ensure(tx, userId);
    await tx.$queryRaw`SELECT 1 FROM wb_settings WHERE user_id = ${userId}::uuid FOR UPDATE`;
    return tx.wbSettings.findUniqueOrThrow({ where: { userId } });
  }

  async function summary(userId: string, days: number, now: Date): Promise<wb.Summary> {
    const s = await settingsRow(userId);
    const today = istDate(now);
    const first = addDays(today, -(days - 1));
    const [rows, recordCount] = await Promise.all([
      db.wbDailyTotal.findMany({
        where: { userId, date: { gte: toDate(first), lte: toDate(today) } },
        select: { date: true, category: true, minutes: true },
      }),
      db.wbDailyTotal.count({ where: { userId } }),
    ]);
    const counted = new Set(s.categories);
    const byDay = new Map<string, Map<string, number>>();
    for (const r of rows) {
      const day = byDay.get(toDay(r.date)) ?? new Map<string, number>();
      day.set(r.category, r.minutes);
      byDay.set(toDay(r.date), day);
    }
    const countedTotal = (day: string) =>
      sum(
        [...(byDay.get(day) ?? new Map<string, number>())]
          .filter(([c]) => counted.has(c))
          .map(([, m]) => m),
      );
    const hasCounted = (day: string) =>
      [...(byDay.get(day)?.keys() ?? [])].some((c) => counted.has(c));

    const series = Array.from({ length: days }, (_, i) => addDays(first, i)).map((date) => ({
      date,
      minutes: countedTotal(date),
    }));
    const todayMinutes = countedTotal(today);
    const previous = series.slice(0, -1).filter((d) => hasCounted(d.date));
    const mean = previous.length ? sum(previous.map((d) => d.minutes)) / previous.length : 0;
    const comparison =
      mean > 0
        ? {
            average: Math.round(mean),
            percentVsAverage: Math.round(Math.abs(1 - todayMinutes / mean) * 100),
            direction: todayMinutes > mean ? ('over' as const) : ('under' as const),
          }
        : {};
    return {
      today,
      todayMinutes,
      categories: CATEGORIES.map((category) => ({
        category,
        minutes: byDay.get(today)?.get(category) ?? 0,
        counted: counted.has(category),
      })),
      series,
      ...comparison,
      recordCount,
      tracking: wb.TrackingState.parse(s.tracking),
      pausedSince: s.pausedSince?.toISOString() ?? null,
    };
  }

  return {
    async getSettings(userId: string) {
      return toSettings(await settingsRow(userId));
    },

    /** Turning a category off keeps its stored rows; delete is explicit. */
    async updateSettings(userId: string, body: wb.UpdateSettingsRequest) {
      await ensure(db, userId);
      const row = await db.wbSettings.update({
        where: { userId },
        data: {
          ...(body.categories && { categories: inOrder(body.categories) }),
          ...(body.retentionDays !== undefined && { retentionDays: body.retentionDays }),
          ...(body.shareStudyWithHub !== undefined && {
            shareStudyWithHub: body.shareStudyWithHub,
          }),
        },
      });
      return toSettings(row);
    },

    /** Pausing keeps the first pause time; turning tracking off never deletes data. */
    setTracking(userId: string, state: wb.TrackingState, now: Date) {
      return p.transaction(async (tx) => {
        const current = await lockSettings(tx, userId);
        const pausedSince =
          state !== 'paused' ? null : current.tracking === 'paused' ? current.pausedSince : now;
        return toSettings(
          await tx.wbSettings.update({ where: { userId }, data: { tracking: state, pausedSince } }),
        );
      });
    },

    /** The only way data reaches the server: an upsert of daily category totals. */
    uploadTotals(userId: string, rows: readonly wb.TotalRow[], now: Date) {
      return p.transaction(async (tx) => {
        const s = await lockSettings(tx, userId);
        if (s.tracking !== 'on')
          throw fail(
            409,
            'TRACKING_PAUSED',
            'Tracking is paused or off, so nothing is stored. Resume tracking first.',
          );
        if (rows.some((r) => !s.categories.includes(r.category)))
          throw fail(
            422,
            'CATEGORY_NOT_COUNTED',
            'A category you do not count was sent; it is not stored.',
          );
        const today = istDate(now);
        const oldest = addDays(today, -s.retentionDays);
        if (rows.some((r) => r.date > today))
          throw fail(422, 'FUTURE_DATE', 'Totals for future days are refused.');
        if (rows.some((r) => r.date < oldest))
          throw fail(
            422,
            'OUTSIDE_RETENTION',
            `Totals older than ${s.retentionDays} days are refused.`,
          );

        const dates = [...new Set(rows.map((r) => r.date))];
        const stored = await tx.wbDailyTotal.findMany({
          where: { userId, date: { in: dates.map(toDate) } },
          select: { date: true, category: true, minutes: true },
        });
        for (const date of dates) {
          const incoming = rows.filter((r) => r.date === date);
          const kept = stored.filter(
            (r) => toDay(r.date) === date && !incoming.some((i) => i.category === r.category),
          );
          if (sum([...incoming, ...kept].map((r) => r.minutes)) > DAY_LIMIT)
            throw fail(422, 'DAY_OVER_LIMIT', 'A day cannot hold more than 1440 minutes.');
        }

        await tx.$executeRaw`
          INSERT INTO wb_daily_totals (user_id, date, category, minutes, updated_at)
          SELECT ${userId}::uuid, d, c, m, now()
          FROM unnest(${rows.map((r) => r.date)}::text[]::date[], ${rows.map((r) => r.category)}::text[],
                      ${rows.map((r) => r.minutes)}::int[]) AS x(d, c, m)
          ON CONFLICT (user_id, date, category)
          DO UPDATE SET minutes = EXCLUDED.minutes, updated_at = now()`;
        return { stored: rows.length };
      });
    },

    summary,

    async records(userId: string, q: { cursor?: string | undefined; limit: number }) {
      let after: { date: Date; category: string } | undefined;
      if (q.cursor) {
        const [date, category] = Buffer.from(q.cursor, 'base64url').toString().split('|');
        const parsed = wb.RecordParams.safeParse({ date, category });
        if (!parsed.success) throw fail(400, 'BAD_CURSOR', 'Invalid cursor');
        after = { date: toDate(parsed.data.date), category: parsed.data.category };
      }
      const [rows, total] = await Promise.all([
        db.wbDailyTotal.findMany({
          where: {
            userId,
            ...(after && {
              OR: [
                { date: { lt: after.date } },
                { date: after.date, category: { gt: after.category } },
              ],
            }),
          },
          orderBy: [{ date: 'desc' }, { category: 'asc' }],
          take: q.limit + 1,
          select: { date: true, category: true, minutes: true },
        }),
        db.wbDailyTotal.count({ where: { userId } }),
      ]);
      const items = rows.slice(0, q.limit).map(toRow);
      const last = rows.length > q.limit ? items[items.length - 1] : undefined;
      return {
        items,
        nextCursor: last
          ? Buffer.from(`${last.date}|${last.category}`).toString('base64url')
          : null,
        total,
      };
    },

    async deleteRecord(userId: string, date: string, category: Category) {
      const { count } = await db.wbDailyTotal.deleteMany({
        where: { userId, date: toDate(date), category },
      });
      if (count === 0) throw fail(404, 'NOT_FOUND', 'No stored total for that day and category');
    },

    async deleteRange(userId: string, from: string, to: string) {
      const { count } = await db.wbDailyTotal.deleteMany({
        where: { userId, date: { gte: toDate(from), lte: toDate(to) } },
      });
      return { deleted: count };
    },

    async exportAll(userId: string, now: Date): Promise<wb.ExportDocument> {
      const s = await settingsRow(userId);
      const records = (
        await db.wbDailyTotal.findMany({
          where: { userId },
          orderBy: [{ date: 'asc' }, { category: 'asc' }],
          select: { date: true, category: true, minutes: true },
        })
      ).map(toRow);
      return {
        schemaVersion: 1,
        generatedAt: now.toISOString(),
        recordCount: records.length,
        settings: toSettings(s),
        records,
      };
    },

    /** Deletes every stored total (and the weekly-summary markers) and turns tracking off. */
    deleteAll(userId: string) {
      return p.transaction(async (tx) => {
        await lockSettings(tx, userId);
        const { count } = await tx.wbDailyTotal.deleteMany({ where: { userId } });
        await tx.wbWeeklySummary.deleteMany({ where: { userId } });
        await tx.wbSettings.update({
          where: { userId },
          data: { tracking: 'off', pausedSince: null },
        });
        return { deleted: count };
      });
    },

    /** Dashboard card: today's total, the comparison with the 7-day average, tracking state. */
    async dashboard(userId: string, now: Date) {
      const s = await summary(userId, 7, now);
      return {
        todayMinutes: s.todayMinutes,
        ...(s.percentVsAverage !== undefined && { percentVsAverage: s.percentVsAverage }),
        ...(s.direction && { direction: s.direction }),
        tracking: s.tracking,
      };
    },

    /**
     * For the Student Hub (wired by P6 through the platform, never imported by the hub): study
     * minutes this week (Sunday to Saturday, Asia/Kolkata), only for the user themselves and only
     * when they share it and count study. Otherwise null.
     */
    async studyMinutesThisWeek(
      { actorId, userId }: { actorId: string; userId: string },
      now: Date = new Date(),
    ): Promise<number | null> {
      if (actorId !== userId) return null;
      const s = await db.wbSettings.findUnique({ where: { userId } });
      if (!s?.shareStudyWithHub || !s.categories.includes('study')) return null;
      const week = weekOf(now);
      const { _sum } = await db.wbDailyTotal.aggregate({
        where: {
          userId,
          category: 'study',
          date: { gte: toDate(week.startDate), lte: toDate(addDays(week.startDate, 6)) },
        },
        _sum: { minutes: true },
      });
      return _sum.minutes ?? 0;
    },
  };
}

export type WellbeingService = ReturnType<typeof wellbeingService>;
