import { Router, type Request } from 'express';
import {
  dashboardSummaryRegistry,
  type DashboardModuleEntry,
  type DashboardResponse,
  type PublicUser,
} from '@universe/contracts';
import { actorSelect, toActivityEvent } from './activity/service.js';
import { authOf, requireAuth } from './auth/guards.js';
import { prisma } from './db.js';
import { asyncHandler } from './http.js';
import { visibleModules, type ModuleDefinition } from './modules/index.js';
import { newestFirst } from './paging.js';

export const SUMMARY_TIMEOUT_MS = 1_500;

/** Runs one provider with a timeout. It never throws: failures become `error` or `timeout`. */
async function summarise(
  module: ModuleDefinition,
  provider: NonNullable<ModuleDefinition['dashboardSummary']>,
  user: PublicUser,
  req: Request,
): Promise<DashboardModuleEntry> {
  const signal = AbortSignal.timeout(SUMMARY_TIMEOUT_MS);
  let onAbort = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(new Error('dashboard summary timed out'));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    const schema = dashboardSummaryRegistry[module.id];
    if (!schema) throw new Error(`no dashboard summary schema for ${module.id} in contracts`);
    const data = schema.parse(await Promise.race([provider(user, signal), aborted]));
    return { id: module.id, status: 'ok', data };
  } catch (err) {
    const status = signal.aborted ? 'timeout' : 'error';
    req.log.warn(
      { err, moduleId: module.id, requestId: req.id, status },
      'dashboard summary failed',
    );
    return { id: module.id, status };
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
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
  return router;
}
