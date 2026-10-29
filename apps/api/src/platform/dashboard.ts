import { Router, type Request } from 'express';
import {
  dashboardSummaryRegistry,
  TimeZoneHeader,
  WeekProviderOutput,
  WeekQuery,
  type DashboardModuleEntry,
  type DashboardResponse,
  type PublicUser,
  type WeekItem,
  type WeekResponse,
} from '@universe/contracts';
import type { z } from 'zod';
import { actorSelect, toActivityEvent } from './activity/service.js';
import { authOf, requireAuth } from './auth/guards.js';
import { prisma } from './db.js';
import { asyncHandler } from './http.js';
import { visibleModules, type ModuleDefinition } from './modules/index.js';
import { newestFirst } from './paging.js';

export const SUMMARY_TIMEOUT_MS = 1_500;

type Outcome<T> = { status: 'ok'; data: T } | { status: 'error' | 'timeout' };

/**
 * Runs one module's provider with a timeout and parses its output. It never throws: failures
 * become `error` or `timeout` and are logged with the module and request IDs.
 */
async function runProvider<T>(
  moduleId: ModuleDefinition['id'],
  what: string,
  req: Request,
  run: (signal: AbortSignal) => Promise<unknown>,
  parse: (value: unknown) => T,
): Promise<Outcome<T>> {
  const signal = AbortSignal.timeout(SUMMARY_TIMEOUT_MS);
  let onAbort = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(new Error(`${what} timed out`));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return { status: 'ok', data: parse(await Promise.race([run(signal), aborted])) };
  } catch (err) {
    const status = signal.aborted ? 'timeout' : 'error';
    req.log.warn({ err, moduleId, requestId: req.id, status }, `${what} failed`);
    return { status };
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

async function summarise(
  module: ModuleDefinition,
  provider: NonNullable<ModuleDefinition['dashboardSummary']>,
  user: PublicUser,
  req: Request,
): Promise<DashboardModuleEntry> {
  const outcome = await runProvider(
    module.id,
    'dashboard summary',
    req,
    (signal) => provider(user, signal),
    (value) => {
      const schema = dashboardSummaryRegistry[module.id];
      if (!schema) throw new Error(`no dashboard summary schema for ${module.id} in contracts`);
      return schema.parse(value);
    },
  );
  return { id: module.id, ...outcome };
}

export const DEFAULT_TIME_ZONE = 'Asia/Kolkata';

const partsIn = (instant: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '00';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
    wallClockUtc: Date.UTC(
      Number(get('year')),
      Number(get('month')) - 1,
      Number(get('day')),
      Number(get('hour')),
      Number(get('minute')),
      Number(get('second')),
    ),
  };
};

/** `YYYY-MM-DD` plus `days`, on the calendar (no time zone involved). */
const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** The instant local midnight starts `date` in `timeZone`; corrects once for a DST change. */
export function zonedMidnight(date: string, timeZone: string): Date {
  const guess = Date.parse(`${date}T00:00:00Z`);
  const offsetAt = (t: number) => partsIn(new Date(t), timeZone).wallClockUtc - t;
  const first = guess - offsetAt(guess);
  return new Date(guess - offsetAt(first));
}

/** Items of one module, placed on their local day and formatted. */
function toWeekItems(
  module: ModuleDefinition,
  items: z.output<typeof WeekProviderOutput>,
  range: { from: Date; to: Date },
  timeZone: string,
) {
  return items.flatMap((item) => {
    const at = new Date(item.at);
    if (at < range.from || at >= range.to) return [];
    const { date, time } = partsIn(at, timeZone);
    const base = {
      module: module.id,
      title: item.title,
      ...(item.status && { status: item.status }),
      confirmed: item.confirmed,
      href: item.href,
    };
    const weekItem: WeekItem = item.allDay ? { ...base, allDay: true } : { ...base, time };
    return [{ date, order: module.order, item: weekItem }];
  });
}

/** `GET /api/dashboard`: everything the home screen needs in one request. */
export function dashboardRoutes(modules: readonly ModuleDefinition[]): Router {
  const router = Router();
  router.get(
    '/',
    requireAuth,
    asyncHandler(async (req, res) => {
      const { user } = authOf(req);
      const [unreadCount, latest, entries] = await Promise.all([
        prisma.activityEvent.count({ where: { recipientId: user.id, readAt: null } }),
        prisma.activityEvent.findMany({
          where: { recipientId: user.id },
          orderBy: [...newestFirst],
          take: 5,
          include: actorSelect,
        }),
        Promise.all(
          visibleModules(modules, user.role).flatMap((m) =>
            m.dashboardSummary ? [summarise(m, m.dashboardSummary, user, req)] : [],
          ),
        ),
      ]);
      const body: DashboardResponse = {
        user,
        unreadCount,
        latest: latest.map(toActivityEvent),
        modules: entries,
      };
      res.json(body);
    }),
  );

  /** `GET /api/dashboard/week`: seven days of dated items from every visible module. */
  router.get(
    '/week',
    requireAuth,
    asyncHandler(async (req, res) => {
      const { user } = authOf(req);
      const query = WeekQuery.parse(req.query);
      const timeZone = TimeZoneHeader.optional().parse(req.get('x-timezone')) ?? DEFAULT_TIME_ZONE;
      const from = query.from ?? partsIn(new Date(), timeZone).date;
      const dates = Array.from({ length: 7 }, (_, i) => addDays(from, i));
      const range = {
        from: zonedMidnight(from, timeZone),
        to: zonedMidnight(addDays(from, 7), timeZone),
      };

      const providers = visibleModules(modules, user.role).flatMap((m) =>
        m.weekItems ? [{ module: m, provider: m.weekItems }] : [],
      );
      const outcomes = await Promise.all(
        providers.map(({ module, provider }) =>
          runProvider(
            module.id,
            'week items',
            req,
            (signal) => provider(user, range, signal),
            (value) => WeekProviderOutput.parse(value),
          ),
        ),
      );

      const placed = outcomes.flatMap((outcome, i) =>
        outcome.status === 'ok' && providers[i]
          ? toWeekItems(providers[i].module, outcome.data, range, timeZone)
          : [],
      );
      const sortKey = (p: (typeof placed)[number]) => ('time' in p.item ? p.item.time : '');
      const body: WeekResponse = {
        from,
        timeZone,
        days: dates.map((date) => ({
          date,
          items: placed
            .filter((p) => p.date === date)
            .sort(
              (a, b) =>
                sortKey(a).localeCompare(sortKey(b)) ||
                a.order - b.order ||
                a.item.title.localeCompare(b.item.title),
            )
            .map((p) => p.item),
        })),
        modules: providers.map(({ module }, i) => ({
          id: module.id,
          status: outcomes[i]?.status ?? 'error',
        })),
      };
      res.json(body);
    }),
  );
  return router;
}
