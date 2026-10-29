import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// The API's env file holds DATABASE_URL. ENV_FILE=apps/api/.env.test targets the test database.
const envFile = process.env.ENV_FILE ?? 'apps/api/.env';
if (existsSync(envFile)) process.loadEnvFile(envFile);

export default defineConfig({
  schema: 'prisma/schema',
  migrations: {
    path: 'prisma/schema/migrations',
    seed: 'tsx --conditions=@universe/source prisma/seed/index.ts',
  },
  // `prisma generate` (run on install) needs no database, so a missing URL only fails commands that connect.
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
