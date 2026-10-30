// The hourly wellbeing job: retention, then the weekly summary. Idempotent, so running it more
// often (or twice at once on two instances) changes nothing. Logs nothing about users.
import { istDate, weekOf, WEEKLY_SUMMARY_TEXT } from '@universe/contracts';
import type { Platform } from '../../platform/modules/index.js';
import { addDays } from './service.js';

export const JOB_NAME = 'wellbeing.hourly';
export const JOB_EVERY_MS = 3_600_000;
/** Summaries go out from Sunday 09:00 Asia/Kolkata for the week (Sunday–Saturday) that ended. */
const SUMMARY_AFTER_MS = 9 * 3_600_000;

export async function runOnce(p: Platform, now: Date): Promise<{ deleted: number; sent: number }> {
  // Rows older than each user's own window: date < today − retention_days.
  const deleted = await p.prisma.$executeRaw`
    DELETE FROM wb_daily_totals t USING wb_settings s
    WHERE t.user_id = s.user_id AND t.date < ${istDate(now)}::date - s.retention_days`;

  const week = weekOf(now);
  if (now.getTime() < week.start.getTime() + SUMMARY_AFTER_MS) return { deleted, sent: 0 };
  const from = addDays(week.startDate, -7);
  const to = addDays(week.startDate, -1);
  const sent = await p.transaction(async (tx, emit) => {
    // The marker row makes it once per user per week; tracking 'off' never gets one.
    const users = await tx.$queryRaw<{ user_id: string }[]>`
      INSERT INTO wb_weekly_summaries (user_id, week_start)
      SELECT s.user_id, ${from}::date
      FROM wb_settings s JOIN users u ON u.id = s.user_id AND u.is_active
      WHERE s.tracking IN ('on', 'paused')
        AND EXISTS (SELECT 1 FROM wb_daily_totals t
                    WHERE t.user_id = s.user_id AND t.date BETWEEN ${from}::date AND ${to}::date)
      ON CONFLICT (user_id, week_start) DO NOTHING
      RETURNING user_id`;
    if (users.length > 0)
      await emit({
        recipients: users.map((u) => u.user_id),
        module: 'wellbeing',
        type: 'wellbeing.weekly_summary',
        payload: { message: WEEKLY_SUMMARY_TEXT },
      });
    return users.length;
  });
  return { deleted, sent };
}
