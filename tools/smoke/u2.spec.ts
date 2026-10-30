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
const TITLES: Record<string, string> = {
  hub: 'Student Hub',
  rides: 'Rides',
  wellbeing: 'Wellbeing',
};

/**
 * API answers that are a normal state, not a failure: a student or mentor without a carpool
 * driver record gets 404 from `GET /api/rides/carpool/driver` (the Offer tab then explains how
 * to become one). The browser logs every 4xx response as a console error.
 */
const EXPECTED = [/\/api\/rides\/carpool\/driver$/];
const expected = (url: string) => EXPECTED.some((r) => r.test(url));

function watch(page: Page) {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !expected(m.location().url)) problems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  // Name the failing URL (the console line for a failed resource doesn't).
  page.on('response', (r) => {
    if (r.status() >= 400 && !expected(r.url()))
      problems.push(`http ${r.status()} ${r.request().method()} ${r.url()}`);
  });
  void page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) =>
      console.error(
        `CSP violation: ${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}:${e.columnNumber}`,
      ),
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
    await signIn(page, email);
    // Watched after sign-in: the signed-out /api/auth/me 401 is expected.
    const problems = watch(page);
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

test('student: import a sample day, run a focus session, today changes', async ({ page }) => {
  await signIn(page, ACCOUNTS.student);
  // Watched after sign-in: the signed-out /api/auth/me 401 is expected.
  const problems = watch(page);
  // Start from no stored rows today, so the import must change the total (re-runnable).
  const { csrfToken } = (await (await page.request.get('/api/auth/me')).json()) as {
    csrfToken: string;
  };
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const cleared = await page.request.delete(`/api/wellbeing/records?from=${today}&to=${today}`, {
    headers: { 'X-CSRF-Token': csrfToken },
  });
  expect(cleared.ok()).toBe(true);
  await page.goto('/wellbeing');
  await expectHealthy(page, 'Wellbeing');
  const resume = page.getByRole('button', { name: 'Resume tracking' });
  if (await resume.isVisible()) {
    await resume.click();
    await page.getByRole('button', { name: 'Pause tracking' }).waitFor();
  }
  const card = page.getByRole('heading', { name: 'TODAY · DAILY TOTALS' }).locator('xpath=..');
  const total = card.locator('span').first();
  const before = await total.innerText();

  await page.getByRole('button', { name: 'Import sample events' }).click();
  // The import toast is replaced at once by the upload's.
  await expect(page.getByText(/Imported \d+ events|Daily totals updated/)).toBeVisible();
  const focus = page.getByRole('region', { name: 'Focus session' });
  await focus.getByRole('button', { name: 'Start' }).click();
  await focus.getByRole('button', { name: 'Stop' }).click();
  await expect(focus.getByText('ACTIVE')).toBeVisible();
  await expect(total).not.toHaveText(before);
  expect(problems).toEqual([]);
});

/** Tomorrow in IST as YYYY-MM-DD. */
const tomorrow = () =>
  new Date(Date.now() + 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

test('student: find a ride, then Matches shows cards', async ({ page, browser }) => {
  // The mentor (an approved carpool driver) offers Borivali → SPIT tomorrow 08:10.
  const mentor = await browser.newContext({ baseURL: 'http://localhost:4100' });
  const login = await mentor.request.post('/api/auth/login', {
    data: { email: ACCOUNTS.mentor, password: PASSWORD },
  });
  const { csrfToken } = (await login.json()) as { csrfToken: string };
  const graph = (await (await mentor.request.get('/api/rides/graph')).json()) as {
    nodes: { id: string; name: string }[];
  };
  const stop = (name: string) => graph.nodes.find((n) => n.name === name)!.id;
  const offer = await mentor.request.post('/api/rides/offers', {
    headers: { 'X-CSRF-Token': csrfToken },
    data: {
      originNodeId: stop('Borivali Station'),
      destNodeId: stop('SPIT Main Gate'),
      departAt: `${tomorrow()}T08:10:00+05:30`,
      seats: 3,
    },
  });
  // 409: the mentor already has this offer from an earlier run.
  expect([201, 409]).toContain(offer.status());
  await mentor.close();

  await signIn(page, ACCOUNTS.student);
  // Watched after sign-in: the signed-out /api/auth/me 401 is expected.
  const problems = watch(page);
  await page.goto('/rides');
  await expectHealthy(page, 'Rides');
  // With no rides yet, the empty state's action opens the form.
  const start = page.getByRole('button', { name: 'Find a ride' });
  if (await start.isVisible()) await start.click();
  await page.getByLabel('FROM').selectOption({ label: 'Borivali Station' });
  await page.getByLabel('TO').selectOption({ label: 'SPIT Main Gate' });
  await page.getByLabel('DATE').fill(tomorrow());
  await page.getByLabel('PICKUP AROUND').fill('08:10');
  await page.getByRole('button', { name: 'Find matches' }).click();
  await expect(page).toHaveURL(/\/rides\/matches\?requestId=/);
  await expect(page.getByText('MATCH SCORE').first()).toBeVisible({ timeout: 15_000 });
  await expectHealthy(page, 'Rides');
  expect(problems).toEqual([]);
});
