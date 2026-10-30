import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express, type Request, type RequestHandler, type Router } from 'express';
import helmet from 'helmet';
import type { SerializedRequest, SerializedResponse } from 'pino';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env.js';
import { activityRoutes } from './platform/activity/routes.js';
import { adminUserRoutes } from './platform/admin/users.js';
import { auditRoutes } from './platform/audit/index.js';
import { csrfProtection, passwordChangeGate } from './platform/auth/guards.js';
import { authRoutes } from './platform/auth/routes.js';
import { loadSession } from './platform/auth/sessions.js';
import { dashboardRoutes } from './platform/dashboard.js';
import { fileRoutes } from './platform/files/index.js';
import { healthRoutes } from './platform/health.js';
import { errorHandler, notFound, requestId } from './platform/http.js';
import { logger } from './platform/logger.js';
import { moduleListRoutes, mountModules, type ModuleDefinition } from './platform/modules/index.js';
import { buildOpenApiDocument } from './platform/openapi.js';

// Same relative path from src/ (dev) and dist/ (built).
const webDist = fileURLToPath(new URL('../../web/dist/', import.meta.url));

// Wellbeing requests are logged as method + route pattern only: dates and categories in the
// path, the query string, params and headers never reach a log (Express matches paths
// case-insensitively, so the test is too). pino-http serialises `req` when the request
// arrives, before routing, so the matched pattern is added when the response finishes.
const WELLBEING = /^\/api\/wellbeing(?:[/?#]|$)/i;
const isWellbeing = (req: Request) => WELLBEING.test(req.originalUrl);
const routeOf = (req: Request) => {
  const route = req.route as { path?: unknown } | undefined;
  return `/api/wellbeing${typeof route?.path === 'string' ? route.path : '/*'}`;
};
const withRoute = (req: Request, val: object) =>
  isWellbeing(req) ? { ...val, route: routeOf(req) } : val;
const requestLogOptions = {
  serializers: {
    req: (req: SerializedRequest) =>
      isWellbeing(req.raw as Request) ? { id: req.id, method: req.method } : req,
    // Node keeps the request on the response; in Express it is the same object as `req`.
    res: (res: SerializedResponse) =>
      isWellbeing(res.raw.req as Request) ? { statusCode: res.statusCode } : res,
  },
  customSuccessObject: (req: Request, _res: unknown, val: object) => withRoute(req, val),
  customErrorObject: (req: Request, _res: unknown, _err: unknown, val: object) =>
    withRoute(req, val),
};

export interface AppOptions {
  /** From `loadModules()` at startup; tests pass fixtures. */
  modules?: readonly ModuleDefinition[];
}

/**
 * Every mounted router and its prefix (plus the guards mounted in front of it); the OpenAPI
 * test checks each route is documented, the route table reads the guards.
 */
export interface MountedRouter {
  prefix: string;
  router: Router;
  guards?: RequestHandler[];
}

export function createApp({ modules = [] }: AppOptions = {}): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(requestId);
  app.use(pinoHttp({ logger, genReqId: (req) => req.id, ...requestLogOptions }));
  app.use(
    helmet({
      // Upgrading to https would break the plain-http localhost demo; only on when served over HTTPS.
      contentSecurityPolicy: {
        directives: { upgradeInsecureRequests: env.COOKIE_SECURE ? [] : null },
      },
    }),
  );
  app.use(cors({ origin: env.WEB_ORIGINS, credentials: true }));

  // The built web app (npm start): static files and SPA fallback for every non-/api path.
  // Uploaded files live in STORAGE_DIR, outside the repo, so this never serves them.
  if (existsSync(webDist)) {
    app.use(express.static(webDist, { index: false }));
    app.get(/^(?!\/api(\/|$))/, (_req, res) => res.sendFile(`${webDist}index.html`));
  }

  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(loadSession);
  app.use(csrfProtection);
  app.use(passwordChangeGate);

  const mounted: MountedRouter[] = [
    { prefix: '/api/health', router: healthRoutes },
    { prefix: '/api/auth', router: authRoutes() },
    { prefix: '/api/activity', router: activityRoutes },
    { prefix: '/api/modules', router: moduleListRoutes(modules) },
    { prefix: '/api/dashboard', router: dashboardRoutes(modules) },
    { prefix: '/api/admin/users', router: adminUserRoutes },
    { prefix: '/api/admin/audit', router: auditRoutes },
    { prefix: '/api/files', router: fileRoutes(modules) },
  ];
  for (const { prefix, router } of mounted) app.use(prefix, router);
  app.locals.mounted = [...mounted, ...mountModules(app, modules)] satisfies MountedRouter[];

  // The contract for the UI phases; not served in production.
  if (env.NODE_ENV !== 'production') {
    const document = buildOpenApiDocument(modules);
    app.get('/api/docs/openapi.json', (_req, res) => res.json(document));
    app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(document));
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
