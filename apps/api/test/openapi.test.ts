import { readFileSync } from 'node:fs';
import SwaggerParser from '@apidevtools/swagger-parser';
import request from 'supertest';
import { beforeAll, expect, it } from 'vitest';
import { createApp, type MountedRouter } from '../src/app.js';
import { loadModules, type ModuleDefinition } from '../src/platform/modules/index.js';
import { buildOpenApiDocument } from '../src/platform/openapi.js';

interface RouteLayer {
  route?: { path: string; methods: Record<string, boolean> };
}

let modules: ModuleDefinition[];
beforeAll(async () => {
  modules = await loadModules();
});

/** Every `METHOD /path` mounted in the app, with Express `:param` written as OpenAPI `{param}`. */
function mountedRoutes(mounted: MountedRouter[]): string[] {
  const routes: string[] = [];
  for (const { prefix, router } of mounted)
    for (const layer of (router as unknown as { stack: RouteLayer[] }).stack) {
      if (!layer.route) continue;
      const path = `${prefix}${layer.route.path === '/' ? '' : layer.route.path}`.replace(
        /:(\w+)/g,
        '{$1}',
      );
      for (const method of Object.keys(layer.route.methods))
        if (method !== '_all') routes.push(`${method.toUpperCase()} ${path}`);
    }
  return routes;
}

it('is a valid OpenAPI 3.1 document', async () => {
  const doc = buildOpenApiDocument(modules);
  expect(doc.openapi).toBe('3.1.0');
  await expect(SwaggerParser.validate(structuredClone(doc) as never)).resolves.toBeDefined();
});

it('documents every mounted route, and nothing that is not mounted', () => {
  const app = createApp({ modules });
  const routes = mountedRoutes(app.locals.mounted as MountedRouter[]);
  expect(routes.length).toBeGreaterThan(15);

  const documented = Object.entries(buildOpenApiDocument(modules).paths ?? {}).flatMap(
    ([path, item]) =>
      Object.keys(item as object)
        .filter((k) => ['get', 'post', 'put', 'patch', 'delete'].includes(k))
        .map((method) => `${method.toUpperCase()} ${path}`),
  );
  expect([...routes].sort()).toEqual([...documented].sort());
});

it('matches the committed docs/api/openapi.json (run `npm run api:docs` after changing routes)', () => {
  const committed: unknown = JSON.parse(
    readFileSync(new URL('../../../docs/api/openapi.json', import.meta.url), 'utf8'),
  );
  expect(committed).toEqual(JSON.parse(JSON.stringify(buildOpenApiDocument(modules))));
});

it('serves the document and the reference page outside production', async () => {
  const app = createApp({ modules });
  const json = await request(app).get('/api/docs/openapi.json').expect(200);
  expect((json.body as { openapi: string }).openapi).toBe('3.1.0');
  await request(app)
    .get('/api/docs/')
    .expect(200)
    .expect('Content-Type', /text\/html/);
});
