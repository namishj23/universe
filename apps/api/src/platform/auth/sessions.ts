import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { CookieOptions, Request, Response } from 'express';
import type { PublicUser } from '@universe/contracts';
import { env } from '../../config/env.js';
import type { User } from '../../generated/prisma/client.js';
import { prisma, type Db } from '../db.js';
import { asyncHandler } from '../http.js';
import { logger } from '../logger.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: { sessionId: string; user: PublicUser };
    }
  }
}

export const SESSION_COOKIE = 'uv_session';
const TTL_MS = env.SESSION_TTL_HOURS * 3_600_000;
const IDLE_MS = env.SESSION_IDLE_MINUTES * 60_000;
const TOUCH_EVERY_MS = 5 * 60_000;
const csrfKey = Buffer.from(env.CSRF_SECRET, 'base64');

const cookieOptions: CookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: env.COOKIE_SECURE,
  path: '/',
};

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Stable for the whole session, so every tab can use it; nothing extra is stored. */
export const csrfTokenFor = (sessionId: string) =>
  createHmac('sha256', csrfKey).update(sessionId).digest('base64url');

export const toPublicUser = (u: Pick<User, 'id' | 'email' | 'name' | 'role'>): PublicUser => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
});

const isLive = (s: { expiresAt: Date; lastSeenAt: Date; user: { isActive: boolean } }, now: number) =>
  s.expiresAt.getTime() > now && s.lastSeenAt.getTime() > now - IDLE_MS && s.user.isActive;

export async function createSession(userId: string, db: Db = prisma) {
  const token = randomBytes(32).toString('base64url');
  const session = await db.session.create({
    data: { userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + TTL_MS) },
  });
  return { token, session };
}

export const setSessionCookie = (res: Response, token: string) =>
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions, maxAge: TTL_MS });

export const clearSessionCookie = (res: Response) => res.clearCookie(SESSION_COOKIE, cookieOptions);

/** Loads the session and its user in one query; dead sessions are deleted and treated as signed out. */
export const loadSession = asyncHandler(async (req: Request, res, next) => {
  const token: unknown = req.cookies[SESSION_COOKIE];
  if (typeof token !== 'string' || token.length === 0 || token.length > 100) return next();

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  const now = Date.now();
  if (!session || !isLive(session, now)) {
    if (session) await prisma.session.deleteMany({ where: { id: session.id } });
    clearSessionCookie(res);
    return next();
  }
  if (now - session.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date(now) } });
  }
  req.auth = { sessionId: session.id, user: toPublicUser(session.user) };
  next();
});

/** Used by long-lived SSE streams to notice logout or expiry. */
export async function isSessionLive(sessionId: string): Promise<boolean> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { expiresAt: true, lastSeenAt: true, user: { select: { isActive: true } } },
  });
  return session !== null && isLive(session, Date.now());
}

export async function deleteDeadSessions(): Promise<number> {
  const now = Date.now();
  const { count } = await prisma.session.deleteMany({
    where: {
      OR: [{ expiresAt: { lte: new Date(now) } }, { lastSeenAt: { lte: new Date(now - IDLE_MS) } }],
    },
  });
  return count;
}

/** Deletes expired sessions now and hourly. The timer never keeps the process alive. */
export function startSessionCleanup(): () => void {
  const run = () => {
    deleteDeadSessions().then(
      (count) => logger.info({ count }, 'deleted expired sessions'),
      (err: unknown) => logger.error({ err }, 'session cleanup failed'),
    );
  };
  run();
  const timer = setInterval(run, 3_600_000).unref();
  return () => clearInterval(timer);
}
