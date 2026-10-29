import { z } from 'zod';

// Student Hub activity events (Person 1). Payloads carry ids, names and the session time only:
// never a student's skills, goals or progress.
const When = z.iso.datetime({ offset: true });
const request = { requestId: z.uuid() };

export const hubActivity = {
  // To the mentor.
  'hub.request_received': z
    .object({
      ...request,
      studentName: z.string(),
      note: z.string().nullable(),
      startsAt: When.nullable(),
    })
    .strict(),
  // To the student.
  'hub.request_accepted': z
    .object({
      ...request,
      mentorName: z.string(),
      startsAt: When,
      endsAt: When,
      locationLabel: z.string().nullable(),
    })
    .strict(),
  'hub.request_declined': z.object({ ...request, mentorName: z.string() }).strict(),
  // To the other party.
  'hub.request_cancelled': z
    .object({ ...request, byName: z.string(), startsAt: When.nullable() })
    .strict(),
} as const;
