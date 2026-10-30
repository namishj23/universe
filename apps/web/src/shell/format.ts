// Dates and times as the design writes them, in the browser's time zone.
const fmt = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', options);
const hm = fmt({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const weekday = fmt({ weekday: 'short' });
const weekdayLong = fmt({ weekday: 'long' });
const dayMonth = fmt({ day: '2-digit', month: 'short' });
const ymd = fmt({ year: 'numeric', month: '2-digit', day: '2-digit' });

/** `22:14` */
export const clock = (d: Date | string) => hm.format(new Date(d));
/** `Friday 08:10` */
export const weekdayTime = (d: Date | string) => `${weekdayLong.format(new Date(d))} ${clock(d)}`;
/** Local calendar date `YYYY-MM-DD`. */
export const localDate = (d: Date) => {
  const [day, month, year] = ymd.format(d).split('/');
  return `${year}-${month}-${day}`;
};

/** Today `22:02`, this past week `Wed`, older `12 Oct`. */
export function shortWhen(at: Date | string, now = new Date()) {
  const d = new Date(at);
  if (localDate(d) === localDate(now)) return clock(d);
  if (now.getTime() - d.getTime() < 6 * 86_400_000) return weekday.format(d);
  return dayMonth.format(d);
}

/** Last sign-in: `now`, `22:10`, `Wed`, `12 Oct` or `never`. */
export function seenLabel(at: string | null, now = new Date()) {
  if (!at) return 'never';
  if (now.getTime() - new Date(at).getTime() < 60_000) return 'now';
  return shortWhen(at, now);
}

/** A calendar date `YYYY-MM-DD` as `THU 29` / `29 OCT`. */
const calendar = (date: string) => new Date(`${date}T12:00:00Z`);
const utc = (options: Intl.DateTimeFormatOptions) => fmt({ ...options, timeZone: 'UTC' });
export const dayLabel = (date: string) =>
  `${utc({ weekday: 'short' }).format(calendar(date))} ${date.slice(8, 10)}`.toUpperCase();
export const dayMonthLabel = (date: string) =>
  utc({ day: '2-digit', month: 'short' }).format(calendar(date)).toUpperCase();

/** `THU 29 OCT 2026 · 22:14 IST` */
export function longNow(now: Date) {
  const date = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
    .format(now)
    .replace(',', '');
  const zone =
    new Intl.DateTimeFormat('en-IN', { timeZoneName: 'short' })
      .formatToParts(now)
      .find((p) => p.type === 'timeZoneName')?.value ?? '';
  return `${date} · ${clock(now)} ${zone}`.toUpperCase();
}

/** `GOOD EVENING` */
export function partOfDay(now: Date) {
  const h = Number(clock(now).slice(0, 2));
  return h < 12 ? 'GOOD MORNING' : h < 17 ? 'GOOD AFTERNOON' : 'GOOD EVENING';
}

/** How the dashboard greets someone: `AARAV`, `PROF. IYER` (a title keeps the surname). */
export function shortName(name: string) {
  const parts = name.trim().split(/\s+/);
  const first = parts[0] ?? '';
  if (/^(prof|dr|mr|ms|mrs)\.?$/i.test(first) && parts.length > 1)
    return `${first} ${parts[parts.length - 1] ?? ''}`.toUpperCase();
  return first.toUpperCase();
}
