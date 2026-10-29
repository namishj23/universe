import { z } from 'zod';

export const platformActivity = {
  'platform.announcement': z.object({ message: z.string().trim().min(1).max(500) }).strict(),
} as const;
