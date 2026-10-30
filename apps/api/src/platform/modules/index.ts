import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Router, type Express, type RequestHandler } from 'express';
import { z } from 'zod';
import type { ZodOpenApiPathsObject } from 'zod-openapi';
import {
  ModuleId,
  publicApiRegistry,
  Role,
  type ModuleInfo,
  type PublicUser,
} from '@universe/contracts';
import { anyRole, authOf, requireAuth, requireRole } from '../auth/guards.js';
import { installModules, platform as sharedPlatform, type Platform } from './platform.js';

export type { Platform, PublicApiImpl } from './platform.js';

/** A stored file as a purpose's `authorizeRead` sees it. */
export interface StoredFile {
  id: string;
  ownerId: string;
  module: string;
  purpose: string;
}

/** An upload kind a module accepts, with its own rules. Ids are `<module>.<name>`. */
export interface FilePurpose {
  id: string;
  /** Real types detected from the bytes, e.g. `application/pdf`. */
  mimeTypes: readonly string[];
  maxBytes: number;
  /** Decides downloads; a `false` answer is a 404 so ids cannot be probed. */
  authorizeRead(user: PublicUser, file: StoredFile): boolean | Promise<boolean>;
  /**
   * Which of these file ids the module still references (one batched lookup). A referenced
   * file can't be deleted (409 `FILE_IN_USE`) and the sweep never removes its bytes.
   */
  inUse?(fileIds: readonly string[]): Promise<ReadonlySet<string>>;
}

/**
 * What a module's factory returns. `apps/api/src/modules/<id>/index.(ts|js)` default-exports
 * `(platform: Platform) => ModuleDefinition` (CommonJS: `module.exports = (platform) => ...`).
 * The platform mounts `router` at `/api/<id>` behind `requireAuth` and a check that the user's
 * role is in `roles`.
 */
export interface ModuleDefinition {
  id: ModuleId;
  label: string;
  /** Navigation order, ascending. */
  order: number;
  roles: readonly Role[];
  router: Router;
  /** Data for `GET /api/dashboard`; must match `dashboardSummaryRegistry[id]` in contracts. */
  dashboardSummary?: (user: PublicUser, signal: AbortSignal) => Promise<unknown>;
  /**
   * Dated items for the dashboard's week strip (`GET /api/dashboard/week`): the user's items
   * in `[from, to)`, matching `WeekProviderOutput` in contracts. Same 1.5 s budget as the
   * summary; respect `signal`.
   */
  weekItems?: (
    user: PublicUser,
    range: { from: Date; to: Date },
    signal: AbortSignal,
  ) => Promise<unknown>;
  /**
   * Read-only functions other modules may call (`platform.modules.get(id)`): exactly the ones
   * `publicApiRegistry[id]` in contracts lists. Each gets parsed input and an AbortSignal
   * (500 ms); decide what `input.actor` may see, and never hand out rows of your tables.
   */
  publicApi?: Record<string, (input: never, signal: AbortSignal) => Promise<unknown>>;
  /** Demo data, run by `npm run db:seed` after the platform seed. Must be idempotent. */
  seed?: () => Promise<void>;
  /** Modules whose seed must run before this one's (e.g. hub's slots name rides stops). */
  seedAfter?: readonly ModuleId[];
  filePurposes?: readonly FilePurpose[];
  /** OpenAPI paths for this module's routes, relative to `/api/<id>` (e.g. `/rides/{id}`). */
  openapi?: ZodOpenApiPathsObject;
}

const fn = z.custom<(...args: never[]) => unknown>(
  (v) => typeof v === 'function',
  'must be a function',
);

const Definition = z
  .object({
    id: ModuleId,
    label: z.string().min(1).max(40),
    order: z.number().int(),
    roles: z.array(Role).min(1),
    router: z.custom<Router>(
      (v) => typeof v === 'function' && typeof (v as { use?: unknown }).use === 'function',
      'must be an Express Router',
    ),
    dashboardSummary: fn.optional(),
    weekItems: fn.optional(),
    publicApi: z.record(z.string(), fn).optional(),
    seed: fn.optional(),
    seedAfter: z.array(ModuleId).optional(),
    filePurposes: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z]+\.[a-z0-9_-]+$/),
            mimeTypes: z.array(z.string().min(3)).min(1),
            maxBytes: z.number().int().positive(),
            authorizeRead: fn,
            inUse: fn.optional(),
          })
          .strict(),
      )
      .optional(),
    openapi: z.record(z.string().startsWith('/'), z.unknown()).optional(),
  })
  .strict();

/** Checks every definition; throws one error that lists every problem. */
export function validateModules(found: { folder: string; value: unknown }[]): ModuleDefinition[] {
  const problems: string[] = [];
  const seen = new Map<string, string>();
  const purposes = new Set<string>();
  for (const { folder, value } of found) {
    const parsed = Definition.safeParse(value);
    if (!parsed.success) {
      for (const issue of parsed.error.issues)
        problems.push(`${folder}: ${issue.path.join('.') || '(definition)'}: ${issue.message}`);
      continue;
    }
    const { id } = parsed.data;
    if (id !== folder) problems.push(`${folder}: id "${id}" must match its folder name`);
    const other = seen.get(id);
    if (other)
      problems.push(`${folder}: id "${id}" (base path /api/${id}) is already used by ${other}`);
    seen.set(id, folder);
    const specs = (publicApiRegistry as Record<string, Record<string, unknown> | undefined>)[id];
    const offered = Object.keys(parsed.data.publicApi ?? {}).sort();
    if (offered.length > 0 && !specs)
      problems.push(`${folder}: publicApi needs an entry in publicApiRegistry (contracts)`);
    else if (
      offered.length > 0 &&
      offered.join() !==
        Object.keys(specs ?? {})
          .sort()
          .join()
    )
      problems.push(
        `${folder}: publicApi must implement exactly ${Object.keys(specs ?? {}).join(', ')}`,
      );
    for (const p of parsed.data.filePurposes ?? []) {
      if (!p.id.startsWith(`${id}.`))
        problems.push(`${folder}: file purpose ${p.id} must start with "${id}."`);
      if (purposes.has(p.id)) problems.push(`${folder}: file purpose ${p.id} is registered twice`);
      purposes.add(p.id);
    }
  }
  if (problems.length > 0)
    throw new Error(`Invalid module definitions:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  // Return the modules' own objects: parsing would copy them.
  return found.map(({ value }) => value as ModuleDefinition);
}

// Same relative path from src/platform/modules (dev, tests) and dist/platform/modules (built).
const MODULES_DIR = new URL('../../modules/', import.meta.url);

/** The default export of a module folder. */
export type ModuleFactory = (platform: Platform) => ModuleDefinition;

export interface LoadOptions {
  dir?: URL;
  /** Defaults to the one shared instance; tests may pass their own. */
  platform?: Platform;
}

/**
 * Imports every `modules/<folder>/index.ts` (source) or `index.js` (built, or a CommonJS
 * module such as rides), calls its factory with the platform and validates the definitions.
 * Called once at startup.
 */
export async function loadModules({
  dir = MODULES_DIR,
  platform = sharedPlatform(),
}: LoadOptions = {}): Promise<ModuleDefinition[]> {
  if (!existsSync(dir)) return [];
  const folders = (await readdir(dir, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  const found: { folder: string; value: unknown }[] = [];
  const problems: string[] = [];
  for (const folder of folders) {
    const entry = ['index.ts', 'index.js']
      .map((name) => fileURLToPath(new URL(`${folder}/${name}`, dir)))
      .find((path) => existsSync(path));
    if (!entry) {
      problems.push(`${folder}: no index.ts or index.js`);
      continue;
    }
    const mod = (await import(entry)) as { default?: unknown };
    if (typeof mod.default !== 'function') {
      problems.push(`${folder}: must default-export a factory (platform) => definition`);
      continue;
    }
    found.push({ folder, value: (mod.default as ModuleFactory)(platform) });
  }
  if (problems.length > 0)
    throw new Error(`Invalid module definitions:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  const modules = validateModules(found);
  installModules(platform, modules);
  return modules;
}

/**
 * Runs every module's seed once, each after the modules in its `seedAfter` (then by id).
 * Used by `npm run db:seed`, `npm run demo:reset` and tests.
 */
export async function seedModules(
  modules: readonly ModuleDefinition[],
  onSeeded: (id: ModuleId) => void = () => {},
): Promise<void> {
  const byId = new Map(modules.map((m) => [m.id, m]));
  const done = new Set<string>();
  const visit = async (m: ModuleDefinition, path: readonly string[]): Promise<void> => {
    if (done.has(m.id)) return;
    if (path.includes(m.id)) throw new Error(`seedAfter cycle: ${[...path, m.id].join(' → ')}`);
    for (const dep of m.seedAfter ?? []) {
      const before = byId.get(dep);
      if (before) await visit(before, [...path, m.id]);
    }
    done.add(m.id);
    if (!m.seed) return;
    await m.seed();
    onSeeded(m.id);
  };
  for (const m of [...modules].sort((a, b) => a.id.localeCompare(b.id))) await visit(m, []);
}

/** The modules a role may use, in navigation order. */
export const visibleModules = (modules: readonly ModuleDefinition[], role: Role) =>
  modules.filter((m) => m.roles.includes(role)).sort((a, b) => a.order - b.order);

export const basePath = (m: Pick<ModuleDefinition, 'id'>) => `/api/${m.id}`;

/**
 * Mounts each module behind the outer guard, so a module can never forget it. Returns the
 * guards per base path for the route table (`docs/ROLES.md`).
 */
export function mountModules(
  app: Express,
  modules: readonly ModuleDefinition[],
): { prefix: string; router: Router; guards: RequestHandler[] }[] {
  return modules.map((m) => {
    const guards = [requireAuth, requireRole(...m.roles)];
    app.use(basePath(m), ...guards, m.router);
    return { prefix: basePath(m), router: m.router, guards };
  });
}

/** `GET /api/modules`: what the UI's navigation shows for the signed-in role. */
export function moduleListRoutes(modules: readonly ModuleDefinition[]): Router {
  const router = Router();
  router.get('/', requireAuth, anyRole, (req, res) => {
    const body: ModuleInfo[] = visibleModules(modules, authOf(req).user.role).map((m) => ({
      id: m.id,
      label: m.label,
      order: m.order,
      basePath: basePath(m),
    }));
    res.json(body);
  });
  return router;
}
