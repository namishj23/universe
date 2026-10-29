import { env } from './config/env.js';
import { createApp } from './app.js';
import { closeAllStreams } from './platform/activity/broker.js';
import { startSessionCleanup } from './platform/auth/sessions.js';
import { prisma } from './platform/db.js';
import { startFileSweep } from './platform/files/index.js';
import { logger } from './platform/logger.js';
import { loadModules, type ModuleDefinition } from './platform/modules/index.js';
import { platform } from './platform/modules/platform.js';

function start(modules: ModuleDefinition[]) {
  const server = createApp({ modules }).listen(env.PORT, () => {
    logger.info({ port: env.PORT, modules: modules.map((m) => m.id) }, 'API listening');
  });
  const stopTimers = [startSessionCleanup(), startFileSweep()];

  let shuttingDown = false;
  function shutdown(signal: NodeJS.Signals) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    setTimeout(() => process.exit(1), 10_000).unref();
    for (const stop of stopTimers) stop();
    closeAllStreams();
    server.close(() => {
      prisma.$disconnect().then(
        () => process.exit(0),
        () => process.exit(1),
      );
    });
  }
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// No top-level await (it would break require(esm) for CommonJS modules such as rides).
// One platform instance, built here and handed to every module's factory.
loadModules({ platform: platform() }).then(start, (err: unknown) => {
  logger.fatal({ err }, 'could not load modules');
  process.exit(1);
});
