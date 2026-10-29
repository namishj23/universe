import type { Logger } from 'pino';
import type { input as ZodInput, output as ZodOutput, ZodType } from 'zod';
import * as contracts from '@universe/contracts';
import {
  publicApiRegistry,
  type PublicApi,
  type PublicApiId,
  type PublicApiSpec,
  type PublicApiSpecs,
} from '@universe/contracts';
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
import { schedule } from '../scheduler.js';
import type { ModuleDefinition } from './index.js';

/** Every cross-module call gets this long before it fails with 503 `MODULE_UNAVAILABLE`. */
export const PUBLIC_CALL_TIMEOUT_MS = 500;

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
  /**
   * Runs `fn(now)` every `everyMs` once the server starts (and once at start); the platform
   * stops the timers on shutdown. Name it `<module>.<job>`. Export the job's function too, so
   * tests call it with a frozen clock instead of waiting for a timer.
   */
  readonly schedule: typeof schedule;
  /**
   * Another module's read-only functions (its `publicApi`), or `undefined` when that module is
   * not installed. Resolve it when you need it (inside a handler), not in your factory: modules
   * are built in folder order. Every call is validated against `publicApiRegistry` in contracts,
   * limited to 500 ms and fails with 503 `MODULE_UNAVAILABLE`; pass `{ actor: user, ... }`.
   */
  readonly modules: { get<M extends PublicApiId>(id: M): PublicApi<M> | undefined };
}

/** What a module implements: parsed input in, its answer out (parsed again by the platform). */
export type PublicApiImpl<M extends PublicApiId> = {
  readonly [F in keyof PublicApiSpecs<M>]: PublicApiSpecs<M>[F] extends PublicApiSpec
    ? (
        input: ZodOutput<PublicApiSpecs<M>[F]['input']>,
        signal: AbortSignal,
      ) => Promise<ZodInput<PublicApiSpecs<M>[F]['output']>>
    : never;
};

type Impl = (input: unknown, signal: AbortSignal) => Promise<unknown>;
const installers = new WeakMap<Platform, (modules: readonly ModuleDefinition[]) => void>();

/** Makes the modules' `publicApi` reachable through `platform.modules.get` (loadModules). */
export function installModules(p: Platform, modules: readonly ModuleDefinition[]): void {
  installers.get(p)?.(modules);
}

const loggers = new Map<string, Logger>();

/** Builds the frozen platform object. `overrides` lets a test swap parts. */
export function createPlatform(overrides: Partial<Platform> = {}): Platform {
  const apis = new Map<string, object>();
  const log = logger.child({ module: 'platform' });

  /** The caller's view of one module's functions: validated, time-limited, never throwing raw. */
  function wrap(id: PublicApiId, impl: Record<string, Impl>, label: string) {
    const specs = publicApiRegistry[id] as Record<string, { input: ZodType; output: ZodType }>;
    const unavailable = () =>
      new ApiError(503, 'MODULE_UNAVAILABLE', `${label} is not available right now. Try again.`);
    return Object.freeze(
      Object.fromEntries(
        Object.entries(specs).map(([name, spec]) => {
          const fn = impl[name]!;
          const call = async (input: unknown) => {
            const parsed = spec.input.safeParse(input);
            // A caller's bug, not a user error: a 500 with the details only in the log.
            if (!parsed.success)
              throw new Error(`${id}.${name}: invalid input`, { cause: parsed.error });
            const signal = AbortSignal.timeout(PUBLIC_CALL_TIMEOUT_MS);
            let onAbort = () => {};
            const aborted = new Promise<never>((_, reject) => {
              onAbort = () => reject(new Error(`${id}.${name} timed out`));
              signal.addEventListener('abort', onAbort, { once: true });
            });
            try {
              return spec.output.parse(await Promise.race([fn(parsed.data, signal), aborted]));
            } catch (err) {
              log.warn({ err, target: id, fn: name }, 'cross-module call failed');
              throw unavailable();
            } finally {
              signal.removeEventListener('abort', onAbort);
            }
          };
          return [name, call];
        }),
      ),
    );
  }

  const p: Platform = Object.freeze({
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
    schedule,
    contracts,
    config: Object.freeze({ nodeEnv: env.NODE_ENV, isProduction: env.NODE_ENV === 'production' }),
    logger(moduleId: string) {
      let child = loggers.get(moduleId);
      if (!child) loggers.set(moduleId, (child = logger.child({ module: moduleId })));
      return child;
    },
    modules: Object.freeze({
      get: <M extends PublicApiId>(id: M) => apis.get(id) as PublicApi<M> | undefined,
    }),
    ...overrides,
  });
  installers.set(p, (modules) => {
    apis.clear();
    for (const m of modules)
      if (m.publicApi && m.id in publicApiRegistry)
        apis.set(m.id, wrap(m.id as PublicApiId, m.publicApi as Record<string, Impl>, m.label));
  });
  return p;
}

let shared: Platform | undefined;

/** The one instance built at startup and passed to every module. */
export const platform = () => (shared ??= createPlatform());
