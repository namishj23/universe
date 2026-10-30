import { readFileSync } from 'node:fs';
import { Router } from 'express';
import { beforeAll, expect, it } from 'vitest';
import { createApp, type MountedRouter } from '../src/app.js';
import { requireAuth } from '../src/platform/auth/guards.js';
import { loadModules, type ModuleDefinition } from '../src/platform/modules/index.js';
import { PUBLIC_ROUTES, rolesMarkdown, routeTable } from '../src/platform/routeTable.js';

let modules: ModuleDefinition[];
let mounted: MountedRouter[];
beforeAll(async () => {
  modules = await loadModules();
  mounted = createApp({ modules }).locals.mounted as MountedRouter[];
});

const isPublic = (r: { method: string; path: string }) =>
  PUBLIC_ROUTES.some((re) => re.test(`${r.method} ${r.path}`));

it('guards every mounted route with sign-in, except signing in and the health checks', () => {
  const routes = routeTable(mounted);
  expect(routes.length).toBeGreaterThan(100);
  expect(routes.filter((r) => !r.auth && !isPublic(r)).map((r) => `${r.method} ${r.path}`)).toEqual(
    [],
  );
  expect(routes.filter(isPublic).every((r) => !r.auth)).toBe(true);
});

it('gives every signed-in route role metadata', () => {
  const missing = routeTable(mounted).filter((r) => r.auth && !r.roles?.length);
  expect(missing.map((r) => `${r.method} ${r.path}`)).toEqual([]);
});

it('narrows module routes to the module roles (outer guard ∩ route guard)', () => {
  const routes = routeTable(mounted);
  const find = (m: string, p: string) => routes.find((r) => r.method === m && r.path === p);
  expect(find('GET', '/api/wellbeing/summary')?.roles).toEqual(['student', 'mentor']);
  expect(find('GET', '/api/rides/admin/stats')?.roles).toEqual(['admin']);
  expect(find('POST', '/api/activity/announcements')?.roles).toEqual(['admin']);
  expect(find('GET', '/api/hub/mentors')?.roles).toEqual(['student']);
});

it('fails for a route without a guard or without role metadata', () => {
  const router = Router();
  router.get('/open', (_req, res) => void res.end());
  router.get('/signed-in', requireAuth, (_req, res) => void res.end());
  const [open, signedIn] = routeTable([{ prefix: '/api/x', router }]);
  expect(open).toMatchObject({ auth: false, roles: null });
  expect(signedIn).toMatchObject({ auth: true, roles: null });
});

it('matches the committed docs/ROLES.md (run `npm run docs:roles` after changing routes)', () => {
  const committed = readFileSync(new URL('../../../docs/ROLES.md', import.meta.url), 'utf8');
  expect(committed).toBe(`${rolesMarkdown(mounted, modules)}\n`);
});
