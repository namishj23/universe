import { expect, test, type Page } from '@playwright/test';
import { CASES } from './matrix.ts';
import { openBuild, settle, type Theme } from './mocks.ts';
import { BUILD } from './playwright.config.ts';

/**
 * Visual regression of the build: every screen, role, theme and state of the design
 * comparison, plus the screens the design does not draw. Route mocks and a frozen clock, so
 * no API or database. Baselines live in visual.spec.ts-snapshots/ (macOS Chromium); a moved
 * pixel fails until someone reviews it and runs `npm run test:visual -- --update-snapshots`.
 */
const shot = (page: Page, name: string) =>
  expect(page).toHaveScreenshot(`${name}.png`, { animations: 'disabled', caret: 'hide' });

for (const c of CASES) {
  test(c.name, async ({ page }) => {
    await page.setViewportSize(c.viewport);
    await openBuild(page, BUILD, c);
    await shot(page, c.name);
  });
}

type Extra = {
  name: string;
  role: 'student' | 'admin' | null;
  path: string;
  mustChange?: boolean;
  act?: (page: Page) => Promise<void>;
};
const EXTRAS: Extra[] = [
  { name: 'forced-password-change', role: 'student', path: '/change-password', mustChange: true },
  {
    name: 'change-password-modal',
    role: 'student',
    path: '/',
    act: async (page) => {
      if ((page.viewportSize()?.width ?? 0) < 1024)
        await page.getByRole('button', { name: 'Menu' }).click();
      await page.getByRole('button', { name: /account ▾/ }).click();
      await page.getByRole('menuitem', { name: 'Change password' }).click();
      await page.getByRole('dialog').getByLabel('NEW PASSWORD').fill('short');
    },
  },
  { name: 'forbidden-403', role: 'student', path: '/admin' },
  { name: 'not-found-404', role: 'student', path: '/nowhere' },
  {
    name: 'new-user-modal',
    role: 'admin',
    path: '/admin',
    act: async (page) => {
      await page.getByRole('button', { name: 'New user' }).click();
      await page.getByRole('button', { name: 'Create user' }).click();
    },
  },
  {
    name: 'user-created-modal',
    role: 'admin',
    path: '/admin',
    act: async (page) => {
      await page.getByRole('button', { name: 'New user' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('NAME').fill('Meera Pillai');
      await dialog.getByLabel('EMAIL').fill('meera.pillai@spit.ac.in');
      await page.getByRole('button', { name: 'Create user' }).click();
      await page.getByText('User created').waitFor();
    },
  },
  {
    name: 'manage-user-modal',
    role: 'admin',
    path: '/admin',
    act: async (page) => {
      await page.getByRole('button', { name: 'Kabir Shah' }).click();
    },
  },
  {
    name: 'announcement-toast',
    role: 'admin',
    path: '/inbox',
    act: async (page) => {
      await page
        .getByRole('textbox', { name: 'ANNOUNCEMENT TO EVERYONE' })
        .fill('Library open until 23:00.');
      await page.getByRole('button', { name: 'Send to everyone' }).click();
      await page.getByRole('status').waitFor();
    },
  },
  {
    name: 'mobile-menu',
    role: 'admin',
    path: '/',
    act: async (page) => {
      if ((page.viewportSize()?.width ?? 0) < 1024)
        await page.getByRole('button', { name: 'Menu' }).click();
    },
  },
];
const THEMES: Theme[] = ['light', 'dark'];
for (const x of EXTRAS)
  for (const theme of THEMES)
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      const name = `${x.name}-${theme}-${viewport.width}`;
      test(name, async ({ page }) => {
        await page.setViewportSize(viewport);
        await openBuild(page, BUILD, {
          role: x.role,
          screen: 'dashboard',
          state: 'normal',
          theme,
          path: x.path,
          ...(x.mustChange && { mustChange: true }),
        });
        if (x.act) await x.act(page);
        await settle(page);
        await shot(page, name);
      });
    }
