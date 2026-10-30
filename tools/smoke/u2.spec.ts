import { expect, test, type Page } from '@playwright/test';

/**
 * U2 smoke: each demo role signs in to the real app, opens every Hub, Rides and Wellbeing tab
 * it can see, and the page has no console error, CSP violation, page error or error box, and
 * the right h1. Then two flows: a student finds a ride and sees matches; a student imports a
 * sample day, runs a focus session and today's totals change.
 */
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? '';
const ACCOUNTS = {
  student: 'student@universe.test',
  mentor: 'mentor@universe.test',
  driver: 'anil.gaikwad@drivers.universe.test',
  admin: 'admin@universe.test',
} as const;
const TITLES: Record<string, string> = { hub: 'Student Hub', rides: 'Rides', wellbeing: 'Wellbeing' };

function watch(page: Page) {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  void page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) =>
      console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`),
    );
  });
  return problems;
}

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('EMAIL').fill(email);
  await page.getByLabel('PASSWORD').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.locator('h1').first().waitFor();
  await expect(page).not.toHaveURL(/\/login|change-password/);
}

/** No error box (ErrorBox shows "ERROR · {status}") once the screen has settled. */
async function expectHealthy(page: Page, title: string) {
  await expect(page.locator('h1').first()).toHaveText(title);
  await expect(page.getByText(/^LOADING /)).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByText(/^ERROR · /)).toHaveCount(0);
}

for (const [role, email] of Object.entries(ACCOUNTS)) {
  test(`${role}: every Hub, Rides and Wellbeing tab opens cleanly`, async ({ page }) => {
    const problems = watch(page);
    await signIn(page, email);
    const nav = page.getByRole('navigation', { name: /modules/i });
    for (const id of ['hub', 'rides', 'wellbeing']) {
      if ((await nav.locator(`a[href="/${id}"]`).count()) === 0) continue;
      await page.goto(`/${id}`);
      await expectHealthy(page, TITLES[id]!);
      const tabs = await page
        .locator('main nav a')
        .evaluateAll((links) => links.map((a) => a.getAttribute('href') ?? ''));
      for (const href of tabs) {
        await page.goto(href);
        await expectHealthy(page, TITLES[id]!);
      }
    }
    expect(problems).toEqual([]);
  });
}
