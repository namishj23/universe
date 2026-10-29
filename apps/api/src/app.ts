import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { activityRoutes } from './platform/activity/routes.js';
import { csrfProtection } from './platform/auth/guards.js';
import { authRoutes } from './platform/auth/routes.js';
import { loadSession } from './platform/auth/sessions.js';
import { healthRoutes } from './platform/health.js';
import { errorHandler, notFound, requestId } from './platform/http.js';
import { logger } from './platform/logger.js';

// Same relative path from src/ (dev) and dist/ (built).
const webDist = fileURLToPath(new URL('../../web/dist/', import.meta.url));

export function createApp(): Express {
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
  if (existsSync(webDist)) {
    app.use(express.static(webDist, { index: false }));
    app.get(/^(?!\/api(\/|$))/, (_req, res) => res.sendFile(`${webDist}index.html`));
  }

  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(loadSession);
  app.use(csrfProtection);

  app.use('/api/health', healthRoutes);
  app.use('/api/auth', authRoutes());
  app.use('/api/activity', activityRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
