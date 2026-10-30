import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ModuleInfo, PublicUser, Role } from '@universe/contracts';
import { F, FakeEventSource, apiError, mockApi, renderApp, signedIn } from './helpers';
import { media } from './setup';

const info = (id: ModuleInfo['id'], label: string, order: number): ModuleInfo => ({
  id,
  label,
  order,
  basePath: `/api/${id}`,
});
const HUB = info('hub', 'Student Hub', 10);
const RIDES = info('rides', 'Rides', 20);
const WELLBEING = info('wellbeing', 'Wellbeing', 30);
// What GET /api/modules returns for each role with today's modules installed.
const BY_ROLE: Record<Role, ModuleInfo[]> = {
  student: [HUB, RIDES, WELLBEING],
  mentor: [HUB, RIDES, WELLBEING],
  driver: [RIDES],
  invigilator: [],
  admin: [HUB, RIDES],
};
const user = (role: Role): PublicUser => ({
  id: '00000000-0000-4000-8000-0000000000aa',
  email: `${role}@universe.test`,
  name: `Demo ${role}`,
  role,
});

describe('sidebar', () => {
  it.each(Object.keys(BY_ROLE) as Role[])('is built from /api/modules for %s', async (role) => {
    mockApi({
      ...signedIn('student'),
      'GET /api/auth/me': {
        body: { user: user(role), csrfToken: 't', mustChangePassword: false },
      },
      'GET /api/modules': { body: BY_ROLE[role] },
    });
    await renderApp('/');
    const nav = await screen.findByRole('navigation', { name: 'Modules' });
    const expected = [...BY_ROLE[role].map((m) => m.label), ...(role === 'admin' ? ['Admin'] : [])];
    await waitFor(() =>
      expect(
        within(nav)
          .queryAllByRole('link')
          .map((a) => a.textContent?.replace(/^[A-E§]/, '')),
      ).toEqual(expected),
    );
    if (role === 'driver') expect(within(nav).getAllByRole('link')).toHaveLength(1);
  });

  it('marks the active page with aria-current and moves focus to its h1', async () => {
    mockApi(signedIn('student'));
    await renderApp('/');
    await screen.findByRole('heading', { name: 'Your week' });
    await userEvent.click(screen.getByRole('link', { name: /^Inbox/ }));
    const h1 = await screen.findByRole('heading', { name: 'Inbox', level: 1 });
    expect(screen.getByRole('link', { name: /^Inbox/ })).toHaveAttribute('aria-current', 'page');
    await waitFor(() => expect(h1).toHaveFocus());
    expect(document.title).toBe('Inbox · UniVerse');
  });
});

describe('live activity', () => {
  it('keeps exactly one EventSource while navigating, and closes it on sign-out', async () => {
    mockApi(signedIn('student'));
    await renderApp('/');
    await screen.findByRole('heading', { name: 'Your week' });
    for (const name of [/^Inbox/, /^Dashboard/, /^Inbox/])
      await userEvent.click(screen.getByRole('link', { name }));
    await screen.findByRole('heading', { name: 'Inbox' });
    expect(FakeEventSource.live).toHaveLength(1);
    expect(FakeEventSource.instances).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: /account ▾/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Sign out' }));
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(FakeEventSource.live).toHaveLength(0);
  });

  it('signs out once when the stream is refused and /api/auth/me says 401', async () => {
    let meCalls = 0;
    const routes = signedIn('student');
    mockApi({
      ...routes,
      'GET /api/auth/me': () => {
        meCalls += 1;
        return meCalls === 1
          ? { body: F.session('student') }
          : apiError(401, 'UNAUTHENTICATED', 'Sign in');
      },
    });
    await renderApp('/');
    await screen.findByRole('heading', { name: 'Your week' });
    act(() => FakeEventSource.latest.fail(true));
    act(() => FakeEventSource.latest.fail(true));
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(meCalls).toBe(2);
    expect(FakeEventSource.live).toHaveLength(0);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('backs off and reconnects when the session is still fine', async () => {
    mockApi(signedIn('student'));
    await renderApp('/');
    await screen.findByRole('heading', { name: 'Your week' });
    act(() => FakeEventSource.latest.fail(true));
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(2), { timeout: 3000 });
    expect(FakeEventSource.live).toHaveLength(1);
  });

  it('passes ephemeral named events to subscribers, never into the feed', async () => {
    const { ActivityProvider, useActivity } =
      await import('../src/shell/activity/ActivityProvider');
    const seen: unknown[] = [];
    function Chat() {
      const { subscribe } = useActivity();
      useEffect(() => subscribe('rides.chat', (d) => seen.push(d)), [subscribe]);
      return null;
    }
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ActivityProvider>
          <Chat />
        </ActivityProvider>
      </QueryClientProvider>,
    );
    act(() => FakeEventSource.latest.emit('rides.chat', { text: 'On my way' }));
    expect(seen).toEqual([{ text: 'On my way' }]);
  });
});

describe('theme', () => {
  it('follows the system, and the toggle overrides it', async () => {
    media.prefersDark = true;
    mockApi(signedIn('student'));
    await renderApp('/');
    await screen.findByRole('heading', { name: 'Your week' });
    expect(document.documentElement.dataset.theme).toBe('dark');
    await userEvent.click(screen.getByRole('button', { name: /^Theme/ }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('uv-theme')).toBe('light');
  });

  it('still works when localStorage throws', async () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      clear: () => undefined,
    };
    vi.stubGlobal('localStorage', broken);
    mockApi(signedIn('student'));
    await renderApp('/');
    await screen.findByRole('heading', { name: 'Your week' });
    await userEvent.click(screen.getByRole('button', { name: /^Theme/ }));
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
