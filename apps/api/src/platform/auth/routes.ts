import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { LoginRequest, type SessionResponse } from '@universe/contracts';
import { prisma } from '../db.js';
import { ApiError, asyncHandler } from '../http.js';
import { authOf, requireAuth } from './guards.js';
import { getDummyHash, verifyPassword } from './password.js';
import {
  clearSessionCookie,
  createSession,
  csrfTokenFor,
  setSessionCookie,
  toPublicUser,
} from './sessions.js';

const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60_000;

const tooManyAttempts = () =>
  new ApiError(429, 'TOO_MANY_ATTEMPTS', 'Too many sign-in attempts. Try again later.');
const invalidCredentials = () =>
  new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');

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

  router.post(
    '/login',
    loginLimiter,
    asyncHandler(async (req, res) => {
      if (!req.is('application/json'))
        throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send the request as application/json');
      const { email, password } = LoginRequest.parse(req.body);

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        await verifyPassword(await getDummyHash(), password);
        throw invalidCredentials();
      }
      if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) throw tooManyAttempts();

      if (!(await verifyPassword(user.passwordHash, password))) {
        const { failedLoginCount } = await prisma.user.update({
          where: { id: user.id },
          data: { failedLoginCount: { increment: 1 } },
          select: { failedLoginCount: true },
        });
        if (failedLoginCount >= MAX_FAILURES) {
          await prisma.user.update({
            where: { id: user.id },
            data: { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCK_MS) },
          });
        }
        throw invalidCredentials();
      }
      if (!user.isActive) throw invalidCredentials();

      const previousSessionId = req.auth?.sessionId;
      const { token, session } = await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
        });
        if (previousSessionId) await tx.session.deleteMany({ where: { id: previousSessionId } });
        return createSession(user.id, tx);
      });

      setSessionCookie(res, token);
      const body: SessionResponse = { user: toPublicUser(user), csrfToken: csrfTokenFor(session.id) };
      res.json(body);
    }),
  );

  router.post(
    '/logout',
    requireAuth,
    asyncHandler(async (req, res) => {
      await prisma.session.deleteMany({ where: { id: authOf(req).sessionId } });
      clearSessionCookie(res);
      res.status(204).end();
    }),
  );

  router.get('/me', requireAuth, (req, res) => {
    const { user, sessionId } = authOf(req);
    const body: SessionResponse = { user, csrfToken: csrfTokenFor(sessionId) };
    res.json(body);
  });

  return router;
}
