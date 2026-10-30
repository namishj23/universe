import { z } from 'zod';
import { Role } from '../role.js';

export const platformActivity = {
  'platform.announcement': z.object({ message: z.string().trim().min(1).max(500) }).strict(),
  /** To every active admin when an admin creates an account (the design's admin inbox). */
  'platform.user_created': z
    .object({ message: z.string().max(200), userName: z.string(), role: Role })
    .strict(),
} as const;
