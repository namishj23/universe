import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { F, apiError, mockApi, renderApp, signedIn } from './helpers';

const signedOut = {
  'GET /api/auth/me': apiError(401, 'UNAUTHENTICATED', 'Sign in first'),
};

async function signIn(email = 'nobody@universe.test', password = 'wrong-password') {
  await userEvent.type(await screen.findByLabelText('EMAIL'), email);
  await userEvent.type(screen.getByLabelText('PASSWORD'), password);
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('login', () => {
  it('shows the same message for any wrong credentials and moves focus to it', async () => {
    mockApi({
      ...signedOut,
      'POST /api/auth/login': apiError(
        401,
        'INVALID_CREDENTIALS',
        'Email or password is incorrect',
      ),
    });
    await renderApp('/login');
    await signIn();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Email or password is incorrect.');
    expect(alert).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it("shows the server's message for 429", async () => {
    mockApi({
      ...signedOut,
      'POST /api/auth/login': apiError(
        429,
        'TOO_MANY_ATTEMPTS',
        'Too many attempts. Try again in 15 minutes.',
      ),
    });
    await renderApp('/login');
    await signIn();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many attempts. Try again in 15 minutes.',
    );
  });

  it('hides the demo accounts unless VITE_DEMO_MODE=true, and they fill the email only', async () => {
    mockApi(signedOut);
    await renderApp('/login');
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(screen.queryByText(/DEMO ACCOUNTS/)).not.toBeInTheDocument();
  });

  it('demo build: clicking an account fills its email, never a password', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'true');
    vi.resetModules();
    mockApi(signedOut);
    await renderApp('/login');
    await userEvent.click(await screen.findByRole('button', { name: /mentor@universe\.test/ }));
    expect(screen.getByLabelText('EMAIL')).toHaveValue('mentor@universe.test');
    expect(screen.getByLabelText('PASSWORD')).toHaveValue('');
    expect(document.body.textContent).not.toMatch(/password[^s]*:/i);
  });

  it('signs in and opens the dashboard', async () => {
    mockApi({
      ...signedIn('student'),
      ...signedOut,
      'POST /api/auth/login': { body: F.session('student') },
    });
    await renderApp('/login');
    await signIn('student@universe.test', 'right-password-12');
    expect(await screen.findByRole('heading', { name: 'Your week' })).toBeInTheDocument();
  });
});

describe('forced password change', () => {
  it('blocks every other route until the password is changed', async () => {
    const calls = mockApi({
      ...signedIn('student'),
      'GET /api/auth/me': { body: F.session('student', true) },
      'POST /api/auth/change-password': { status: 204 },
    });
    for (const path of ['/', '/inbox', '/admin', '/hub', '/nowhere']) {
      const { unmount } = await renderApp(path);
      expect(
        await screen.findByRole('heading', { name: 'Choose a new password' }),
      ).toBeInTheDocument();
      unmount();
    }
    expect(calls.some((c) => c.path.startsWith('/api/dashboard'))).toBe(false);

    await renderApp('/inbox');
    await userEvent.type(await screen.findByLabelText('TEMPORARY PASSWORD'), 'temp-password-1');
    const next = screen.getByLabelText('NEW PASSWORD');
    await userEvent.type(next, 'short');
    expect(screen.getByText('7 more characters needed.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change password' })).toBeDisabled();
    await userEvent.clear(next);
    await userEvent.type(next, 'student-and-more');
    expect(screen.getByText('Must not contain your email name.')).toBeInTheDocument();
    await userEvent.clear(next);
    await userEvent.type(next, 'a-much-better-passphrase');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('heading', { name: 'Your week' })).toBeInTheDocument();
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/api/auth/change-password')?.body).toEqual({
        currentPassword: 'temp-password-1',
        newPassword: 'a-much-better-passphrase',
      }),
    );
  });
});
