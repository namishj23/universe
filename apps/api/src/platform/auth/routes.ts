import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { ChangePasswordRequest, LoginRequest, type SessionResponse } from '@universe/contracts';
import { closeUserStreams } from '../activity/broker.js';
import { audit } from '../audit/index.js';
import { prisma } from '../db.js';
import { ApiError, asyncHandler } from '../http.js';
import { anyRole, authOf, requireAuth } from './guards.js';
import { getDummyHash, hashPassword, verifyPassword } from './password.js';
import {
  clearSessionCookie,
  createSession,
  csrfTokenFor,
  setSessionCookie,
  toPublicUser,
} from './sessions.js';
import { clearFailures, emailHmac, recordFailure, reserveAttempt } from './throttle.js';

const tooManyAttempts = () =>
  new ApiError(429, 'TOO_MANY_ATTEMPTS', 'Too many sign-in attempts. Try again later.');
const invalidCredentials = () =>
  new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
const weakPassword = (message: string) => new ApiError(400, 'WEAK_PASSWORD', message);

/** Rejects a new password that reuses the current one or contains the email's local part. */
export function checkNewPassword(email: string, current: string, next: string): void {
  if (next === current) throw weakPassword('The new password must differ from the current one');
  const local = email.split('@')[0]?.toLowerCase() ?? '';
  // A one- or two-letter local part would ban most passwords without adding any protection.
  if (local.length >= 3 && next.toLowerCase().includes(local))
    throw weakPassword('The new password must not contain your email name');
}

/** A factory so each app instance (and each test) gets its own rate-limit counters. */
export function authRoutes(): Router {
  const router = Router();

  // ponytail: in-memory store, per process; a multi-instance deployment needs a shared store (Redis).
  const loginLimiter = rateLimit({
    windowMs: 60_000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) => next(tooManyAttempts()),
  });
  // Change-password verifies the current password, so a stolen session must not brute-force it.
  const changeLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => authOf(req).user.id,
    handler: (_req, _res, next) => next(tooManyAttempts()),
  });

  router.post(
    '/login',
    loginLimiter,
    asyncHandler(async (req, res) => {
      if (!req.is('application/json'))
        throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send the request as application/json');
      const { email, password } = LoginRequest.parse(req.body);

      // Known and unknown emails take the same path: same queries, one hash verification,
      // the same failure counting and lockout, and the same responses.
      const keyHash = emailHmac(email);
      const [user, allowed] = await Promise.all([
        prisma.user.findUnique({ where: { email } }),
        reserveAttempt(keyHash),
      ]);
      if (!allowed) throw tooManyAttempts();
      const passwordOk = await verifyPassword(
        user?.passwordHash ?? (await getDummyHash()),
        password,
      );

      if (!user || !passwordOk || !user.isActive) {
        await prisma.$transaction(async (tx) => {
          await recordFailure(tx, keyHash);
          await audit.record(tx, {
            actorId: null,
            action: 'auth.login_failed',
            metadata: { emailHmac: keyHash },
            requestId: req.id,
          });
        });
        throw invalidCredentials();
      }

      const previousSessionId = req.auth?.sessionId;
      const { token, session } = await prisma.$transaction(async (tx) => {
        await clearFailures(tx, keyHash);
        await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
        if (previousSessionId) await tx.session.deleteMany({ where: { id: previousSessionId } });
        await audit.record(tx, {
          actorId: user.id,
          action: 'auth.login',
          targetType: 'user',
          targetId: user.id,
          metadata: {},
          requestId: req.id,
        });
        return createSession(user.id, tx);
      });

      setSessionCookie(res, token);
      const body: SessionResponse = {
        user: toPublicUser(user),
        csrfToken: csrfTokenFor(session.id),
        mustChangePassword: user.mustChangePassword,
      };
      res.json(body);
    }),
  );

  router.post(
    '/logout',
    requireAuth,
    anyRole,
    asyncHandler(async (req, res) => {
      const { sessionId, user } = authOf(req);
      await prisma.$transaction(async (tx) => {
        await tx.session.deleteMany({ where: { id: sessionId } });
        await audit.record(tx, {
          actorId: user.id,
          action: 'auth.logout',
          targetType: 'user',
          targetId: user.id,
          metadata: {},
          requestId: req.id,
        });
      });
      clearSessionCookie(res);
      res.status(204).end();
    }),
  );

  router.get('/me', requireAuth, anyRole, (req, res) => {
    const { user, sessionId, mustChangePassword } = authOf(req);
    const body: SessionResponse = { user, csrfToken: csrfTokenFor(sessionId), mustChangePassword };
    res.json(body);
  });

  router.post(
    '/change-password',
    requireAuth,
    anyRole,
    changeLimiter,
    asyncHandler(async (req, res) => {
      const { user, sessionId } = authOf(req);
      const { currentPassword, newPassword } = ChangePasswordRequest.parse(req.body);
      const { passwordHash } = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { passwordHash: true },
      });
      if (!(await verifyPassword(passwordHash, currentPassword)))
        throw new ApiError(400, 'INVALID_CURRENT_PASSWORD', 'Current password is incorrect');
      checkNewPassword(user.email, currentPassword, newPassword);

      const newHash = await hashPassword(newPassword);
      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: { passwordHash: newHash, mustChangePassword: false },
        });
        await tx.session.deleteMany({ where: { userId: user.id, id: { not: sessionId } } });
        await audit.record(tx, {
          actorId: user.id,
          action: 'auth.password_changed',
          targetType: 'user',
          targetId: user.id,
          metadata: {},
          requestId: req.id,
        });
      });
      closeUserStreams(user.id, sessionId);
      res.status(204).end();
    }),
  );

  return router;
}
