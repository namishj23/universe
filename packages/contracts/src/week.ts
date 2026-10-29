// The one week definition for every module: Sunday 00:00 to Saturday 23:59:59.999 in
// Asia/Kolkata. India has a fixed UTC+05:30 offset and no daylight saving, so plain arithmetic
// on the offset is exact.
export const WEEK_TIME_ZONE = 'Asia/Kolkata';
const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

/** The Asia/Kolkata calendar date (`YYYY-MM-DD`) of an instant. */
export const istDate = (at: Date): string =>
  new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

/** The instant the Asia/Kolkata day containing `at` began. */
export const istDayStart = (at: Date): Date =>
  new Date(Math.floor((at.getTime() + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS);

/** The instant an Asia/Kolkata calendar date (`YYYY-MM-DD`) begins. */
export const istDateStart = (date: string): Date =>
  new Date(Date.parse(`${date}T00:00:00.000Z`) - IST_OFFSET_MS);

export interface Week {
  /** Sunday 00:00 IST (inclusive). */
  start: Date;
  /** The next Sunday 00:00 IST (exclusive). */
  end: Date;
  /** Saturday 23:59:59.999 IST, for display ("ends Sat"). */
  endsAt: Date;
  /** The Sunday's IST calendar date, `YYYY-MM-DD`. */
  startDate: string;
}

/** The week containing `at`. */
export function weekOf(at: Date = new Date()): Week {
  const dayStart = istDayStart(at);
  const weekday = new Date(dayStart.getTime() + IST_OFFSET_MS).getUTCDay(); // 0 = Sunday
  const start = new Date(dayStart.getTime() - weekday * DAY_MS);
  const end = new Date(start.getTime() + 7 * DAY_MS);
  return { start, end, endsAt: new Date(end.getTime() - 1), startDate: istDate(start) };
}
