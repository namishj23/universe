import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApiErrorBody } from '@universe/contracts';
import { createApp } from '../src/app.js';
import { emailHmac } from '../src/platform/auth/throttle.js';
import { prisma } from '../src/platform/db.js';
import { DEMO_ACCOUNTS, login, PASSWORD, seed } from './helpers.js';

const errorOf = (body: unknown) => ApiErrorBody.parse(body).error;

beforeAll(seed);
// Session counts below are per user, so each test starts with none.
beforeEach(async () => {
  await prisma.session.deleteMany();
});

describe('POST /api/auth/login', () => {
  it.each(DEMO_ACCOUNTS)('signs in $email ($role)', async ({ email, name, role }) => {
    const res = await request(createApp())
      .post('/api/auth/login')
      .send({ email: ` ${email.toUpperCase()} `, password: PASSWORD })
      .expect(200);

    const cookie = res.get('Set-Cookie')?.[0] ?? '';
    expect(cookie).toMatch(/^uv_session=[\w-]{43};/);
    expect(cookie).toMatch(/; HttpOnly/);
    expect(cookie).toMatch(/; SameSite=Lax/);
    expect(Object.keys(res.body as object).sort()).toEqual([
      'csrfToken',
      'mustChangePassword',
      'user',
    ]);
    expect(res.body).toMatchObject({ mustChangePassword: false });
    expect(res.body).toMatchObject({ user: { email, name, role } });
    expect(Object.keys((res.body as { user: object }).user).sort()).toEqual([
      'email',
      'id',
      'name',
      'role',
    ]);
    expect(JSON.stringify(res.body)).not.toMatch(/"password|hash/i);
  });

  it('gives the same status and message for a wrong password and an unknown email', async () => {
    const app = createApp();
    const wrong = await request(app)
      .post('/api/auth/login')
      .send({ email: 'student@universe.test', password: 'not-the-password' });
    const unknown = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@universe.test', password: 'not-the-password' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    const a = errorOf(wrong.body);
    const b = errorOf(unknown.body);
    expect([a.code, a.message]).toEqual([b.code, b.message]);
    expect(a.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects unknown fields, oversized passwords and non-JSON bodies', async () => {
    const app = createApp();
    const extra = await request(app)
      .post('/api/auth/login')
      .send({ email: 'student@universe.test', password: PASSWORD, role: 'admin' });
    expect(extra.status).toBe(400);
    expect(errorOf(extra.body).code).toBe('VALIDATION_FAILED');
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'student@universe.test', password: 'x'.repeat(257) })
      .expect(400);
    await request(app)
      .post('/api/auth/login')
      .type('form')
      .send({ email: 'student@universe.test', password: PASSWORD })
      .expect(415);
  });

  it('locks the email after five failures, refuses the right password, and unlocks later', async () => {
    const app = createApp();
    const email = 'mentor@universe.test';
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/api/auth/login')
        .send({ email, password: 'wrong-password' })
        .expect(401);
    }
    const locked = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
    expect(locked.status).toBe(429);
    expect(errorOf(locked.body).message).not.toMatch(/account|locked|exist/i);
    const keyHash = emailHmac(email);
    expect(
      (await prisma.loginThrottle.findUniqueOrThrow({ where: { keyHash } })).lockedUntil,
    ).not.toBeNull();

    // Let the 15-minute lock run out.
    await prisma.loginThrottle.update({
      where: { keyHash },
      data: { lockedUntil: new Date(Date.now() - 1000) },
    });
    await request(app).post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
    expect(await prisma.loginThrottle.count({ where: { keyHash } })).toBe(0);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.lastLoginAt).not.toBeNull();
  });

  it('rate-limits to 10 requests per minute per IP', async () => {
    const app = createApp();
    // A different email each time, so the per-email lockout (5 failures) never applies.
    const attempt = (i: number) =>
      request(app)
        .post('/api/auth/login')
        .send({ email: `ghost${i}@universe.test`, password: 'whatever' });
    for (let i = 0; i < 10; i++) expect((await attempt(i)).status).toBe(401);
    const res = await attempt(10);
    expect(res.status).toBe(429);
    expect(errorOf(res.body).code).toBe('TOO_MANY_ATTEMPTS');
  });

  it('replaces the session the request already carried', async () => {
    const { app, cookie, user } = await login('student2@universe.test');
    await request(app)
      .post('/api/auth/login')
      .set('Cookie', cookie)
      .send({ email: 'student2@universe.test', password: PASSWORD })
      .expect(200);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(1);
    await request(app).get('/api/auth/me').set('Cookie', cookie).expect(401);
  });
});

describe('sessions', () => {
  it('/me returns the user and the same CSRF token', async () => {
    const { app, cookie, csrfToken, user } = await login('student@universe.test');
    const me = await request(app).get('/api/auth/me').set('Cookie', cookie).expect(200);
    expect(me.body).toEqual({ user, csrfToken, mustChangePassword: false });
  });

  it('logout deletes the session; the old cookie then gets 401', async () => {
    const { app, cookie, csrfToken, user } = await login('student@universe.test');
    await request(app)
      .post('/api/auth/logout')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrfToken)
      .expect(204);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
    const res = await request(app).get('/api/auth/me').set('Cookie', cookie).expect(401);
    expect(errorOf(res.body).code).toBe('UNAUTHENTICATED');
  });

  it.each([
    ['expired', { expiresAt: new Date(Date.now() - 1000) }],
    ['idle', { lastSeenAt: new Date(Date.now() - 121 * 60_000) }],
  ])('an %s session gets 401 and is deleted', async (_label, data) => {
    const { app, cookie, user } = await login('invigilator@universe.test');
    await prisma.session.updateMany({ where: { userId: user.id }, data });
    await request(app).get('/api/auth/me').set('Cookie', cookie).expect(401);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });
});

describe('CSRF', () => {
  it('requires a matching X-CSRF-Token and an allowed Origin on unsafe requests', async () => {
    const { app, cookie, csrfToken } = await login('admin@universe.test');
    const logout = () => request(app).post('/api/auth/logout').set('Cookie', cookie);

    const missing = await logout();
    expect(missing.status).toBe(403);
    expect(errorOf(missing.body).code).toBe('CSRF_FAILED');
    await logout().set('X-CSRF-Token', 'wrong-token').expect(403);
    await logout()
      .set('X-CSRF-Token', `${csrfToken.slice(0, -1)}x`)
      .expect(403);
    await logout().set('X-CSRF-Token', csrfToken).set('Origin', 'https://evil.example').expect(403);

    await logout()
      .set('X-CSRF-Token', csrfToken)
      .set('Origin', 'http://localhost:5173')
      .expect(204);
  });

  it('rejects a login from a disallowed Origin', async () => {
    await request(createApp())
      .post('/api/auth/login')
      .set('Origin', 'https://evil.example')
      .send({ email: 'student@universe.test', password: PASSWORD })
      .expect(403);
  });
});
