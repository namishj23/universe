import { defineConfig, devices } from '@playwright/test';

/**
 * U2 smoke check against the real built app (`npm run build`, then `npm start` on port 4100
 * against `universe_u1`, seeded). Not part of `npm test`: run it by hand with
 *   npx playwright test -c tools/smoke/playwright.config.ts
 * The demo password comes from apps/api/.env (SEED_DEMO_PASSWORD), never from this file.
 */
process.loadEnvFile(new URL('../../apps/api/.env', import.meta.url).pathname);

export default defineConfig({
  testDir: '.',
  testMatch: 'u2.spec.ts',
  workers: 1,
  timeout: 90_000,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:4100',
    viewport: { width: 1440, height: 900 },
    timezoneId: 'Asia/Kolkata',
    locale: 'en-GB',
  },
});
