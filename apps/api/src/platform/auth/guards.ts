import { timingSafeEqual } from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import type { Role } from '@universe/contracts';
import { env } from '../../config/env.js';
import { ApiError } from '../http.js';
import { csrfTokenFor } from './sessions.js';

/** Returns the signed-in user, or throws 401. */
export function authOf(req: Request) {
  if (!req.auth) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in required');
  return req.auth;
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  authOf(req);
  next();
};

export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!roles.includes(authOf(req).user.role))
      throw new ApiError(403, 'FORBIDDEN', 'You do not have access to this action');
    next();
  };

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const csrfFailed = () => new ApiError(403, 'CSRF_FAILED', 'Request could not be verified');

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Unsafe methods: a present Origin must be allowed, and with a session the X-CSRF-Token
 * header must match. Login is exempt from the token (it has no session to bind it to yet).
 */
export const csrfProtection: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.get('origin');
  if (origin !== undefined && !env.WEB_ORIGINS.includes(origin)) throw csrfFailed();
  if (!req.auth || req.path === '/api/auth/login') return next();
  const token = req.get('x-csrf-token');
  if (!token || !safeEqual(token, csrfTokenFor(req.auth.sessionId))) throw csrfFailed();
  next();
};

/** While a temporary password is in use, only these routes (and the public health checks) work. */
const PASSWORD_CHANGE_ALLOWED = new Set([
  '/api/auth/me',
  '/api/auth/change-password',
  '/api/auth/logout',
  '/api/auth/login',
]);

export const passwordChangeGate: RequestHandler = (req, _res, next) => {
  if (
    req.auth?.mustChangePassword &&
    !PASSWORD_CHANGE_ALLOWED.has(req.path) &&
    !req.path.startsWith('/api/health/')
  )
    throw new ApiError(403, 'PASSWORD_CHANGE_REQUIRED', 'Change your password to continue');
  next();
};
