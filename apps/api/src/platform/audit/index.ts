import { Router } from 'express';
import {
  AuditQuery,
  auditRegistry,
  type AuditAction,
  type AuditEntry,
  type AuditMetadata,
  type Page,
} from '@universe/contracts';
import type { ReqId } from 'pino-http';
import type { Db } from '../db.js';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../auth/guards.js';
import { asyncHandler } from '../http.js';
import { newestFirst, olderThan, toPage } from '../paging.js';

export interface AuditInput<A extends AuditAction> {
  /** null for system actions and for failed sign-ins. */
  actorId: string | null;
  action: A;
  targetType?: string;
  targetId?: string;
  metadata: AuditMetadata<A>;
  /** `req.id` (always a UUID string; pino-http's type is wider). */
  requestId?: ReqId;
}

/**
 * Appends one audit entry using the caller's transaction client, so the action and its entry
 * commit or roll back together. There is no update or delete path (a trigger also forbids both).
 *
 *   await prisma.$transaction(async (tx) => {
 *     await tx.user.update(...);
 *     await audit.record(tx, { actorId, action: 'admin.user_updated', targetType: 'user', ... });
 *   });
 */
async function record<A extends AuditAction>(tx: Db, input: AuditInput<A>): Promise<void> {
  const schema = (auditRegistry as Record<string, (typeof auditRegistry)[AuditAction]>)[
    input.action
  ];
  if (!schema) throw new Error(`Unknown audit action: ${input.action}`);
  await tx.auditLog.create({
    data: {
      actorId: input.actorId,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      metadata: schema.parse(input.metadata),
      requestId: typeof input.requestId === 'string' ? input.requestId : null,
    },
  });
}

export const audit = { record };

/** Mounted at /api/admin/audit; admins only. */
export const auditRoutes = Router();
auditRoutes.use(requireAuth, requireRole('admin'));

auditRoutes.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = AuditQuery.parse(req.query);
    const rows = await prisma.auditLog.findMany({
      where: {
        AND: [
          olderThan(q.cursor),
          {
            ...(q.action && { action: q.action }),
            ...(q.actorId && { actorId: q.actorId }),
            ...(q.targetType && { targetType: q.targetType }),
            ...(q.targetId && { targetId: q.targetId }),
          },
          q.actionPrefix ? { action: { startsWith: `${q.actionPrefix}.` } } : {},
          q.from ? { createdAt: { gte: new Date(q.from) } } : {},
          q.to ? { createdAt: { lt: new Date(q.to) } } : {},
        ],
      },
      orderBy: [...newestFirst],
      take: q.limit + 1,
      include: { actor: { select: { id: true, name: true } } },
    });
    const body: Page<AuditEntry> = toPage(rows, q.limit, (r) => ({
      id: r.id,
      actor: r.actor,
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId,
      metadata: r.metadata,
      requestId: r.requestId,
      createdAt: r.createdAt.toISOString(),
    }));
    res.json(body);
  }),
);
