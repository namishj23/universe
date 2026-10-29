import { z } from 'zod';
import { Role } from '../role.js';

const none = z.object({}).strict();
const change = <T extends z.ZodType>(t: T) => z.object({ from: t, to: t }).strict();

export const platformAudit = {
  'auth.login': none,
  /** Never the address or the password: only the HMAC that also keys `login_throttle`. */
  'auth.login_failed': z.object({ emailHmac: z.string().regex(/^[0-9a-f]{64}$/) }).strict(),
  'auth.logout': none,
  'auth.password_changed': none,
  'admin.user_created': z.object({ role: Role }).strict(),
  'admin.user_updated': z
    .object({ role: change(Role).optional(), isActive: change(z.boolean()).optional() })
    .strict(),
  'admin.user_password_reset': none,
  'platform.announcement_sent': z
    .object({ recipients: z.number().int().nonnegative(), roles: z.array(Role).optional() })
    .strict(),
} as const;
