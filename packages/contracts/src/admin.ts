import { z } from 'zod';
import { Email } from './auth.js';
import { Role } from './role.js';

export const AdminUser = z
  .object({
    id: z.uuid(),
    email: z.string(),
    name: z.string(),
    role: Role,
    isActive: z.boolean(),
    mustChangePassword: z.boolean(),
    lastLoginAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'AdminUser' });
export type AdminUser = z.infer<typeof AdminUser>;

export const AdminUserQuery = z
  .object({
    cursor: z.string().min(1).max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    /** Partial, case-insensitive match on name or email. */
    q: z.string().trim().min(1).max(100).optional(),
    role: Role.optional(),
    active: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
  })
  .strict();
export type AdminUserQuery = z.infer<typeof AdminUserQuery>;

export const CreateUserRequest = z
  .object({ name: z.string().trim().min(1).max(100), email: Email, role: Role })
  .strict();
export type CreateUserRequest = z.infer<typeof CreateUserRequest>;

/** The temporary password is shown once; only its hash is stored. */
export const CreateUserResponse = z
  .object({ user: AdminUser, temporaryPassword: z.string() })
  .meta({ id: 'CreateUserResponse' });
export type CreateUserResponse = z.infer<typeof CreateUserResponse>;

export const UpdateUserRequest = z
  .object({ role: Role.optional(), isActive: z.boolean().optional() })
  .strict()
  .refine((b) => b.role !== undefined || b.isActive !== undefined, 'Change role or isActive');
export type UpdateUserRequest = z.infer<typeof UpdateUserRequest>;

export const ResetPasswordResponse = z
  .object({ temporaryPassword: z.string() })
  .meta({ id: 'ResetPasswordResponse' });
export type ResetPasswordResponse = z.infer<typeof ResetPasswordResponse>;
