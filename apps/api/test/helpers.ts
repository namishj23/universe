import request from 'supertest';
import type { Express } from 'express';
import { SessionResponse } from '@universe/contracts';
import { createApp } from '../src/app.js';
import { prisma } from '../src/platform/db.js';
import { DEMO_ACCOUNTS, seedPlatform } from '../../../prisma/seed/platform.js';

export const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? '';
export { DEMO_ACCOUNTS };

export const seed = () => seedPlatform(prisma, PASSWORD);

export const userId = async (email: string) =>
  (await prisma.user.findUniqueOrThrow({ where: { email } })).id;

/** Signs in and returns the session cookie ("uv_session=...") and CSRF token. */
export async function login(email: string, app: Express = createApp()) {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  const cookie = res.get('Set-Cookie')?.[0]?.split(';')[0] ?? '';
  const { csrfToken, user } = SessionResponse.parse(res.body);
  return { app, cookie, csrfToken, user };
}
