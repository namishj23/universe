import { defineConfig, devices } from '@playwright/test';

/**
 * Two suites, both against the route-mocked build (no API, no database):
 * - `compare` renders the Claude Design prototype and the build side by side and measures the
 *   pixel difference (npm run design:compare);
 * - `visual` checks the build against committed baselines (npm run test:visual).
 */
export const BUILD = 'http://localhost:5274';
export const PROTOTYPE = 'http://127.0.0.1:5275';

export default defineConfig({
  testDir: '.',
  fullyParallel: true,
  workers: 4,
  timeout: 60_000,
  reporter: [['list']],
  expect: { toHaveScreenshot: { maxDiffPixels: 0, animations: 'disabled', caret: 'hide' } },
  use: {
    ...devices['Desktop Chrome'],
    timezoneId: 'Asia/Kolkata',
    locale: 'en-GB',
    deviceScaleFactor: 1,
  },
  projects: [
    { name: 'compare', testMatch: 'compare.spec.ts' },
    { name: 'visual', testMatch: ['visual.spec.ts', 'a11y.spec.ts'] },
  ],
  webServer: [
    {
      command: 'npx vite --mode visual --port 5274 --strictPort',
      cwd: '../../apps/web',
      url: BUILD,
      reuseExistingServer: true,
    },
    {
      command: 'node serve.mjs',
      url: `${PROTOTYPE}/docs/design/universe-ui-mockup-design/README.md`,
      reuseExistingServer: true,
    },
  ],
});
