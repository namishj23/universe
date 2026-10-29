import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { openBuild, type Screen, type Theme } from './mocks.ts';
import { BUILD } from './playwright.config.ts';

/** axe in real Chromium, so colour contrast is measured too (jsdom can't compute it). */
const SCREENS: { screen: Screen; role: 'student' | 'admin' | null }[] = [
  { screen: 'login', role: null },
  { screen: 'dashboard', role: 'student' },
  { screen: 'inbox', role: 'admin' },
  { screen: 'admin-users', role: 'admin' },
  { screen: 'admin-audit', role: 'admin' },
];
for (const theme of ['light', 'dark'] as Theme[])
  for (const s of SCREENS)
    test(`axe ${s.screen} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await openBuild(page, BUILD, { ...s, state: 'normal', theme });
      // Three places where the design itself is under 4.5:1, kept exact and raised with the
      // design team (PROGRESS.md "Requests"): the --faint demo note and "Nothing yet", and
      // inactive user rows at 65% opacity. Everything else must pass.
      const { violations } = await new AxeBuilder({ page })
        .exclude('[class*="_demoNote_"]')
        .exclude('[class*="_nothing_"]')
        .exclude('[class*="_inactive_"]')
        .analyze();
      expect(
        violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
      ).toEqual([]);
    });
