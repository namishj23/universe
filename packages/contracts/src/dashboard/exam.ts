import { z } from 'zod';

/** The exam service's `GET /exam/dashboard-summary`, shown on the invigilator's card. */
export const ExamDashboardSummary = z
  .object({
    openFlags: z.number().int().nonnegative(),
    lastProcessedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict()
  .meta({ id: 'ExamDashboardSummary' });
export type ExamDashboardSummary = z.infer<typeof ExamDashboardSummary>;
