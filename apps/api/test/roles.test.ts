import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { ApiErrorBody } from '@universe/contracts';
import { createApp } from '../src/app.js';
import { DEMO_ACCOUNTS, login, seed } from './helpers.js';

beforeAll(seed);

describe('role guard', () => {
  it('returns 401 without a session', async () => {
    await request(createApp()).get('/api/activity').expect(401);
  });

  it('forbids a student from sending announcements', async () => {
    const { app, cookie, csrfToken } = await login('student@universe.test');
    const res = await request(app)
      .post('/api/activity/announcements')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrfToken)
      .send({ message: 'Exams are cancelled' })
      .expect(403);
    expect(ApiErrorBody.parse(res.body).error.code).toBe('FORBIDDEN');
  });

  it('lets an admin send to every active user, or only to chosen roles', async () => {
    const { app, cookie, csrfToken } = await login('admin@universe.test');
    const send = (body: object) =>
      request(app)
        .post('/api/activity/announcements')
        .set('Cookie', cookie)
        .set('X-CSRF-Token', csrfToken)
        .send(body)
        .expect(200);
    expect((await send({ message: 'Hello everyone' })).body).toEqual({
      recipients: DEMO_ACCOUNTS.length,
    });
    expect((await send({ message: 'Hello students', roles: ['student'] })).body).toEqual({
      recipients: 2,
    });
    expect((await send({ message: 'Hello drivers', roles: ['driver'] })).body).toEqual({
      recipients: 9,
    });
    await request(app)
      .post('/api/activity/announcements')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrfToken)
      .send({ message: 'x', roles: ['superuser'] })
      .expect(400);
  });
});
