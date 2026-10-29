import { z } from 'zod';
import { Role } from './role.js';

export const PublicUser = z
  .object({
    id: z.uuid(),
    email: z.string(),
    name: z.string(),
    role: Role,
  })
  .meta({ id: 'PublicUser' });
export type PublicUser = z.infer<typeof PublicUser>;

/** Trimmed and lowercased: accounts are stored and looked up by the lowercased address. */
export const Email = z.string().trim().toLowerCase().max(254).pipe(z.email());

export const LoginRequest = z
  .object({
    email: Email,
    // The upper bound keeps oversized inputs away from the password hasher.
    password: z.string().min(1).max(256),
  })
  .strict();
export type LoginRequest = z.infer<typeof LoginRequest>;

export const SessionResponse = z
  .object({
    user: PublicUser,
    csrfToken: z.string(),
    /** While true, every route except /api/auth/me, /change-password and /logout returns 403. */
    mustChangePassword: z.boolean(),
  })
  .meta({ id: 'SessionResponse' });
export type SessionResponse = z.infer<typeof SessionResponse>;

/** 12–256 characters; the server also rejects reuse of the current password and the email's local part. */
export const NewPassword = z.string().min(12).max(256);

export const ChangePasswordRequest = z
  .object({ currentPassword: z.string().min(1).max(256), newPassword: NewPassword })
  .strict();
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequest>;
