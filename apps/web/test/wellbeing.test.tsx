import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { wellbeing as W } from '@universe/contracts';
import { addDays, localDate } from '@universe/wellbeing-core';
import { F, mockApi, renderApp, signedIn, type Routes } from './helpers';

const today = localDate(Date.now());
const settings = W.Settings.parse({
  tracking: 'on',
  pausedSince: null,
  categories: ['study', 'communication', 'social', 'entertainment'],
  retentionDays: 90,
  shareStudyWithHub: false,
  updatedAt: new Date().toISOString(),
});
const summary = W.Summary.parse({
  today,
  todayMinutes: 212,
  categories: [
    { category: 'study', minutes: 95, counted: true },
    { category: 'communication', minutes: 52, counted: true },
    { category: 'social', minutes: 38, counted: true },
    { category: 'entertainment', minutes: 27, counted: true },
    { category: 'other', minutes: 10, counted: false },
  ],
  series: [{ date: today, minutes: 212 }],
  recordCount: 4,
  tracking: 'on',
  pausedSince: null,
});
const routes = (extra: Routes = {}): Routes => ({
  'GET /api/wellbeing/summary': { body: summary },
  'GET /api/wellbeing/settings': { body: settings },
  'GET /api/wellbeing/records': { body: { items: [], nextCursor: null, total: 0 } },
  'PUT /api/wellbeing/settings': { body: settings },
  'POST /api/wellbeing/tracking': { body: { ...settings, tracking: 'paused' } },
  'PUT /api/wellbeing/totals': { body: { stored: 4 } },
  'DELETE /api/wellbeing/data': { body: { deleted: 4 } },
  ...extra,
});

// Anything that would identify a site, a page or an event (the samples hold all of these).
const RAW =
  /https?:|:\/\/|geeksforgeeks|docs\.google|whatsapp|instagram|youtube|\bdomain\b|\bevents?\b|\burl\b|\bkind\b|"at"/i;

describe('wellbeing privacy', () => {
  it('sends only daily totals and settings: no domain, URL or event, in bodies or URLs', async () => {
    const calls = mockApi(signedIn('student', routes()));
    await renderApp('/wellbeing');
    await screen.findByText('3h 32m');
    // jsdom has no IndexedDB: the screen says so and keeps working in memory.
    expect(screen.getByText(/blocked local storage/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Import sample events' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'PUT' && c.path === '/api/wellbeing/totals')).toBe(
        true,
      ),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await userEvent.click(screen.getByRole('switch', { name: 'Social' }));
    await userEvent.click(screen.getByRole('button', { name: 'Pause tracking' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete everything' }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete everything' }),
    );
    await screen.findByText('All wellbeing data deleted from the server.');

    const sent = calls.filter((c) => c.path.startsWith('/api/wellbeing'));
    for (const c of sent) expect(c.path).not.toMatch(RAW);
    const bodies = sent.filter((c) => c.method !== 'GET').map((c) => c.body);
    expect(bodies.length).toBeGreaterThanOrEqual(4);
    for (const body of bodies) {
      expect(JSON.stringify(body)).not.toMatch(RAW);
      const keys = Object.keys(body as object);
      if (keys.includes('rows'))
        for (const row of (body as { rows: object[] }).rows)
          expect(Object.keys(row).sort()).toEqual(['category', 'date', 'minutes']);
      else
        expect(
          keys.every((k) =>
            ['categories', 'retentionDays', 'shareStudyWithHub', 'state', 'confirm'].includes(k),
          ),
        ).toBe(true);
    }
    const totals = bodies.find((b) => Object.keys(b as object).includes('rows')) as {
      rows: { date: string }[];
    };
    // The sample is moved to end now: its 90 minutes land today (or also yesterday after midnight).
    expect(totals.rows.every((r) => r.date === today || r.date === addDays(today, -1))).toBe(true);
    expect(totals.rows.some((r) => r.date === today)).toBe(true);
  });

  it('clears every wellbeing query on sign-out', async () => {
    const clear = vi.spyOn(QueryClient.prototype, 'clear');
    mockApi(signedIn('student', routes()));
    await renderApp('/wellbeing');
    await screen.findByText('3h 32m');
    await userEvent.click(screen.getByRole('button', { name: /account ▾/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Sign out' }));
    await screen.findByRole('heading', { name: 'Sign in' });
    const client = clear.mock.contexts.at(-1) as QueryClient | undefined;
    expect(client).toBeInstanceOf(QueryClient);
    expect(client?.getQueryCache().findAll({ queryKey: ['wellbeing'] })).toHaveLength(0);
    clear.mockRestore();
  });

  it.each(['admin', 'invigilator', 'driver'] as const)(
    'is unreachable for %s (403 page), and asks the server nothing',
    async (role) => {
      const driver = {
        'GET /api/auth/me': {
          body: {
            user: { id: F.USERS.admin.id, email: 'driver@universe.test', name: 'Ramesh', role },
            csrfToken: 'csrf-fixture',
            mustChangePassword: false,
          },
        },
        'GET /api/modules': {
          body: [{ id: 'rides', label: 'Rides', order: 20, basePath: '/api/rides' }],
        },
      };
      const calls = mockApi(
        signedIn(role === 'driver' ? 'admin' : role, role === 'driver' ? routes(driver) : routes()),
      );
      await renderApp('/wellbeing');
      expect(
        await screen.findByRole('heading', { name: 'Not available to you' }),
      ).toBeInTheDocument();
      expect(calls.some((c) => c.path.startsWith('/api/wellbeing'))).toBe(false);
    },
  );
});
