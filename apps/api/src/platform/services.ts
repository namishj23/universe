// Companion services a module runs next to the API (Module E's exam service): their address and
// token from the environment, the loopback-only internal routes they call back on, and the
// idempotency keys those calls carry. Contract: docs/integration/exam-service.md.
import { createHash, timingSafeEqual } from 'node:crypto';
import express, { Router, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { ModuleId } from '@universe/contracts';
import { env } from '../config/env.js';
import { prisma, type Db } from './db.js';
import { ApiError } from './http.js';
import type { ModuleDefinition } from './modules/index.js';
import { schedule } from './scheduler.js';

export interface ServiceConfig {
  /** Base URL of the service (e.g. http://127.0.0.1:8000). */
  readonly url: URL;
  /** Shared secret sent as `X-Service-Token` and expected back on internal routes. */
  readonly token: string;
}

/** Services configured in the environment; a module whose service is absent is not installed. */
export function serviceConfigs(): Partial<Record<ModuleId, ServiceConfig>> {
  return env.EXAM_SERVICE_URL && env.SERVICE_TOKEN_EXAM
    ? { exam: Object.freeze({ url: new URL(env.EXAM_SERVICE_URL), token: env.SERVICE_TOKEN_EXAM }) }
    : {};
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
/** The socket's address, never X-Forwarded-For: a header can't make a remote caller local. */
export const isLoopback = (address: string | undefined) =>
  address !== undefined && LOOPBACK.has(address);

const digest = (s: string) => createHash('sha256').update(s).digest();
/** Constant-time comparison of SHA-256 digests, so a wrong length leaks nothing either. */
export const tokenMatches = (sent: string | undefined, expected: string) =>
  sent !== undefined && timingSafeEqual(digest(sent), digest(expected));

export const INTERNAL_JSON_LIMIT = '64kb';
export const INTERNAL_RATE_PER_MINUTE = 600;

/** Guards for `/internal/<id>`: loopback (unless allowed), token, rate limit, 64 kB JSON. */
function internalGuards(id: ModuleId, token: string): RequestHandler[] {
  const remoteOk = env.SERVICE_ALLOW_REMOTE;
  return [
    (req, _res, next) => {
      if (!remoteOk && !isLoopback(req.socket.remoteAddress))
        throw new ApiError(403, 'FORBIDDEN', 'Internal routes are local only');
      if (!tokenMatches(req.get('x-service-token'), token))
        throw new ApiError(401, 'UNAUTHENTICATED', 'Service token required');
      next();
    },
    rateLimit({
      windowMs: 60_000,
      limit: INTERNAL_RATE_PER_MINUTE,
      keyGenerator: () => id,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: (_req, _res, next) =>
        next(new ApiError(429, 'RATE_LIMITED', 'Too many internal calls. Slow down.')),
    }),
    express.json({ limit: INTERNAL_JSON_LIMIT }),
  ];
}

/**
 * Mounts each module's `internalRoutes` at `/internal/<id>` (no session, no CSRF), only for
 * modules whose service is configured. Called before the app's own JSON parser.
 */
export function mountInternalRoutes(
  app: express.Express,
  modules: readonly ModuleDefinition[],
  services: Partial<Record<ModuleId, ServiceConfig>>,
): void {
  for (const m of modules) {
    const service = services[m.id];
    if (!m.internalRoutes || !service) continue;
    const router = Router();
    m.internalRoutes(router);
    app.use(`/internal/${m.id}`, ...internalGuards(m.id, service.token), router);
  }
}

export const SERVICE_EVENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Claims an idempotency key inside the caller's transaction: true the first time, false for a
 * repeat (the unique key decides, so two concurrent repeats can't both win).
 */
export async function claimServiceEvent(tx: Db, module: ModuleId, key: string): Promise<boolean> {
  const inserted = await tx.$executeRaw`
    INSERT INTO platform_service_events (module, idempotency_key)
    VALUES (${module}, ${key}) ON CONFLICT DO NOTHING`;
  return inserted === 1;
}

/** Forgets idempotency keys older than 7 days (hourly). */
export const sweepServiceEvents = (now: Date) =>
  prisma.platformServiceEvent.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - SERVICE_EVENT_TTL_MS) } },
  });

schedule('platform.service_events', 60 * 60 * 1000, sweepServiceEvents);
