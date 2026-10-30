import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import type { DemoRole } from './fixtures/index.ts';
import { freezeClock, settle, type Screen, type State, type Theme } from './mocks.ts';

const ROOT = new URL('../../', import.meta.url);
export const PROTOTYPE_PATH =
  '/docs/design/universe-ui-mockup-design/project/design_handoff_universe_web/UniVerse%20App.dc.html';
const NAMES: Record<DemoRole, string> = {
  student: 'Aarav Mehta',
  mentor: 'Prof. Neha Iyer',
  invigilator: 'Rohan Desai',
  admin: 'Admin Office',
};

/**
 * The prototype loads Familjen Grotesk and Reddit Mono from Google Fonts. We answer that
 * request with the same @fontsource files the build bundles, so both draw identical glyphs.
 */
function localFontsCss(base: string) {
  const files = [
    ['familjen-grotesk', ['400', '500', '600', '700']],
    ['reddit-mono', ['400', '500', '600']],
  ] as const;
  return files
    .flatMap(([family, weights]) =>
      weights.map((w) =>
        readFileSync(
          new URL(`node_modules/@fontsource/${family}/${w}.css`, ROOT),
          'utf8',
        ).replaceAll('url(./files/', `url(${base}/node_modules/@fontsource/${family}/files/`),
      ),
    )
    .join('\n');
}

/**
 * Opens the prototype with its own props (theme, dataState, startOnLogin, set by rewriting the
 * defaults in its data-props block) and drives it with its own controls to a screen and role.
 */
export async function openPrototype(
  page: Page,
  base: string,
  opts: { role: DemoRole | null; screen: Screen; state: State; theme: Theme },
  navigate?: (page: Page) => Promise<void>,
) {
  await freezeClock(page);
  const css = localFontsCss(base);
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ contentType: 'text/css', body: css }),
  );
  await page.route('https://fonts.gstatic.com/**', (route) => route.abort());
  await page.route(`${base}${PROTOTYPE_PATH}`, async (route) => {
    const res = await route.fetch();
    const html = (await res.text())
      .replace(
        '&quot;default&quot;:&quot;light&quot;',
        `&quot;default&quot;:&quot;${opts.theme}&quot;`,
      )
      .replace(
        '&quot;default&quot;:&quot;normal&quot;',
        `&quot;default&quot;:&quot;${opts.screen === 'login' ? 'normal' : opts.state}&quot;`,
      )
      .replace(
        '&quot;startOnLogin&quot;:{&quot;editor&quot;:&quot;boolean&quot;,&quot;default&quot;:false',
        `&quot;startOnLogin&quot;:{&quot;editor&quot;:&quot;boolean&quot;,&quot;default&quot;:${opts.screen === 'login'}`,
      );
    await route.fulfill({ response: res, body: html, contentType: 'text/html' });
  });
  await page.goto(base + PROTOTYPE_PATH);

  if (opts.screen === 'login') {
    await page.getByRole('heading', { name: 'Sign in' }).waitFor({ timeout: 30_000 });
    if (opts.state === 'error') {
      await page.locator('input[type=password]').fill('wrong');
      await page.getByRole('button', { name: 'Sign in' }).click();
      await page.getByRole('alert').waitFor();
    }
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  } else {
    await page.getByText('campus platform').waitFor({ timeout: 30_000 });
    const role = opts.role ?? 'student';
    if (role !== 'student') {
      await page.getByRole('button', { name: /viewing as/ }).click();
      await page.getByRole('button', { name: new RegExp(`^${NAMES[role]}`) }).click();
    }
    if (navigate) {
      await navigate(page);
      await settle(page);
      return;
    }
    const nav = {
      dashboard: 'Dashboard',
      inbox: 'Inbox',
      'admin-users': 'Admin',
      'admin-audit': 'Admin',
    }[opts.screen];
    await page
      .locator('aside button', { hasText: new RegExp(`^(§)?${nav}`) })
      .first()
      .click();
    if (opts.screen === 'admin-audit')
      await page.getByRole('button', { name: 'Audit log' }).click();
  }
  await settle(page);
}
