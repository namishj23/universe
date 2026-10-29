import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express, type Router } from 'express';
import helmet from 'helmet';
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
import {
  basePath,
  moduleListRoutes,
  mountModules,
  type ModuleDefinition,
} from './platform/modules/index.js';
import { buildOpenApiDocument } from './platform/openapi.js';

// Same relative path from src/ (dev) and dist/ (built).
const webDist = fileURLToPath(new URL('../../web/dist/', import.meta.url));

export interface AppOptions {
  /** From `loadModules()` at startup; tests pass fixtures. */
  modules?: readonly ModuleDefinition[];
}

/** Every mounted router and its prefix; the OpenAPI test checks each route is documented. */
export interface MountedRouter {
  prefix: string;
  router: Router;
}

export function createApp({ modules = [] }: AppOptions = {}): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(requestId);
  app.use(pinoHttp({ logger, genReqId: (req) => req.id }));
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
  mountModules(app, modules);
  app.locals.mounted = [
    ...mounted,
    ...modules.map((m) => ({ prefix: basePath(m), router: m.router })),
  ] satisfies MountedRouter[];

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
