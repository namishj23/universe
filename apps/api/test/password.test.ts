import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { ApiErrorBody } from '@universe/contracts';
import { createApp } from '../src/app.js';
import { prisma } from '../src/platform/db.js';
import { as, login, PASSWORD, seed } from './helpers.js';

const codeOf = (body: unknown) => ApiErrorBody.parse(body).error.code;
beforeAll(seed);

describe('POST /api/auth/change-password', () => {
  it('rejects a wrong current password', async () => {
    const s = await login('student2@universe.test');
    const res = await as(s)
      .post('/api/auth/change-password')
      .send({ currentPassword: 'not-my-password', newPassword: 'a long enough passphrase' })
      .expect(400);
    expect(codeOf(res.body)).toBe('INVALID_CURRENT_PASSWORD');
  });

  it.each([
    ['too short', 'short-pass1', 'VALIDATION_FAILED'],
    ['too long', 'x'.repeat(257), 'VALIDATION_FAILED'],
    ['the same as the current one', PASSWORD, 'WEAK_PASSWORD'],
    ["containing the email's local part", 'my-Student2-passphrase', 'WEAK_PASSWORD'],
  ])('rejects a new password %s', async (_label, newPassword, code) => {
    const s = await login('student2@universe.test');
    const res = await as(s)
      .post('/api/auth/change-password')
      .send({ currentPassword: PASSWORD, newPassword })
      .expect(400);
    expect(codeOf(res.body)).toBe(code);
  });

  it('rejects unknown fields and requires the CSRF token', async () => {
    const s = await login('student2@universe.test');
    await as(s)
      .post('/api/auth/change-password')
      .send({ currentPassword: PASSWORD, newPassword: 'a long enough passphrase', extra: 1 })
      .expect(400);
    await request(s.app)
      .post('/api/auth/change-password')
      .set('Cookie', s.cookie)
      .send({ currentPassword: PASSWORD, newPassword: 'a long enough passphrase' })
      .expect(403);
  });

  it('changes the password, keeps this session and signs out every other one', async () => {
    const current = await login('student2@universe.test');
    const other = await login('student2@universe.test', createApp());
    const newPassword = 'correct horse battery staple';

    await as(current)
      .post('/api/auth/change-password')
      .send({ currentPassword: PASSWORD, newPassword })
      .expect(204);

    await as(current).get('/api/auth/me').expect(200);
    await as(other).get('/api/auth/me').expect(401);
    expect(await prisma.session.count({ where: { userId: current.user.id } })).toBe(1);

    const app = createApp();
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'student2@universe.test', password: PASSWORD })
      .expect(401);
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'student2@universe.test', password: newPassword })
      .expect(200);
    await seed(); // restore the seed password
  });
});
