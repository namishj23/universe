import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { AuditEntry, pageOf } from '@universe/contracts';
import { createApp } from '../src/app.js';
import { audit } from '../src/platform/audit/index.js';
import { emailHmac } from '../src/platform/auth/throttle.js';
import { prisma } from '../src/platform/db.js';
import { as, DEMO_ACCOUNTS, login, PASSWORD, seed } from './helpers.js';

const AuditPage = pageOf(AuditEntry);
beforeAll(seed);

describe('recording', () => {
  it('records sign-in, failed sign-in, sign-out and admin actions', async () => {
    const app = createApp();
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'Ghost@Universe.test', password: 'Secret-Guess-123' })
      .expect(401);
    const admin = await login('admin@universe.test', app);
    await as(admin)
      .post('/api/activity/announcements')
      .send({ message: 'Hi', roles: ['mentor'] });
    const created = await as(admin)
      .post('/api/admin/users')
      .send({ name: 'Audit Target', email: 'target@universe.test', role: 'student' })
      .expect(201);
    const targetId = (created.body as { user: { id: string } }).user.id;
    await as(admin).patch(`/api/admin/users/${targetId}`).send({ role: 'mentor' }).expect(200);
    await as(admin).post(`/api/admin/users/${targetId}/reset-password`).expect(200);
    await as(admin).post('/api/auth/logout').expect(204);

    const rows = await prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => r.action)).toEqual([
      'auth.login_failed',
      'auth.login',
      'platform.announcement_sent',
      'admin.user_created',
      'admin.user_updated',
      'admin.user_password_reset',
      'auth.logout',
    ]);
    const failed = rows[0];
    expect(failed).toMatchObject({
      actorId: null,
      metadata: { emailHmac: emailHmac('ghost@universe.test') },
    });
    expect(failed?.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(rows[2]?.metadata).toEqual({
      recipients: DEMO_ACCOUNTS.filter((a) => a.role === 'mentor').length,
      roles: ['mentor'],
    });
    expect(rows[4]).toMatchObject({
      actorId: admin.user.id,
      targetType: 'user',
      targetId,
      metadata: { role: { from: 'student', to: 'mentor' } },
    });

    // No entry holds a password, a temporary password or a failed sign-in's email address.
    const dump = JSON.stringify(rows);
    expect(dump).not.toMatch(/ghost|Secret-Guess-123|password"|temporary/i);
    expect(dump).not.toContain(PASSWORD);
  });

  it('commits or rolls back with the action it belongs to', async () => {
    const before = await prisma.auditLog.count();
    await expect(
      prisma.$transaction(async (tx) => {
        await audit.record(tx, {
          actorId: null,
          action: 'auth.password_changed',
          metadata: {},
        });
        throw new Error('the action failed');
      }),
    ).rejects.toThrow('the action failed');
    expect(await prisma.auditLog.count()).toBe(before);
  });

  it('rejects unknown actions and metadata that does not match the action', async () => {
    await expect(
      // @ts-expect-error unknown actions are rejected at compile time too
      audit.record(prisma, { actorId: null, action: 'auth.nope', metadata: {} }),
    ).rejects.toThrow(/Unknown audit action/);
    await expect(
      audit.record(prisma, {
        actorId: null,
        action: 'auth.login_failed',
        // @ts-expect-error the email itself is not allowed
        metadata: { email: 'someone@universe.test' },
      }),
    ).rejects.toThrow();
  });
});

describe('append-only', () => {
  it('refuses UPDATE and DELETE at the database level', async () => {
    expect(await prisma.auditLog.count()).toBeGreaterThan(0);
    await expect(prisma.$executeRaw`UPDATE audit_log SET action = 'tampered'`).rejects.toThrow(
      /append-only/,
    );
    await expect(prisma.$executeRaw`DELETE FROM audit_log`).rejects.toThrow(/append-only/);
    await expect(prisma.auditLog.deleteMany()).rejects.toThrow();
    expect(await prisma.auditLog.count({ where: { action: 'tampered' } })).toBe(0);
  });
});

describe('GET /api/admin/audit', () => {
  it('lists newest first with filters and paging', async () => {
    const admin = await login('admin@universe.test');
    const list = async (query: Record<string, string>) =>
      AuditPage.parse((await as(admin).get('/api/admin/audit').query(query).expect(200)).body);

    const all = await list({ limit: '100' });
    const times = all.items.map((e) => e.createdAt);
    expect(times).toEqual([...times].sort().reverse());

    const logins = await list({ action: 'auth.login' });
    expect(logins.items.length).toBeGreaterThan(0);
    expect(logins.items.every((e) => e.action === 'auth.login')).toBe(true);
    expect(logins.items[0]?.actor).toEqual({ id: admin.user.id, name: 'Admin Office' });

    const auth = await list({ actionPrefix: 'auth', limit: '100' });
    expect(auth.items.length).toBeGreaterThan(0);
    expect(auth.items.every((e) => e.action.startsWith('auth.'))).toBe(true);
    expect(auth.items.length).toBe(all.items.filter((e) => e.action.startsWith('auth.')).length);
    await as(admin).get('/api/admin/audit?actionPrefix=auth.%25').expect(400);

    const byActor = await list({ actorId: admin.user.id });
    expect(byActor.items.every((e) => e.actor?.id === admin.user.id)).toBe(true);
    expect((await list({ targetType: 'user', targetId: admin.user.id })).items.length).toBe(
      (await list({ targetId: admin.user.id })).items.length,
    );
    expect((await list({ from: new Date(Date.now() + 60_000).toISOString() })).items).toEqual([]);

    const first = await list({ limit: '2' });
    const rest = await list({ limit: '100', cursor: first.nextCursor ?? '' });
    expect([...first.items, ...rest.items].map((e) => e.id)).toEqual(all.items.map((e) => e.id));

    await as(admin).get('/api/admin/audit?actorId=not-a-uuid').expect(400);
    await as(admin).get('/api/admin/audit?limit=101').expect(400);
  });
});
