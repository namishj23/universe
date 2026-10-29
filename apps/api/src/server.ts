import { env } from './config/env.js';
import { createApp } from './app.js';
import { closeAllStreams } from './platform/activity/broker.js';
import { startSessionCleanup } from './platform/auth/sessions.js';
import { prisma } from './platform/db.js';
import { logger } from './platform/logger.js';

const server = createApp().listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'API listening');
});
const stopCleanup = startSessionCleanup();

let shuttingDown = false;
function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
  setTimeout(() => process.exit(1), 10_000).unref();
  stopCleanup();
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
