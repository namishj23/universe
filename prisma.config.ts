import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// The API's env file holds DATABASE_URL. ENV_FILE=apps/api/.env.test targets the test database.
const envFile = process.env.ENV_FILE ?? 'apps/api/.env';
if (existsSync(envFile)) process.loadEnvFile(envFile);

// Migrations that use PostGIS need a shadow database with the same `extensions` schema
// (README setup creates `universe_shadow`). Defaults to that name on the same server.
const shadowUrl = (url: string | undefined) => {
  if (process.env.SHADOW_DATABASE_URL) return process.env.SHADOW_DATABASE_URL;
  if (!url) return undefined;
  const shadow = new URL(url);
  shadow.pathname = '/universe_shadow';
  return shadow.toString();
};

export default defineConfig({
  schema: 'prisma/schema',
  migrations: {
    path: 'prisma/schema/migrations',
    seed: 'tsx --conditions=@universe/source prisma/seed/index.ts',
  },
  // `prisma generate` (run on install) needs no database, so a missing URL only fails commands that connect.
  datasource: {
    url: process.env.DATABASE_URL ?? '',
    shadowDatabaseUrl: shadowUrl(process.env.DATABASE_URL),
  },
});
