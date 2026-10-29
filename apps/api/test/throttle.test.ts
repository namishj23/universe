import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { ApiErrorBody } from '@universe/contracts';
import { createApp } from '../src/app.js';
import { emailHmac, purgeStaleThrottle } from '../src/platform/auth/throttle.js';
import { prisma } from '../src/platform/db.js';
import { PASSWORD, seed } from './helpers.js';

beforeAll(seed);

const withoutRequestId = (body: unknown) => {
  const { code, message } = ApiErrorBody.parse(body).error;
  return { code, message };
};

describe('login throttle', () => {
  it('locks an existing and an unknown email alike after five failures', async () => {
    const app = createApp();
    const attempt = (email: string, password: string) =>
      request(app).post('/api/auth/login').send({ email, password });
    // Each email gets its own 5 attempts; the IP limiter (10/min) is per app, so use two apps.
    const results: Record<string, { status: number; body: unknown }[]> = {};
    for (const [email, app2] of [
      ['student@universe.test', createApp()],
      ['nobody-here@universe.test', createApp()],
    ] as const) {
      results[email] = [];
      for (let i = 0; i < 5; i++) {
        const res = await request(app2)
          .post('/api/auth/login')
          .send({ email, password: 'wrong-password' });
        results[email].push({ status: res.status, body: withoutRequestId(res.body) });
      }
      // The sixth try is refused even with the right password (for the existing account).
      const res = await request(app2).post('/api/auth/login').send({ email, password: PASSWORD });
      results[email].push({ status: res.status, body: withoutRequestId(res.body) });
    }
    const known = results['student@universe.test'];
    const unknown = results['nobody-here@universe.test'];
    expect(known).toEqual(unknown);
    expect(known?.map((r) => r.status)).toEqual([401, 401, 401, 401, 401, 429]);
    expect(known?.[5]?.body).toEqual({
      code: 'TOO_MANY_ATTEMPTS',
      message: 'Too many sign-in attempts. Try again later.',
    });
    // Still locked on a fresh app (not the IP limiter): the lock lives in the database.
    expect((await attempt('student@universe.test', PASSWORD)).status).toBe(429);
  });

  it('stores no readable email: only HMAC keys', async () => {
    const rows = await prisma.loginThrottle.findMany();
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) {
      expect(row.keyHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(row)).not.toMatch(/@|universe|student|nobody/);
    }
    expect(rows.map((r) => r.keyHash)).toContain(emailHmac('nobody-here@universe.test'));
    expect(emailHmac('Student@Universe.TEST')).toBe(emailHmac('student@universe.test'));
  });

  it('purges rows untouched for 24 hours', async () => {
    const keyHash = emailHmac('old@universe.test');
    await prisma.loginThrottle.create({
      data: { keyHash, failedCount: 3, updatedAt: new Date(Date.now() - 25 * 3_600_000) },
    });
    expect(await purgeStaleThrottle()).toBeGreaterThanOrEqual(1);
    expect(await prisma.loginThrottle.count({ where: { keyHash } })).toBe(0);
  });
});

describe('database indexes that Prisma features could drop silently', () => {
  it('has the partial unread index and the trigram search indexes', async () => {
    const rows = await prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN ('activity_events_unread_idx', 'users_name_trgm_idx', 'users_email_trgm_idx')`;
    const defs = Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef]));
    expect(defs.activity_events_unread_idx).toMatch(/\(recipient_id\) WHERE \(read_at IS NULL\)$/);
    expect(defs.users_name_trgm_idx).toMatch(/USING gin \(name gin_trgm_ops\)/);
    expect(defs.users_email_trgm_idx).toMatch(/USING gin \(email gin_trgm_ops\)/);
  });
});
