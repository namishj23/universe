import { z } from 'zod';
import { examAudit } from './exam.js';
import { hubAudit } from './hub.js';
import { platformAudit } from './platform.js';
import { ridesAudit } from './rides.js';

/**
 * Every audit action and its metadata schema. Each module owner adds
 * `audit/<module>.ts` (actions named `<module>.<verb>`) and spreads it in here.
 */
export const auditRegistry = {
  ...platformAudit,
  ...ridesAudit,
  ...hubAudit,
  ...examAudit,
} as const;

export type AuditAction = keyof typeof auditRegistry;
export type AuditMetadata<A extends AuditAction> = z.infer<(typeof auditRegistry)[A]>;

export const AuditEntry = z
  .object({
    id: z.uuid(),
    actor: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    action: z.string(),
    targetType: z.string().nullable(),
    targetId: z.string().nullable(),
    metadata: z.unknown(),
    requestId: z.string().nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'AuditEntry' });
export type AuditEntry = z.infer<typeof AuditEntry>;

export const AuditQuery = z
  .object({
    cursor: z.string().min(1).max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    action: z.string().min(1).max(100).optional(),
    /** Every action of one area: `auth` matches `auth.login`, `auth.logout`, … */
    actionPrefix: z
      .string()
      .regex(/^[a-z]+$/)
      .max(30)
      .optional(),
    actorId: z.uuid().optional(),
    targetType: z.string().min(1).max(50).optional(),
    targetId: z.string().min(1).max(100).optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();
export type AuditQuery = z.infer<typeof AuditQuery>;
