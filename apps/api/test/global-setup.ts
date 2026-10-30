import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/** Applies migrations to the test database before the run. Refuses any database not named *_test. */
export default function setup() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!url.pathname.endsWith('_test'))
    throw new Error(
      `Refusing to run tests against ${url.pathname}: the database name must end in _test`,
    );
  // The Prisma CLI run by this Node binary: `npx` is `npx.cmd` on Windows, which
  // execFileSync cannot start without a shell (ENOENT).
  // (createRequire, not import.meta.resolve: Vitest's module runner lacks the latter.)
  const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: fileURLToPath(new URL('../../..', import.meta.url)),
    env: { ...process.env, ENV_FILE: 'apps/api/.env.test' },
    stdio: 'pipe',
  });
}
