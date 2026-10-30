import { z } from 'zod';
import { Actor } from '../actor.js';

// Module A · Student Hub: read-only functions other modules may call through
// `platform.modules.get('hub')`. Only the actor's own sessions and goal.

export const SessionsInput = z
  .object({ actor: Actor, from: z.date(), to: z.date() })
  .strict()
  .refine((x) => x.to > x.from, { message: 'to must be after from', path: ['to'] });

export const PublicSession = z
  .object({
    requestId: z.uuid(),
    startsAt: z.date(),
    endsAt: z.date(),
    /** The actor's side of the session. */
    as: z.enum(['student', 'mentor']),
    withName: z.string(),
    locationLabel: z.string().nullable(),
    locationStopId: z.guid().nullable(),
  })
  .strict();
export type PublicSession = z.infer<typeof PublicSession>;
export const SessionsOutput = z.array(PublicSession).max(100);

export const WeeklyGoalInput = z.object({ actor: Actor }).strict();
/** Null for anyone who is not a student or tracks no topics. */
export const WeeklyGoalOutput = z
  .object({
    target: z.number().int().positive(),
    done: z.number().int().nonnegative(),
    left: z.number().int().nonnegative(),
    weekEndsAt: z.date(),
  })
  .strict()
  .nullable();
