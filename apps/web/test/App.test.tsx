import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const apiError = (status: number, code: string, message: string) =>
  json(status, { error: { code, message, requestId: '00000000-0000-4000-8000-000000000000' } });

const user = {
  id: '6f1c1d3e-8a7b-4c2d-9e0f-1a2b3c4d5e6f',
  email: 'admin@universe.test',
  name: 'Admin Office',
  role: 'admin',
};

function renderApp(path: string, routes: Record<string, () => Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      const route = Object.keys(routes).find((p) => input.startsWith(p));
      return Promise.resolve(route ? routes[route]!() : apiError(404, 'NOT_FOUND', 'Not found'));
    }),
  );
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe('login page', () => {
  it("shows the server's error message and moves focus to it", async () => {
    renderApp('/login', {
      '/api/auth/me': () => apiError(401, 'UNAUTHENTICATED', 'Sign in required'),
      '/api/auth/login': () =>
        apiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect'),
    });
    await userEvent.type(await screen.findByLabelText('Email'), 'admin@universe.test');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Email or password is incorrect');
    expect(alert).toHaveFocus();
  });
});

describe('feed page', () => {
  it('closes its EventSource and removes listeners on unmount', async () => {
    const sources: FakeEventSource[] = [];
    class FakeEventSource {
      readonly listeners = new Map<string, unknown>();
      close = vi.fn();
      constructor(readonly url: string) {
        sources.push(this);
      }
      addEventListener(type: string, fn: unknown) {
        this.listeners.set(type, fn);
      }
      removeEventListener(type: string) {
        this.listeners.delete(type);
      }
    }
    vi.stubGlobal('EventSource', FakeEventSource);

    const { unmount } = renderApp('/', {
      '/api/auth/me': () => json(200, { user, csrfToken: 'token' }),
      '/api/activity/unread-count': () => json(200, { count: 0 }),
      '/api/activity': () => json(200, { items: [], nextCursor: null }),
    });
    expect(await screen.findByText('No activity yet.')).toBeInTheDocument();
    const source = sources.at(-1);
    expect(source?.url).toBe('/api/activity/stream');
    expect(source?.listeners.size).toBe(2);

    unmount();
    expect(source?.close).toHaveBeenCalled();
    expect(source?.listeners.size).toBe(0);
  });
});
