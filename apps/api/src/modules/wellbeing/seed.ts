// Wellbeing demo data for Aarav Mehta (idempotent; dates relative to today in Asia/Kolkata).
// Matches the design: tracking paused two hours ago, today 3 h 32 m (Study 1 h 35 m,
// Communication 52 m, Social 38 m, Entertainment 27 m), the previous six days averaging
// 264 minutes (4 h 24 m), Other not counted. Nothing for admins.
import { istDate, istDayStart, weekOf, WEEKLY_SUMMARY_TEXT } from '@universe/contracts';
import type { Platform } from '../../platform/modules/index.js';
import { addDays } from './service.js';

const TODAY = { study: 95, communication: 52, social: 38, entertainment: 27 } as const;
/** Oldest first: today−6 … today−1. */
export const PREVIOUS_DAYS = [252, 300, 282, 234, 264, 252] as const;
const HOUR = 3_600_000;

/** Splits a day's minutes in today's proportions, largest remainder so the parts sum exactly. */
function split(total: number) {
  const entries = Object.entries(TODAY);
  const weight = entries.reduce((a, [, w]) => a + w, 0);
  const exact = entries.map(([c, w]) => [c, (total * w) / weight] as const);
  const parts = exact.map(([c, x]) => ({ c, m: Math.floor(x), r: x % 1 }));
  let missing = total - parts.reduce((a, x) => a + x.m, 0);
  for (const x of [...parts].sort((a, b) => b.r - a.r)) if (missing-- > 0) x.m += 1;
  return parts.map(({ c, m }) => ({ category: c, minutes: m }));
}

export async function seedWellbeing(p: Platform, now: Date = new Date()): Promise<void> {
  const user = await p.prisma.user.findUnique({ where: { email: 'student@universe.test' } });
  if (!user) return;
  const today = istDate(now);
  // Paused on the hour two hours ago, but never before today began (the week strip shows it today).
  const pausedSince = new Date(
    Math.max(istDayStart(now).getTime(), Math.floor((now.getTime() - 2 * HOUR) / HOUR) * HOUR),
  );
  const rows = [
    ...PREVIOUS_DAYS.flatMap((total, i) =>
      split(total).map((r) => ({ date: addDays(today, i - 6), ...r })),
    ),
    ...Object.entries(TODAY).map(([category, minutes]) => ({ date: today, category, minutes })),
  ];
  await p.prisma.$transaction(async (tx) => {
    // Typed write: a JS Date passed to raw SQL here was read in the session time zone.
    const settings = {
      tracking: 'paused',
      pausedSince,
      categories: ['study', 'communication', 'social', 'entertainment'],
      retentionDays: 90,
      shareStudyWithHub: false,
    };
    await tx.wbSettings.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...settings },
      update: settings,
    });
    await tx.$executeRaw`
      INSERT INTO wb_daily_totals (user_id, date, category, minutes, updated_at)
      SELECT ${user.id}::uuid, d, c, m, now()
      FROM unnest(${rows.map((r) => r.date)}::text[]::date[], ${rows.map((r) => r.category)}::text[],
                  ${rows.map((r) => r.minutes)}::int[]) AS x(d, c, m)
      ON CONFLICT (user_id, date, category) DO UPDATE SET minutes = EXCLUDED.minutes, updated_at = now()`;
  });
  // Last week's summary was sent (the design's inbox), as the job does: a marker row so it is
  // never sent twice, and the notification (dated by the story seed).
  const lastWeek = addDays(weekOf(now).startDate, -7);
  await p.transaction(async (tx, emit) => {
    const [marker] = await tx.$queryRaw<{ user_id: string }[]>`
      INSERT INTO wb_weekly_summaries (user_id, week_start) VALUES (${user.id}::uuid, ${lastWeek}::date)
      ON CONFLICT (user_id, week_start) DO NOTHING RETURNING user_id`;
    if (marker)
      await emit({
        recipients: user.id,
        module: 'wellbeing',
        type: 'wellbeing.weekly_summary',
        payload: { message: WEEKLY_SUMMARY_TEXT },
      });
  });
}
