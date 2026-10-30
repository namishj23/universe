import type { Page, Route } from '@playwright/test';
import * as F from './fixtures/index.ts';
import { respondU2 } from './u2/index.ts';

export type Screen = 'login' | 'dashboard' | 'inbox' | 'admin-users' | 'admin-audit';
export type State = 'normal' | 'loading' | 'empty' | 'error';
export type Theme = 'light' | 'dark';

/** Which API paths carry each screen's data; the state (loading, empty, error) applies to them. */
const SCREEN_PATHS: Record<Screen, RegExp[]> = {
  login: [],
  dashboard: [/^\/api\/dashboard(\/week)?$/],
  inbox: [/^\/api\/activity$/],
  'admin-users': [/^\/api\/admin\/users$/],
  'admin-audit': [/^\/api\/admin\/audit$/],
};

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const jsonBody = (route: Route): unknown => {
  try {
    return route.request().postDataJSON() as unknown;
  } catch {
    return null; // multipart or empty
  }
};
const apiError = (route: Route, status: number, code: string, message: string) =>
  json(route, { error: { code, message, requestId: F.ERROR_REQUEST_ID } }, status);

/**
 * Route mocks for every `/api/*` call the build makes, from the fixtures. The build needs no
 * API and no database. `role: null` is signed out (the login screen).
 */
export async function installMocks(
  page: Page,
  {
    role,
    screen,
    state,
    mustChange = false,
  }: { role: F.DemoRole | null; screen: Screen; state: State; mustChange?: boolean },
) {
  const unhandled: string[] = [];
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    const scoped = SCREEN_PATHS[screen].some((r) => r.test(path));
    const empty = scoped && state === 'empty';
    // The dashboard's empty state also has an empty feed: it is "nothing at all".
    const emptyFeed =
      empty || (screen === 'dashboard' && state === 'empty' && path === '/api/activity');

    if (path === '/api/auth/me')
      return role
        ? json(route, F.session(role, mustChange))
        : apiError(route, 401, 'UNAUTHENTICATED', 'Sign in first');
    if (path === '/api/auth/login' && method === 'POST')
      return apiError(route, 401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
    if (!role) return apiError(route, 401, 'UNAUTHENTICATED', 'Sign in first');

    if (path === '/api/activity/stream')
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: `retry: 600000\nevent: unread-count\ndata: ${JSON.stringify({ count: state === 'empty' ? 0 : F.unread(role) })}\n\n`,
      });
    if (path === '/api/modules') return json(route, F.modules(role));
    const u2 = respondU2(role, method, url, jsonBody(route));
    if (u2) return json(route, u2.body, u2.status ?? 200);
    if (path === '/api/admin/users' && method === 'POST') return json(route, F.created, 201);
    if (path === '/api/activity/announcements' && method === 'POST')
      return json(route, { recipients: 7 });
    if (method !== 'GET') return route.fulfill({ status: 204 });

    if (scoped && state === 'loading') return; // never answered: the screen stays loading
    if (scoped && state === 'error')
      return apiError(route, 503, 'SERVICE_UNAVAILABLE', 'Service unavailable');

    if (path === '/api/dashboard') return json(route, F.dashboard(role, empty));
    if (path === '/api/dashboard/week') return json(route, F.week(role, empty));
    if (path === '/api/activity') return json(route, F.feed(role, emptyFeed));
    if (path === '/api/admin/users') return json(route, F.users(empty));
    if (path === '/api/admin/audit') return json(route, F.audit(empty));

    unhandled.push(`${method} ${path}`);
    return apiError(route, 404, 'NOT_FOUND', 'No mock for this route');
  });
  return unhandled;
}

export const ROUTES: Record<Screen, string> = {
  login: '/login',
  dashboard: '/',
  inbox: '/inbox',
  'admin-users': '/admin',
  'admin-audit': '/admin/audit',
};

/** Frozen at the prototype's moment, in its time zone (the context sets Asia/Kolkata). */
export async function freezeClock(page: Page) {
  await page.clock.setFixedTime(F.NOW);
}

/** Opens the build at a screen with its mocks, theme and frozen clock. */
export async function openBuild(
  page: Page,
  base: string,
  opts: {
    role: F.DemoRole | null;
    screen: Screen;
    state: State;
    theme: Theme;
    path?: string;
    mustChange?: boolean;
  },
) {
  await freezeClock(page);
  await page.addInitScript((theme) => {
    try {
      localStorage.setItem('uv-theme', theme);
    } catch {
      // ignore
    }
  }, opts.theme);
  const unhandled = await installMocks(page, opts);
  await page.goto(base + (opts.path ?? ROUTES[opts.screen]));
  if (opts.path) {
    await page.locator('h1').first().waitFor();
  } else if (opts.screen === 'login') {
    await page.getByLabel('EMAIL').fill('student@universe.test');
    if (opts.state === 'error') {
      await page.getByLabel('PASSWORD').fill('wrong');
      await page.getByRole('button', { name: 'Sign in' }).click();
      await page.getByRole('alert').waitFor();
    }
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  } else {
    await waitForState(page, opts.state);
  }
  await settle(page);
  return unhandled;
}

export async function waitForState(page: Page, state: State) {
  const timeout = 15_000;
  if (state === 'loading') await page.getByText(/^LOADING /).waitFor({ timeout });
  else if (state === 'error')
    await page
      .getByText(/^ERROR · /)
      .first()
      .waitFor({ timeout });
  else if (state === 'empty') await page.getByText('EMPTY', { exact: true }).waitFor({ timeout });
  else await page.locator('h1').first().waitFor({ timeout });
}

/** Fonts loaded, no hover, nothing focused, no caret. */
export async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const size = page.viewportSize() ?? { width: 1440, height: 900 };
  await page.mouse.move(size.width - 1, size.height - 1);
  await page.waitForTimeout(250);
}
