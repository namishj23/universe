import type { Logger } from 'pino';
import * as contracts from '@universe/contracts';
import { env } from '../../config/env.js';
import { pushEvent } from '../activity/broker.js';
import { emit, transaction } from '../activity/service.js';
import { audit } from '../audit/index.js';
import { authOf, requireRole } from '../auth/guards.js';
import { prisma } from '../db.js';
import { saveFile } from '../files/index.js';
import { ApiError, asyncHandler } from '../http.js';
import { logger } from '../logger.js';
import { decodeCursor, encodeCursor, newestFirst, olderThan, toPage } from '../paging.js';

/**
 * Everything a module may use from the platform, handed to its factory
 * (`export default (platform) => definition`). Modules never import platform files, so a
 * CommonJS module (rides) and TypeScript modules share the same Prisma client, SSE broker and
 * audit log in dev, tests and the build. Holds no environment variables or secrets.
 */
export interface Platform {
  readonly prisma: typeof prisma;
  readonly transaction: typeof transaction;
  readonly emit: typeof emit;
  /** Ephemeral SSE event to users' open streams (not stored); name `<module>.<event>`. */
  readonly pushEvent: typeof pushEvent;
  readonly audit: { readonly record: typeof audit.record };
  readonly authOf: typeof authOf;
  readonly requireRole: typeof requireRole;
  readonly http: { readonly ApiError: typeof ApiError; readonly asyncHandler: typeof asyncHandler };
  readonly paging: {
    readonly encodeCursor: typeof encodeCursor;
    readonly decodeCursor: typeof decodeCursor;
    readonly olderThan: typeof olderThan;
    readonly toPage: typeof toPage;
    readonly newestFirst: typeof newestFirst;
  };
  /** Stores server-held bytes (seeds); users upload through `POST /api/files/<purpose>`. */
  readonly files: { readonly save: typeof saveFile };
  /** Shared Zod schemas, for modules that cannot import `@universe/contracts` (CommonJS). */
  readonly contracts: typeof contracts;
  readonly config: { readonly nodeEnv: typeof env.NODE_ENV; readonly isProduction: boolean };
  /** A child logger tagged with the module id (one per module, cached). */
  logger(moduleId: string): Logger;
}

const loggers = new Map<string, Logger>();

/** Builds the frozen platform object. `overrides` lets a test swap parts. */
export function createPlatform(overrides: Partial<Platform> = {}): Platform {
  return Object.freeze({
    prisma,
    transaction,
    emit,
    pushEvent,
    audit: Object.freeze({ record: audit.record }),
    authOf,
    requireRole,
    http: Object.freeze({ ApiError, asyncHandler }),
    paging: Object.freeze({ encodeCursor, decodeCursor, olderThan, toPage, newestFirst }),
    files: Object.freeze({ save: saveFile }),
    contracts,
    config: Object.freeze({ nodeEnv: env.NODE_ENV, isProduction: env.NODE_ENV === 'production' }),
    logger(moduleId: string) {
      let child = loggers.get(moduleId);
      if (!child) loggers.set(moduleId, (child = logger.child({ module: moduleId })));
      return child;
    },
    ...overrides,
  });
}

let shared: Platform | undefined;

/** The one instance built at startup and passed to every module. */
export const platform = () => (shared ??= createPlatform());
