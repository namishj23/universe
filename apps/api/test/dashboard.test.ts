import { Router } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { DashboardResponse, dashboardSummaryRegistry } from '@universe/contracts';
import { z } from 'zod';
import { createApp } from '../src/app.js';
import { SUMMARY_TIMEOUT_MS } from '../src/platform/dashboard.js';
import type { ModuleDefinition } from '../src/platform/modules/index.js';
import { login, seed } from './helpers.js';

// rides has no summary schema until P3; give it one for this test only.
beforeAll(async () => {
  dashboardSummaryRegistry.rides = z.object({ status: z.literal('ok') });
  await seed();
});
afterAll(() => {
  delete dashboardSummaryRegistry.rides;
});

it('returns 200 with ok, error and timeout entries; one failing module never fails the page', async () => {
  let slowSignal: AbortSignal | undefined;
  const base = { roles: ['student'], router: Router() } as const;
  const modules: ModuleDefinition[] = [
    {
      ...base,
      id: 'hub',
      label: 'Hub',
      order: 10,
      dashboardSummary: () => Promise.resolve({ status: 'not_built' }),
    },
    {
      ...base,
      id: 'rides',
      label: 'Rides',
      order: 20,
      dashboardSummary: () => Promise.reject(new Error('provider exploded')),
    },
    {
      ...base,
      id: 'wellbeing',
      label: 'Wellbeing',
      order: 30,
      dashboardSummary: (_user, signal) => {
        slowSignal = signal;
        return new Promise(() => {}); // never settles
      },
    },
    // Visible to admins only, so a student's dashboard must not even call it.
    {
      ...base,
      roles: ['admin'],
      id: 'observatory',
      label: 'Observatory',
      order: 40,
      dashboardSummary: () => Promise.reject(new Error('must not be called')),
    },
  ];
  const app = createApp({ modules });
  const { cookie, user } = await login('student@universe.test', app);

  const started = Date.now();
  const res = await request(app).get('/api/dashboard').set('Cookie', cookie).expect(200);
  const elapsed = Date.now() - started;

  const body = DashboardResponse.parse(res.body);
  expect(body.user).toEqual(user);
  expect(body.unreadCount).toBe(1); // the seeded welcome message
  expect(body.latest).toHaveLength(1);
  expect(body.modules).toEqual([
    { id: 'hub', status: 'ok', data: { status: 'not_built' } },
    { id: 'rides', status: 'error' },
    { id: 'wellbeing', status: 'timeout' },
  ]);
  expect(slowSignal?.aborted).toBe(true);
  expect(elapsed).toBeGreaterThanOrEqual(SUMMARY_TIMEOUT_MS - 50);
  expect(elapsed).toBeLessThan(SUMMARY_TIMEOUT_MS + 1_000);
});

it('reports a summary that does not match its contract schema as an error', async () => {
  const app = createApp({
    modules: [
      {
        id: 'hub',
        label: 'Hub',
        order: 10,
        roles: ['student'],
        router: Router(),
        dashboardSummary: () => Promise.resolve({ status: 'ready', secret: 'leak' }),
      },
    ],
  });
  const { cookie } = await login('student@universe.test', app);
  const res = await request(app).get('/api/dashboard').set('Cookie', cookie).expect(200);
  expect(DashboardResponse.parse(res.body).modules).toEqual([{ id: 'hub', status: 'error' }]);
});

it('requires sign-in', async () => {
  await request(createApp()).get('/api/dashboard').expect(401);
});
