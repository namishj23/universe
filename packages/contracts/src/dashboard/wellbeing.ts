import { z } from 'zod';
import { TrackingState } from '../wellbeing/index.js';

// Owner: Person 1. Only the owner ever sees it (the dashboard is per user).
export const WellbeingDashboardSummary = z
  .object({
    todayMinutes: z.number().int().nonnegative(),
    /** Absent when there is no 7-day average yet. */
    percentVsAverage: z.number().int().nonnegative().optional(),
    direction: z.enum(['under', 'over']).optional(),
    tracking: TrackingState,
  })
  .strict()
  .meta({ id: 'WellbeingDashboardSummary' });
