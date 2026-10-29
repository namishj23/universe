import { z } from 'zod';

// Owner: Person 1. Replaced with the real summary in P5.
export const WellbeingDashboardSummary = z
  .object({ status: z.literal('not_built') })
  .strict()
  .meta({ id: 'WellbeingDashboardSummary' });
