import { z } from 'zod';
import { Role } from './role.js';

export const PublicUser = z.object({
  id: z.uuid(),
  email: z.string(),
  name: z.string(),
  role: Role,
});
export type PublicUser = z.infer<typeof PublicUser>;

export const LoginRequest = z
  .object({
    email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
    // The upper bound keeps oversized inputs away from the password hasher.
    password: z.string().min(1).max(256),
  })
  .strict();
export type LoginRequest = z.infer<typeof LoginRequest>;

export const SessionResponse = z.object({
  user: PublicUser,
  csrfToken: z.string(),
});
export type SessionResponse = z.infer<typeof SessionResponse>;
