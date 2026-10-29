import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import {
  AdminUserQuery,
  CreateUserRequest,
  UpdateUserRequest,
  type AdminUser,
  type AuditMetadata,
  type CreateUserResponse,
  type Page,
  type ResetPasswordResponse,
} from '@universe/contracts';
import type { User } from '../../generated/prisma/client.js';
import { closeUserStreams } from '../activity/broker.js';
import { audit } from '../audit/index.js';
import { authOf, requireAuth, requireRole } from '../auth/guards.js';
import { hashPassword } from '../auth/password.js';
import { prisma } from '../db.js';
import { ApiError, asyncHandler, IdParam } from '../http.js';
import { newestFirst, olderThan, toPage } from '../paging.js';

/** 18 random bytes → 24 base64url characters (144 bits). Shown once, stored only as a hash. */
const newTemporaryPassword = () => randomBytes(18).toString('base64url');

/** Prisma's `contains` passes % and _ through as LIKE wildcards; search for them literally. */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, '\\$&');

const toAdminUser = (u: User): AdminUser => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  isActive: u.isActive,
  mustChangePassword: u.mustChangePassword,
  lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
  createdAt: u.createdAt.toISOString(),
});

const cannotChangeSelf = (message: string) => new ApiError(409, 'CANNOT_CHANGE_SELF', message);
const notFound = () => new ApiError(404, 'NOT_FOUND', 'Not found');

/** Mounted at /api/admin/users; admins only. */
export const adminUserRoutes = Router();
adminUserRoutes.use(requireAuth, requireRole('admin'));

adminUserRoutes.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = AdminUserQuery.parse(req.query);
    const term = q.q && escapeLike(q.q);
    const rows = await prisma.user.findMany({
      where: {
        AND: [
          olderThan(q.cursor),
          q.role ? { role: q.role } : {},
          q.active === undefined ? {} : { isActive: q.active },
          term
            ? {
                OR: [
                  { name: { contains: term, mode: 'insensitive' } },
                  { email: { contains: term, mode: 'insensitive' } },
                ],
              }
            : {},
        ],
      },
      orderBy: [...newestFirst],
      take: q.limit + 1,
    });
    const body: Page<AdminUser> = toPage(rows, q.limit, toAdminUser);
    res.json(body);
  }),
);

adminUserRoutes.post(
  '/',
  asyncHandler(async (req, res) => {
    const admin = authOf(req).user;
    const input = CreateUserRequest.parse(req.body);
    const temporaryPassword = newTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    // A duplicate email fails on the unique index (P2002 → 409 CONFLICT).
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { ...input, passwordHash, mustChangePassword: true },
      });
      await audit.record(tx, {
        actorId: admin.id,
        action: 'admin.user_created',
        targetType: 'user',
        targetId: created.id,
        metadata: { role: created.role },
        requestId: req.id,
      });
      return created;
    });
    const body: CreateUserResponse = { user: toAdminUser(user), temporaryPassword };
    res.status(201).json(body);
  }),
);

adminUserRoutes.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const admin = authOf(req).user;
    const { id } = IdParam.parse(req.params);
    const change = UpdateUserRequest.parse(req.body);
    const removesAdmin =
      (change.role !== undefined && change.role !== 'admin') || change.isActive === false;
    if (id === admin.id && removesAdmin)
      throw cannotChangeSelf('You cannot demote or deactivate your own account');

    const user = await prisma.$transaction(async (tx) => {
      // Lock every active admin row (in id order, so concurrent requests cannot deadlock). A
      // concurrent request blocks here until this one commits, then sees the updated rows, so
      // two admins removing each other at once can never leave zero active admins.
      const activeAdmins = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM users WHERE role = 'admin' AND is_active ORDER BY id FOR UPDATE`;
      const before = await tx.user.findUnique({ where: { id } });
      if (!before) throw notFound();
      if (
        before.role === 'admin' &&
        before.isActive &&
        removesAdmin &&
        activeAdmins.filter((a) => a.id !== id).length === 0
      )
        throw new ApiError(
          409,
          'LAST_ADMIN',
          'The last active admin cannot be demoted or deactivated',
        );

      const after = await tx.user.update({
        where: { id },
        data: {
          ...(change.role !== undefined && { role: change.role }),
          ...(change.isActive !== undefined && { isActive: change.isActive }),
        },
      });
      if (!after.isActive) await tx.session.deleteMany({ where: { userId: id } });

      const metadata: AuditMetadata<'admin.user_updated'> = {
        ...(before.role !== after.role && { role: { from: before.role, to: after.role } }),
        ...(before.isActive !== after.isActive && {
          isActive: { from: before.isActive, to: after.isActive },
        }),
      };
      await audit.record(tx, {
        actorId: admin.id,
        action: 'admin.user_updated',
        targetType: 'user',
        targetId: id,
        metadata,
        requestId: req.id,
      });
      return after;
    });
    if (!user.isActive) closeUserStreams(id);
    res.json(toAdminUser(user));
  }),
);

adminUserRoutes.post(
  '/:id/reset-password',
  asyncHandler(async (req, res) => {
    const admin = authOf(req).user;
    const { id } = IdParam.parse(req.params);
    if (id === admin.id)
      throw cannotChangeSelf('Use /api/auth/change-password for your own account');
    const temporaryPassword = newTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.user.updateMany({
        where: { id },
        data: { passwordHash, mustChangePassword: true },
      });
      if (count === 0) throw notFound();
      await tx.session.deleteMany({ where: { userId: id } });
      await audit.record(tx, {
        actorId: admin.id,
        action: 'admin.user_password_reset',
        targetType: 'user',
        targetId: id,
        metadata: {},
        requestId: req.id,
      });
    });
    closeUserStreams(id);
    const body: ResetPasswordResponse = { temporaryPassword };
    res.json(body);
  }),
);
