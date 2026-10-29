// Wellbeing demo data for Aarav Mehta (idempotent; dates relative to today in Asia/Kolkata).
// Matches the design: tracking paused two hours ago, today 3 h 32 m (Study 1 h 35 m,
// Communication 52 m, Social 38 m, Entertainment 27 m), the previous six days averaging
// 264 minutes (4 h 24 m), Other not counted. Nothing for admins.
import { istDate } from '@universe/contracts';
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
  const pausedSince = new Date(Math.floor((now.getTime() - 2 * HOUR) / HOUR) * HOUR);
  const rows = [
    ...PREVIOUS_DAYS.flatMap((total, i) =>
      split(total).map((r) => ({ date: addDays(today, i - 6), ...r })),
    ),
    ...Object.entries(TODAY).map(([category, minutes]) => ({ date: today, category, minutes })),
  ];
  await p.prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO wb_settings (user_id, tracking, paused_since, updated_at)
      VALUES (${user.id}::uuid, 'paused', ${pausedSince}, now())
      ON CONFLICT (user_id) DO UPDATE SET tracking = 'paused', paused_since = EXCLUDED.paused_since,
        categories = DEFAULT, retention_days = DEFAULT, share_study_with_hub = DEFAULT, updated_at = now()`;
    await tx.$executeRaw`
      INSERT INTO wb_daily_totals (user_id, date, category, minutes, updated_at)
      SELECT ${user.id}::uuid, d, c, m, now()
      FROM unnest(${rows.map((r) => r.date)}::text[]::date[], ${rows.map((r) => r.category)}::text[],
                  ${rows.map((r) => r.minutes)}::int[]) AS x(d, c, m)
      ON CONFLICT (user_id, date, category) DO UPDATE SET minutes = EXCLUDED.minutes, updated_at = now()`;
  });
}
