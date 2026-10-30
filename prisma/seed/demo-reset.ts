// `npm run demo:reset -- --yes`: see reset.ts. Loads apps/api/.env (or ENV_FILE) first, so the
// guard sees the same DATABASE_URL and NODE_ENV the API would.
import { existsSync } from 'node:fs';
import { resetRefusal } from './reset.js';

const envFile = process.env.ENV_FILE ?? 'apps/api/.env';
if (existsSync(envFile)) process.loadEnvFile(envFile);

const refusal = resetRefusal(process.env.DATABASE_URL, process.env.NODE_ENV);
if (refusal) {
  console.error(refusal);
  process.exit(1);
}
const password = process.env.SEED_DEMO_PASSWORD ?? '';
if (password.length < 12) {
  console.error('SEED_DEMO_PASSWORD must be set to at least 12 characters (apps/api/.env).');
  process.exit(1);
}

// After the env is loaded: the database client reads it when imported.
const { prisma } = await import('../../apps/api/src/platform/db.js');
const { resetDemoData, resetPlan } = await import('./reset.js');
const { runSeed } = await import('./run.js');
try {
  const plan = await resetPlan(prisma);
  const db = new URL(process.env.DATABASE_URL ?? '').pathname.slice(1);
  console.log(`demo:reset on database "${db}" will delete:`);
  for (const t of plan.tables) if (t.rows > 0) console.log(`  ${t.name}: ${t.rows} rows`);
  console.log(`  activity_events: ${plan.activityEvents} rows`);
  console.log(`  and mark ${plan.files} module files deleted (the hourly sweep removes them).`);
  console.log('Kept: users, sessions, login throttle, audit_log. Then the seed runs again.');
  if (!process.argv.includes('--yes')) {
    console.error('Nothing deleted. Run again with --yes: npm run demo:reset -- --yes');
    process.exitCode = 1;
  } else {
    await resetDemoData(prisma);
    await runSeed(password, console.log);
    console.log('Demo data reset.');
  }
} finally {
  await prisma.$disconnect();
}
