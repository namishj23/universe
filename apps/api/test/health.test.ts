import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/platform/db.js';

it('live is 200', async () => {
  await request(createApp()).get('/api/health/live').expect(200, { status: 'ok' });
});

it('ready is 200 with the database up', async () => {
  await request(createApp()).get('/api/health/ready').expect(200, { status: 'ok' });
});

it('echoes a valid X-Request-Id and replaces an invalid one', async () => {
  const app = createApp();
  const id = '6f1c1d3e-8a7b-4c2d-9e0f-1a2b3c4d5e6f';
  const kept = await request(app).get('/api/health/live').set('X-Request-Id', id);
  expect(kept.get('X-Request-Id')).toBe(id);
  const replaced = await request(app).get('/api/health/live').set('X-Request-Id', 'not-a-uuid');
  expect(replaced.get('X-Request-Id')).toMatch(/^[0-9a-f-]{36}$/);
  expect(replaced.get('X-Powered-By')).toBeUndefined();
});

// P7-001: every connection's session is UTC, so the database clock, SQL time maths and the
// stored instants agree with JavaScript. (Before: the session was IST and every Date was
// stored 5 h 30 m early.)
describe('database time zone', () => {
  it('SELECT now() is within 1 s of Date.now()', async () => {
    const [row] = await prisma.$queryRaw<{ now: Date; tz: string }[]>`
      SELECT now() AS now, current_setting('TimeZone') AS tz`;
    expect(row!.tz).toBe('UTC');
    expect(Math.abs(row!.now.getTime() - Date.now())).toBeLessThan(1_000);
  });

  it('a Date written through Prisma reads back from raw SQL as the true UTC instant', async () => {
    const at = new Date('2026-10-30T03:30:00.123Z'); // 09:00:00.123 IST
    await prisma.loginThrottle.create({ data: { keyHash: 'p7-001-probe', lockedUntil: at } });
    const [row] = await prisma.$queryRaw<{ text: string; ist: string }[]>`
      SELECT locked_until::text AS text,
             to_char(locked_until AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS ist
      FROM login_throttle WHERE key_hash = 'p7-001-probe'`;
    expect(row!.text).toBe('2026-10-30 03:30:00.123+00');
    expect(row!.ist).toBe('09:00');
  });

  it('values written with the database clock read back as now (±2 s)', async () => {
    await prisma.$executeRaw`INSERT INTO login_throttle (key_hash) VALUES ('p7-001-db-clock')`;
    const row = await prisma.loginThrottle.findUniqueOrThrow({
      where: { keyHash: 'p7-001-db-clock' },
    });
    expect(Math.abs(row.updatedAt.getTime() - Date.now())).toBeLessThan(2_000);
  });
});
