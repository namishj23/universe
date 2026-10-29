import { screen } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import { apiError, mockApi, renderApp, signedIn } from './helpers';

// jsdom cannot compute colours, so contrast is checked in real Chromium by
// tools/design-compare/a11y.spec.ts; everything else is checked here.
const PAGES = [
  { path: '/login', heading: 'Sign in', role: null },
  { path: '/', heading: 'Your week', role: 'student' },
  { path: '/inbox', heading: 'Inbox', role: 'admin' },
  { path: '/admin', heading: 'Admin', role: 'admin', ready: 'Kabir Shah' },
  { path: '/admin/audit', heading: 'Admin', role: 'admin', ready: 'auth.login_failed' },
] as const;

describe('axe', () => {
  for (const theme of ['light', 'dark'])
    for (const p of PAGES)
      it(`${p.path} (${theme}) has no violations`, async () => {
        localStorage.setItem('uv-theme', theme);
        mockApi(
          p.role
            ? signedIn(p.role)
            : { 'GET /api/auth/me': apiError(401, 'UNAUTHENTICATED', 'Sign in first') },
        );
        await renderApp(p.path);
        await screen.findByRole('heading', { name: p.heading, level: 1 });
        if ('ready' in p) await screen.findByText(p.ready);
        const result = await axe.run(document.body, {
          rules: { 'color-contrast': { enabled: false } },
        });
        expect(
          result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' | ')}`),
        ).toEqual([]);
      });
});
