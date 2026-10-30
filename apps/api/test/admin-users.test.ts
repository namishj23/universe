import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AdminUser,
  ApiErrorBody,
  CreateUserResponse,
  pageOf,
  SessionResponse,
} from '@universe/contracts';
import { createApp } from '../src/app.js';
import { connectedUserIds } from '../src/platform/activity/broker.js';
import { verifyPassword } from '../src/platform/auth/password.js';
import { prisma } from '../src/platform/db.js';
import { as, login, seed, userId } from './helpers.js';
import { INACTIVE_ACCOUNT } from '../../../prisma/seed/platform.js';

const UserPage = pageOf(AdminUser);
const codeOf = (body: unknown) => ApiErrorBody.parse(body).error.code;

let admin: Awaited<ReturnType<typeof login>>;
beforeAll(seed);
beforeEach(async () => {
  admin = await login('admin@universe.test');
});

async function createUser(name: string, email: string, role = 'student') {
  const res = await as(admin).post('/api/admin/users').send({ name, email, role }).expect(201);
  return CreateUserResponse.parse(res.body);
}

describe('create', () => {
  it('returns a temporary password once; the user must change it before anything else', async () => {
    const { user, temporaryPassword } = await createUser('Kavya Rao', 'Kavya.Rao@Universe.test');
    expect(temporaryPassword.length).toBeGreaterThanOrEqual(16);
    expect(user).toMatchObject({ email: 'kavya.rao@universe.test', mustChangePassword: true });

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.passwordHash).not.toContain(temporaryPassword);
    expect(await verifyPassword(row.passwordHash, temporaryPassword)).toBe(true);
    // Never shown again: not in the list.
    const list = await as(admin).get('/api/admin/users').expect(200);
    expect(JSON.stringify(list.body)).not.toContain(temporaryPassword);

    const app = createApp();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: temporaryPassword })
      .expect(200);
    const session = SessionResponse.parse(res.body);
    expect(session.mustChangePassword).toBe(true);
    const kavya = {
      app,
      cookie: res.get('Set-Cookie')?.[0]?.split(';')[0] ?? '',
      csrfToken: session.csrfToken,
    };

    for (const blocked of ['/api/activity', '/api/dashboard', '/api/modules'])
      expect(codeOf((await as(kavya).get(blocked).expect(403)).body)).toBe(
        'PASSWORD_CHANGE_REQUIRED',
      );
    await as(kavya).get('/api/auth/me').expect(200);
    await as(kavya)
      .post('/api/auth/change-password')
      .send({ currentPassword: temporaryPassword, newPassword: 'a brand new passphrase' })
      .expect(204);
    await as(kavya).get('/api/activity').expect(200);
    expect(
      SessionResponse.parse((await as(kavya).get('/api/auth/me')).body).mustChangePassword,
    ).toBe(false);
  });

  it('rejects a duplicate email with 409 and bad input with 400', async () => {
    await createUser('Ishaan Shah', 'ishaan@universe.test');
    const dup = await as(admin)
      .post('/api/admin/users')
      .send({ name: 'Someone Else', email: 'ISHAAN@universe.test', role: 'mentor' })
      .expect(409);
    expect(codeOf(dup.body)).toBe('CONFLICT');
    await as(admin)
      .post('/api/admin/users')
      .send({ name: 'X', email: 'x@universe.test', role: 'root' })
      .expect(400);
    await as(admin)
      .post('/api/admin/users')
      .send({ name: 'X', email: 'x@universe.test', role: 'student', isActive: false })
      .expect(400);
  });
});

describe('list', () => {
  it('searches by partial name or email, filters, and pages', async () => {
    await createUser('Zara Fernandes', 'zara@universe.test', 'mentor');
    await createUser('Farhan Akhtar', 'farhan@universe.test');
    const search = async (query: Record<string, string>) =>
      UserPage.parse((await as(admin).get('/api/admin/users').query(query).expect(200)).body);

    expect((await search({ q: 'ernand' })).items.map((u) => u.name)).toEqual(['Zara Fernandes']);
    expect((await search({ q: 'FARHAN@' })).items.map((u) => u.name)).toEqual(['Farhan Akhtar']);
    expect((await search({ q: 'fernandes', role: 'student' })).items).toEqual([]);
    // LIKE wildcards are searched literally.
    expect((await search({ q: '%' })).items).toEqual([]);
    expect((await search({ q: '_' })).items).toEqual([]);

    const all = await prisma.user.count();
    const first = await search({ limit: '2' });
    expect(first.items).toHaveLength(2);
    const second = await search({ limit: '100', cursor: first.nextCursor ?? '' });
    expect(first.items.length + second.items.length).toBe(all);
    // Only the seed's one inactive demo account (the INACTIVE state in the design).
    expect((await search({ active: 'false' })).items.map((u) => u.email)).toEqual([
      INACTIVE_ACCOUNT.email,
    ]);
  });
});

describe('access', () => {
  it('forbids every admin route to a non-admin', async () => {
    const student = await login('student@universe.test');
    const id = await userId('student2@universe.test');
    const calls = [
      as(student).get('/api/admin/users'),
      as(student)
        .post('/api/admin/users')
        .send({ name: 'A', email: 'a@universe.test', role: 'admin' }),
      as(student).patch(`/api/admin/users/${id}`).send({ isActive: false }),
      as(student).post(`/api/admin/users/${id}/reset-password`),
      as(student).get('/api/admin/audit'),
    ];
    for (const call of calls) expect(codeOf((await call.expect(403)).body)).toBe('FORBIDDEN');
    expect((await prisma.user.findUniqueOrThrow({ where: { id } })).isActive).toBe(true);
  });

  it('stops an admin demoting or deactivating themselves', async () => {
    for (const change of [{ role: 'student' }, { isActive: false }]) {
      const res = await as(admin)
        .patch(`/api/admin/users/${admin.user.id}`)
        .send(change)
        .expect(409);
      expect(codeOf(res.body)).toBe('CANNOT_CHANGE_SELF');
    }
    await as(admin).post(`/api/admin/users/${admin.user.id}/reset-password`).expect(409);
  });
});

describe('last active admin', () => {
  it('two admins deactivating each other at the same moment leave one active admin', async () => {
    const { user: second } = await createUser('Second Admin', 'admin2@universe.test', 'admin');
    await prisma.user.update({ where: { id: second.id }, data: { mustChangePassword: false } });
    const { temporaryPassword } = CreateUserResponse.pick({ temporaryPassword: true }).parse(
      (await as(admin).post(`/api/admin/users/${second.id}/reset-password`).expect(200)).body,
    );
    await prisma.user.update({ where: { id: second.id }, data: { mustChangePassword: false } });
    const app = createApp();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin2@universe.test', password: temporaryPassword })
      .expect(200);
    const other = {
      app,
      cookie: res.get('Set-Cookie')?.[0]?.split(';')[0] ?? '',
      csrfToken: SessionResponse.parse(res.body).csrfToken,
    };

    const [a, b] = await Promise.all([
      as(admin).patch(`/api/admin/users/${second.id}`).send({ isActive: false }),
      as(other).patch(`/api/admin/users/${admin.user.id}`).send({ isActive: false }),
    ]);
    const statuses = [a.status, b.status].sort();
    // One wins. The loser is refused as the last admin, or is already signed out (deactivated).
    expect(statuses[0]).toBe(200);
    expect([401, 409]).toContain(statuses[1]);
    expect(await prisma.user.count({ where: { role: 'admin', isActive: true } })).toBe(1);

    // Put both back for the following tests.
    await prisma.user.updateMany({ where: { role: 'admin' }, data: { isActive: true } });
  });
});

describe('deactivate and reset password', () => {
  let server: Server;
  let baseUrl: string;
  beforeAll(async () => {
    server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });

  /** Opens the SSE stream and resolves when the server ends it. */
  async function openStream(cookie: string) {
    const res = await fetch(`${baseUrl}/api/activity/stream`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const ended = (async () => {
      for (;;) if ((await reader.read()).done) return true;
    })();
    return { ended };
  }

  it.each([
    [
      'deactivating',
      (id: string) => as(admin).patch(`/api/admin/users/${id}`).send({ isActive: false }),
    ],
    [
      'resetting the password of',
      (id: string) => as(admin).post(`/api/admin/users/${id}/reset-password`),
    ],
  ])('%s a user deletes their sessions and closes their live stream', async (_label, act) => {
    const target = await login('mentor@universe.test');
    const stream = await openStream(target.cookie);
    await vi.waitFor(() => expect(connectedUserIds([target.user.id])).toHaveLength(1));

    await act(target.user.id).expect(200);

    expect(await prisma.session.count({ where: { userId: target.user.id } })).toBe(0);
    await request(target.app).get('/api/auth/me').set('Cookie', target.cookie).expect(401);
    await expect(stream.ended).resolves.toBe(true);
    expect(connectedUserIds([target.user.id])).toEqual([]);

    await seed(); // restores the account and its password
  });
});
