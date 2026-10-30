import { z } from 'zod';
import { ActivityEvent } from '../activity/index.js';
import { PublicUser } from '../auth.js';
import { ModuleId } from '../modules.js';
import { ExamDashboardSummary } from './exam.js';
import { HubDashboardSummary } from './hub.js';
import { RidesDashboardSummary } from './rides.js';
import { WellbeingDashboardSummary } from './wellbeing.js';

/**
 * The `data` schema of each module's dashboard summary. Each owner adds
 * `dashboard/<module>.ts` and one line here; the platform validates every
 * provider's output against it (a mismatch is reported as `error`).
 */
export const dashboardSummaryRegistry: Partial<Record<ModuleId, z.ZodType>> = {
  hub: HubDashboardSummary,
  rides: RidesDashboardSummary,
  wellbeing: WellbeingDashboardSummary,
  exam: ExamDashboardSummary,
};

export const DashboardModuleEntry = z
  .object({
    id: ModuleId,
    status: z.enum(['ok', 'error', 'timeout']),
    data: z.unknown().optional(),
  })
  .meta({ id: 'DashboardModuleEntry' });
export type DashboardModuleEntry = z.infer<typeof DashboardModuleEntry>;

export const DashboardResponse = z
  .object({
    user: PublicUser,
    unreadCount: z.number().int().nonnegative(),
    latest: z.array(ActivityEvent).max(5),
    modules: z.array(DashboardModuleEntry),
  })
  .meta({ id: 'DashboardResponse' });
export type DashboardResponse = z.infer<typeof DashboardResponse>;

export {
  ExamDashboardSummary,
  HubDashboardSummary,
  RidesDashboardSummary,
  WellbeingDashboardSummary,
};

export * from './week.js';
