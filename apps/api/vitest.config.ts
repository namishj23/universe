import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Tests always run against universe_test (copy .env.test.example to .env.test).
process.loadEnvFile(fileURLToPath(new URL('.env.test', import.meta.url)));

export default defineConfig({
  resolve: {
    alias: {
      '@universe/contracts': fileURLToPath(
        new URL('../../packages/contracts/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    globalSetup: ['test/global-setup.ts'],
    setupFiles: ['test/setup.ts'],
    // Files share one database and truncate it, so they run one at a time.
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
