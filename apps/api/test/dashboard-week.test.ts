import { Router } from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { ApiErrorBody, WeekResponse, type WeekProviderItem } from '@universe/contracts';
import { createApp } from '../src/app.js';
import { SUMMARY_TIMEOUT_MS, zonedMidnight } from '../src/platform/dashboard.js';
import type { ModuleDefinition } from '../src/platform/modules/index.js';
import { login, seed } from './helpers.js';

beforeAll(seed);

const base = { roles: ['student'], router: Router() } as const;
const item = (at: string, title: string, extra: Partial<WeekProviderItem> = {}) => ({
  at,
  title,
  confirmed: true,
  href: '/rides',
  ...extra,
});

async function week(modules: ModuleDefinition[], query = '', timeZone?: string) {
  const app = createApp({ modules });
  const { cookie } = await login('student@universe.test', app);
  const req = request(app).get(`/api/dashboard/week${query}`).set('Cookie', cookie);
  if (timeZone) void req.set('X-Timezone', timeZone);
  return req;
}

describe('GET /api/dashboard/week', () => {
  it('returns seven dated days, empty days with no items, and drops items outside the range', async () => {
    const modules: ModuleDefinition[] = [
      {
        ...base,
        id: 'rides',
        label: 'Rides',
        order: 20,
        weekItems: () =>
          Promise.resolve([
            item('2026-10-29T08:10:00+05:30', 'Ride to SPIT', {
              status: { label: 'confirmed', tone: 'ok' },
            }),
            item('2026-10-28T23:59:00+05:30', 'Too early'),
            item('2026-11-05T00:00:00+05:30', 'Too late'),
          ]),
      },
    ];
    const res = await week(modules, '?from=2026-10-29');
    expect(res.status).toBe(200);
    const body = WeekResponse.parse(res.body);
    expect(body.from).toBe('2026-10-29');
    expect(body.timeZone).toBe('Asia/Kolkata');
    expect(body.days.map((d) => d.date)).toEqual([
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
    ]);
    expect(body.days[0]?.items).toEqual([
      {
        module: 'rides',
        time: '08:10',
        title: 'Ride to SPIT',
        status: { label: 'confirmed', tone: 'ok' },
        confirmed: true,
        href: '/rides',
      },
    ]);
    expect(body.days.slice(1).every((d) => d.items.length === 0)).toBe(true);
    expect(body.modules).toEqual([{ id: 'rides', status: 'ok' }]);
  });

  it('defaults to today in Asia/Kolkata and passes the local-midnight range to providers', async () => {
    let range: { from: Date; to: Date } | undefined;
    const modules: ModuleDefinition[] = [
      {
        ...base,
        id: 'hub',
        label: 'Hub',
        order: 10,
        weekItems: (_user, r) => {
          range = r;
          return Promise.resolve([]);
        },
      },
    ];
    const res = await week(modules);
    const body = WeekResponse.parse(res.body);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    expect(body.from).toBe(today);
    expect(range?.from.toISOString()).toBe(new Date(`${today}T00:00:00+05:30`).toISOString());
    expect(range && range.to.getTime() - range.from.getTime()).toBe(7 * 86_400_000);
  });

  it('places items on their day in the X-Timezone zone', async () => {
    const modules: ModuleDefinition[] = [
      {
        ...base,
        id: 'rides',
        label: 'Rides',
        order: 20,
        weekItems: () => Promise.resolve([item('2026-10-29T20:00:00Z', 'Late ride')]),
      },
    ];
    const kolkata = WeekResponse.parse((await week(modules, '?from=2026-10-29')).body);
    expect(kolkata.days[1]).toMatchObject({ date: '2026-10-30', items: [{ time: '01:30' }] });
    const utc = WeekResponse.parse((await week(modules, '?from=2026-10-29', 'UTC')).body);
    expect(utc.timeZone).toBe('UTC');
    expect(utc.days[0]).toMatchObject({ date: '2026-10-29', items: [{ time: '20:00' }] });
  });

  it('orders a day all-day first, then by time, module order and title', async () => {
    const day = '2026-10-29';
    const modules: ModuleDefinition[] = [
      {
        ...base,
        id: 'wellbeing',
        label: 'Wellbeing',
        order: 30,
        weekItems: () => Promise.resolve([item(`${day}T09:00:00+05:30`, 'B wellbeing')]),
      },
      {
        ...base,
        id: 'hub',
        label: 'Hub',
        order: 10,
        weekItems: () =>
          Promise.resolve([
            item(`${day}T09:00:00+05:30`, 'Z hub'),
            item(`${day}T09:00:00+05:30`, 'A hub'),
            item(`${day}T07:00:00+05:30`, 'Early'),
            item(`${day}T12:00:00+05:30`, 'Goal ends', { allDay: true }),
          ]),
      },
    ];
    const body = WeekResponse.parse((await week(modules, `?from=${day}`)).body);
    expect(body.days[0]?.items.map((i) => i.title)).toEqual([
      'Goal ends',
      'Early',
      'A hub',
      'Z hub',
      'B wellbeing',
    ]);
    expect(body.days[0]?.items[0]).toMatchObject({ module: 'hub', allDay: true });
    expect(body.days[0]?.items[0]).not.toHaveProperty('time');
  });

  it('reports a throwing, a hanging and a malformed provider while the others still contribute', async () => {
    let slowSignal: AbortSignal | undefined;
    const modules: ModuleDefinition[] = [
      {
        ...base,
        id: 'hub',
        label: 'Hub',
        order: 10,
        weekItems: () => Promise.resolve([item('2026-10-29T10:00:00+05:30', 'Still here')]),
      },
      {
        ...base,
        id: 'rides',
        label: 'Rides',
        order: 20,
        weekItems: () => Promise.reject(new Error('provider exploded')),
      },
      {
        ...base,
        id: 'wellbeing',
        label: 'Wellbeing',
        order: 30,
        weekItems: (_user, _range, signal) => {
          slowSignal = signal;
          return new Promise(() => {}); // never settles
        },
      },
      {
        ...base,
        id: 'observatory',
        label: 'Observatory',
        order: 40,
        // An external href is not allowed.
        weekItems: () =>
          Promise.resolve([item('2026-10-29T10:00:00+05:30', 'Bad', { href: '//evil.example' })]),
      },
      // No provider: not listed.
      { ...base, id: 'exam', label: 'Exam', order: 50 },
    ];
    const started = Date.now();
    const res = await week(modules, '?from=2026-10-29');
    const elapsed = Date.now() - started;
    const body = WeekResponse.parse(res.body);
    expect(body.modules).toEqual([
      { id: 'hub', status: 'ok' },
      { id: 'rides', status: 'error' },
      { id: 'wellbeing', status: 'timeout' },
      { id: 'observatory', status: 'error' },
    ]);
    expect(body.days[0]?.items.map((i) => i.title)).toEqual(['Still here']);
    expect(slowSignal?.aborted).toBe(true);
    expect(elapsed).toBeGreaterThanOrEqual(SUMMARY_TIMEOUT_MS - 50);
  });

  it('never calls a module the role cannot see', async () => {
    const modules: ModuleDefinition[] = [
      {
        ...base,
        roles: ['admin'],
        id: 'exam',
        label: 'Exam',
        order: 50,
        weekItems: () => Promise.reject(new Error('must not be called')),
      },
    ];
    const body = WeekResponse.parse((await week(modules, '?from=2026-10-29')).body);
    expect(body.modules).toEqual([]);
    expect(body.days.every((d) => d.items.length === 0)).toBe(true);
  });

  it.each([
    ['?from=2026-02-30', undefined],
    ['?from=29-10-2026', undefined],
    ['?from=2026-10-29&extra=1', undefined],
    ['', 'Mars/Olympus_Mons'],
  ])('rejects bad input %s %s with 400', async (query, timeZone) => {
    const res = await week([], query, timeZone);
    expect(res.status).toBe(400);
    expect(ApiErrorBody.parse(res.body).error.code).toBe('VALIDATION_FAILED');
  });

  it('requires sign-in', async () => {
    await request(createApp()).get('/api/dashboard/week').expect(401);
  });
});

describe('zonedMidnight', () => {
  it('handles a daylight-saving change', () => {
    // New York moves to EDT (UTC-4) on 8 March 2026; midnight before it is still EST (UTC-5).
    expect(zonedMidnight('2026-03-08', 'America/New_York').toISOString()).toBe(
      '2026-03-08T05:00:00.000Z',
    );
    expect(zonedMidnight('2026-03-09', 'America/New_York').toISOString()).toBe(
      '2026-03-09T04:00:00.000Z',
    );
    expect(zonedMidnight('2026-10-29', 'Asia/Kolkata').toISOString()).toBe(
      '2026-10-28T18:30:00.000Z',
    );
  });
});
