import { z } from 'zod';

// Owner: Person 1. Replaced with the real summary in P4.
export const HubDashboardSummary = z
  .object({ status: z.literal('not_built') })
  .strict()
  .meta({ id: 'HubDashboardSummary' });
