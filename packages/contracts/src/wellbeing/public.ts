import { z } from 'zod';
import { Actor } from '../actor.js';

// Module D · Wellbeing: the only value that ever leaves the module. A number only when the
// actor asks about themselves and has turned "share focus study minutes with the hub" on.

export const StudyMinutesInput = z.object({ actor: Actor, userId: z.uuid() }).strict();
export const StudyMinutesOutput = z.number().int().nonnegative().nullable();
