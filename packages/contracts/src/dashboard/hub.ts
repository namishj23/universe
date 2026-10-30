import { z } from 'zod';

// Owner: Person 1. One shape per role; peer mentors (students) get the student summary.
const Count = z.number().int().nonnegative();

export const HubStudentSummary = z
  .object({
    kind: z.literal('student'),
    /** Tracked topics on the DSA sheet. */
    dsa: z.object({ solved: Count, total: Count, percent: z.number().int().min(0).max(100) }),
    /** Resources added by anyone in the last 7 days, and the subject with the most of them. */
    newResources: z.object({ count: Count, topSubject: z.string().nullable() }),
    goal: z.object({ done: Count, target: z.number().int().min(1).max(200) }),
    status: z.enum(['on_track', 'behind']),
  })
  .strict();

export const HubMentorSummary = z
  .object({
    kind: z.literal('mentor'),
    pendingRequests: Count,
    /** Distinct students accepted or completed this term (Jan–Jun or Jul–Dec, IST). */
    menteesThisTerm: Count,
    nextSessionAt: z.iso.datetime().nullable(),
  })
  .strict();

export const HubAdminSummary = z
  .object({
    kind: z.literal('admin'),
    resourcesTotal: Count,
    /** Added since this week began (Sunday 00:00 IST). */
    resourcesThisWeek: Count,
    /** Mentors whose current mentees fill at least 80 % of their capacity. */
    mentorsNearCapacity: Count,
  })
  .strict();

export const HubDashboardSummary = z
  .discriminatedUnion('kind', [HubStudentSummary, HubMentorSummary, HubAdminSummary])
  .meta({ id: 'HubDashboardSummary' });
