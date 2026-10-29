// Focus-session metrics. Everything here runs on the user's device; only daily category totals
// (see daily.ts) are ever sent to the server. Times are integer milliseconds internally.
import { EVENT_KINDS, type CleanEvent, type EventKind } from './events.js';
import { CATEGORIES, compileRules, type Category, type Rule } from './rules.js';
import type { FocusSession } from './session.js';

export const DEFAULT_IDLE_CAP_SECONDS = 300;

/** A stretch of time attributed to one domain. `from`/`to` are epoch milliseconds. */
export interface Slice {
  from: number;
  to: number;
  domain: string;
  category: Category;
  distracting: boolean;
}

export interface DomainTime {
  domain: string;
  category: Category;
  distracting: boolean;
  ms: number;
}

export interface Metrics {
  /** Stop (or `now`) minus start. */
  sessionMs: number;
  pausedMs: number;
  /** Session time minus paused time minus idle time (gaps beyond the cap, explicit idle). */
  activeMs: number;
  idleMs: number;
  /** Times the domain changed between consecutive counted events that carry a domain. */
  switches: number;
  /** Events inside the session and outside every pause. */
  countedEvents: number;
  distractingMs: number;
  categoryMs: Record<Category, number>;
  /** Local "see my data" view only; never sent to the server. Largest first. */
  domains: DomainTime[];
}

export interface MetricsOptions {
  idleCapSeconds?: number;
  /** Ends an open session or pause. */
  now: Date;
}

type Interval = [number, number];

const ATTRIBUTES: ReadonlySet<EventKind> = new Set(['visit', 'focus', 'active']);
const rank = (k: EventKind) => EVENT_KINDS.indexOf(k);

interface Timed {
  t: number;
  e: CleanEvent;
}

/** One total order on events, so results never depend on input order. */
export function sortEvents(events: readonly CleanEvent[]): Timed[] {
  return events
    .map((e) => ({ t: Date.parse(e.at), e }))
    .filter((x) => Number.isFinite(x.t))
    .sort(
      (a, b) =>
        a.t - b.t ||
        rank(a.e.kind) - rank(b.e.kind) ||
        (a.e.domain ?? '').localeCompare(b.e.domain ?? ''),
    );
}

/** Sorted, non-overlapping union. */
function merge(intervals: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const [a, b] of [...intervals].filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** `intervals` minus `holes` (both merged). */
function subtract(intervals: Interval[], holes: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const [a, b] of intervals) {
    let from = a;
    for (const [h0, h1] of holes) {
      if (h1 <= from || h0 >= b) continue;
      if (h0 > from) out.push([from, h0]);
      from = Math.max(from, h1);
    }
    if (from < b) out.push([from, b]);
  }
  return out;
}

const total = (intervals: Interval[]) => intervals.reduce((s, [a, b]) => s + (b - a), 0);

interface Frame {
  start: number;
  end: number;
  pauses: Interval[];
  cap: number;
  sorted: Timed[];
  counted: boolean[];
}

function frame(
  session: FocusSession,
  events: readonly CleanEvent[],
  { idleCapSeconds = DEFAULT_IDLE_CAP_SECONDS, now }: MetricsOptions,
): Frame {
  const start = Date.parse(session.startedAt);
  const end = Math.max(start, session.endedAt ? Date.parse(session.endedAt) : now.getTime());
  const pauses = merge(
    session.pauses.map((p): Interval => [
      Math.max(start, Date.parse(p.from)),
      Math.min(end, p.to ? Date.parse(p.to) : now.getTime()),
    ]),
  );
  const sorted = sortEvents(events);
  const counted = sorted.map(
    ({ t }) => t >= start && t < end && !pauses.some(([a, b]) => t >= a && t < b),
  );
  return { start, end, pauses, cap: Math.max(0, idleCapSeconds) * 1000, sorted, counted };
}

/**
 * The time slices of a session. A counted `visit`/`focus`/`active` event attributes time to the
 * current domain from its instant to the earliest of: the next event, the idle cap, the next
 * pause start and the session end. The current domain is the event's own, or else the last
 * counted event's domain since the session start or the latest pause (a pause forgets it).
 */
export function attribute(
  session: FocusSession,
  events: readonly CleanEvent[],
  rules: readonly Rule[],
  options: MetricsOptions,
): Slice[] {
  return slices(frame(session, events, options), rules);
}

function slices({ end, pauses, cap, sorted, counted }: Frame, rules: readonly Rule[]): Slice[] {
  const classify = compileRules(rules);
  const pauseIndex = (t: number) => pauses.filter(([a]) => a <= t).length;
  const out: Slice[] = [];
  let current: string | null = null;
  let currentPause = 0;
  sorted.forEach(({ t, e }, i) => {
    if (!counted[i]) return;
    if (pauseIndex(t) !== currentPause) current = null;
    if (e.domain !== undefined && ATTRIBUTES.has(e.kind)) {
      current = e.domain;
      currentPause = pauseIndex(t);
    }
    if (!ATTRIBUTES.has(e.kind) || current === null) return;
    const next = sorted[i + 1]?.t ?? Infinity;
    const pauseStart = pauses.find(([a]) => a > t)?.[0] ?? Infinity;
    const to = Math.min(next, t + cap, pauseStart, end);
    if (to > t) out.push({ from: t, to, domain: current, ...classify(current) });
  });
  return out;
}

/** Everything the focus-session screen shows, computed locally. */
export function computeMetrics(
  session: FocusSession,
  events: readonly CleanEvent[],
  rules: readonly Rule[],
  options: MetricsOptions,
): Metrics {
  const f = frame(session, events, options);
  const { start, end, pauses, cap, sorted, counted } = f;

  // Active time: the session (minus pauses) covered by an activity window. The start and every
  // event except `idle` open a window up to the next event, at most `cap` long.
  const firstAfterStart = sorted.find(({ t }) => t >= start)?.t ?? Infinity;
  const windows: Interval[] = [[start, Math.min(firstAfterStart, start + cap)]];
  sorted.forEach(({ t, e }, i) => {
    if (e.kind !== 'idle') windows.push([t, Math.min(sorted[i + 1]?.t ?? Infinity, t + cap)]);
  });
  const clipped = windows.map(([a, b]): Interval => [Math.max(a, start), Math.min(b, end)]);
  const activeMs = total(subtract(merge(clipped), pauses));
  const pausedMs = total(pauses);

  let switches = 0;
  let previous: string | null = null;
  sorted.forEach(({ e }, i) => {
    if (!counted[i] || e.domain === undefined) return;
    if (previous !== null && previous !== e.domain) switches += 1;
    previous = e.domain;
  });

  const categoryMs = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;
  const byDomain = new Map<string, DomainTime>();
  let distractingMs = 0;
  for (const s of slices(f, rules)) {
    const ms = s.to - s.from;
    categoryMs[s.category] += ms;
    if (s.distracting) distractingMs += ms;
    const d = byDomain.get(s.domain);
    if (d) d.ms += ms;
    else
      byDomain.set(s.domain, {
        domain: s.domain,
        category: s.category,
        distracting: s.distracting,
        ms,
      });
  }

  return {
    sessionMs: end - start,
    pausedMs,
    activeMs,
    idleMs: end - start - pausedMs - activeMs,
    switches,
    countedEvents: counted.filter(Boolean).length,
    distractingMs,
    categoryMs,
    domains: [...byDomain.values()].sort((a, b) => b.ms - a.ms || a.domain.localeCompare(b.domain)),
  };
}
