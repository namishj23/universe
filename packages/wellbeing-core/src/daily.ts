// Daily totals: the only numbers that leave the device. Slices are split at local midnight in
// the user's time zone (Asia/Kolkata by default; any IANA zone works through Intl) and rounded
// to whole minutes per day with one rule, so a day's rows always sum to its rounded total.
import { CATEGORIES, type Category } from './rules.js';
import type { Slice } from './metrics.js';

export const DEFAULT_TIME_ZONE = 'Asia/Kolkata';
/** What the server counts until the user changes it (Other is off). */
export const DEFAULT_COUNTED: readonly Category[] = [
  'study',
  'communication',
  'social',
  'entertainment',
];

export interface DailyRow {
  /** Local calendar date, `YYYY-MM-DD`. */
  date: string;
  category: Category;
  minutes: number;
}

export interface DailyOptions {
  timeZone?: string;
  /** Categories the user counts; others are left out entirely. */
  categories?: readonly Category[];
}

const MINUTE = 60_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function wallClock(ms: number, timeZone: string) {
  let f = formatters.get(timeZone);
  if (!f)
    formatters.set(
      timeZone,
      (f = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })),
    );
  const p = Object.fromEntries(f.formatToParts(ms).map((x) => [x.type, Number(x.value)]));
  return {
    y: p.year ?? 0,
    m: p.month ?? 1,
    d: p.day ?? 1,
    offset:
      Date.UTC(p.year ?? 0, (p.month ?? 1) - 1, p.day ?? 1, p.hour, p.minute, p.second) -
      Math.floor(ms / 1000) * 1000,
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The local calendar date of an instant. */
export function localDate(ms: number, timeZone: string = DEFAULT_TIME_ZONE): string {
  const { y, m, d } = wallClock(ms, timeZone);
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** The instant the next local day begins. */
function nextMidnight(ms: number, timeZone: string): number {
  const { y, m, d, offset } = wallClock(ms, timeZone);
  const wall = Date.UTC(y, m - 1, d + 1);
  // ponytail: one correction step handles an offset change on that day; a zone that skips
  // midnight itself (rare DST rules) could land an hour off.
  const guess = wall - offset;
  return wall - wallClock(guess, timeZone).offset;
}

/**
 * Splits slices across local midnights and rounds per day: the day's total is rounded half up
 * to whole minutes, each category gets its floor, and the minutes still missing go to the
 * categories with the largest remainders (ties in category order). Every counted category gets
 * a row on each day that has counted time, zeros included, so an upload replaces stale values.
 */
export function dailyTotals(slices: readonly Slice[], options: DailyOptions = {}): DailyRow[] {
  const timeZone = options.timeZone ?? DEFAULT_TIME_ZONE;
  const counted = CATEGORIES.filter((c) => (options.categories ?? DEFAULT_COUNTED).includes(c));
  const days = new Map<string, Map<Category, number>>();
  for (const s of slices) {
    if (!counted.includes(s.category)) continue;
    for (let a = s.from; a < s.to;) {
      const b = Math.min(s.to, nextMidnight(a, timeZone));
      const date = localDate(a, timeZone);
      const day = days.get(date) ?? new Map<Category, number>();
      day.set(s.category, (day.get(s.category) ?? 0) + (b - a));
      days.set(date, day);
      a = b;
    }
  }

  const rows: DailyRow[] = [];
  for (const date of [...days.keys()].sort()) {
    const day = days.get(date) ?? new Map<Category, number>();
    const ms = counted.map((c) => day.get(c) ?? 0);
    const target = Math.round(ms.reduce((a, b) => a + b, 0) / MINUTE);
    const minutes = ms.map((x) => Math.floor(x / MINUTE));
    const order = counted
      .map((_, i) => i)
      .sort((i, j) => ((ms[j] ?? 0) % MINUTE) - ((ms[i] ?? 0) % MINUTE) || i - j);
    let missing = target - minutes.reduce((a, b) => a + b, 0);
    for (const i of order) {
      if (missing <= 0) break;
      minutes[i] = (minutes[i] ?? 0) + 1;
      missing -= 1;
    }
    counted.forEach((category, i) => rows.push({ date, category, minutes: minutes[i] ?? 0 }));
  }
  return rows;
}
