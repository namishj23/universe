import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import * as F from '../../../tools/design-compare/fixtures/index.ts';

export { F };

/** EventSource stand-in: tests push named events and failures into the newest instance. */
export class FakeEventSource extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readyState = FakeEventSource.CONNECTING;
  constructor(readonly url: string) {
    super();
    FakeEventSource.instances.push(this);
  }
  /** The streams nobody closed. */
  static get live() {
    return FakeEventSource.instances.filter((e) => e.readyState !== FakeEventSource.CLOSED);
  }
  static get latest() {
    const last = FakeEventSource.instances.at(-1);
    if (!last) throw new Error('no EventSource was created');
    return last;
  }
  open() {
    this.readyState = FakeEventSource.OPEN;
    this.dispatchEvent(new Event('open'));
  }
  emit(name: string, data: unknown) {
    this.dispatchEvent(new MessageEvent(name, { data: JSON.stringify(data) }));
  }
  /** `closed`: the server refused the stream (e.g. 401), so the browser gives up. */
  fail(closed = true) {
    this.readyState = closed ? FakeEventSource.CLOSED : FakeEventSource.CONNECTING;
    this.dispatchEvent(new Event('error'));
  }
  close() {
    this.readyState = FakeEventSource.CLOSED;
  }
}

type Reply = { status?: number; body?: unknown } | ((req: Request) => Reply | Promise<Reply>);
export type Routes = Record<string, Reply>;

export const apiError = (status: number, code: string, message: string) => ({
  status,
  body: { error: { code, message, requestId: 'req-test-1234' } },
});

/**
 * Stubs fetch. Keys are `METHOD /path` (query ignored); unknown routes answer 404. Returns
 * the calls, so tests can count them.
 */
export function mockApi(routes: Routes) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: url.pathname + url.search, body });
    let reply = routes[`${method} ${url.pathname}`] ?? apiError(404, 'NOT_FOUND', 'no mock');
    if (typeof reply === 'function') reply = await reply(new Request(url, init));
    const { status = 200, body: out } = reply as { status?: number; body?: unknown };
    if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    return new Response(out === undefined ? null : JSON.stringify(out), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

/** Everything a signed-in role needs to render the shell. */
export function signedIn(role: F.DemoRole, extra: Routes = {}): Routes {
  return {
    'GET /api/auth/me': { body: F.session(role) },
    'GET /api/modules': { body: F.modules(role) },
    'GET /api/activity': { body: F.feed(role) },
    'GET /api/dashboard': { body: F.dashboard(role) },
    'GET /api/dashboard/week': { body: F.week(role) },
    'GET /api/admin/users': { body: F.users() },
    'GET /api/admin/audit': { body: F.audit() },
    'POST /api/activity/read-all': { status: 204 },
    'POST /api/auth/logout': { status: 204 },
    ...extra,
  };
}

export async function renderApp(path = '/') {
  const { App } = await import('../src/App');
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}
