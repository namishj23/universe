import type { Express } from 'express';
import { expect } from 'vitest';
import { ApiErrorBody, type Role } from '@universe/contracts';
import { createApp } from '../../src/app.js';
import { hashPassword } from '../../src/platform/auth/password.js';
import { prisma } from '../../src/platform/db.js';
import { loadModules, type ModuleDefinition } from '../../src/platform/modules/index.js';
import { as, login, PASSWORD, seed } from '../helpers.js';

export interface Hub {
  app: Express;
  modules: ModuleDefinition[];
}

/** Platform seed plus the hub seed (the design's demo data). */
export async function setupHub(): Promise<Hub> {
  await seed();
  const modules = await loadModules();
  await modules.find((m) => m.id === 'hub')?.seed?.();
  return { app: createApp({ modules }), modules };
}

// One app per session: the login limiter (10 per minute per IP) is per app instance.
async function signIn(hub: Hub, email: string) {
  const session = await login(email, createApp({ modules: hub.modules }));
  return { ...session, http: as(session) };
}
export type Session = Awaited<ReturnType<typeof signIn>>;

/** A seeded account signed in. */
export const account = (hub: Hub, email: string) => signIn(hub, email);

let n = 0;
/** A fresh signed-in user (student by default). */
export async function user(hub: Hub, role: Role = 'student', name?: string) {
  n += 1;
  const email = `hub${n}.${Date.now()}@universe.test`;
  await prisma.user.create({
    data: {
      email,
      name: name ?? `Hub User ${n}`,
      role,
      passwordHash: await hashPassword(PASSWORD),
    },
  });
  return signIn(hub, email);
}

export const codeOf = (body: unknown) => ApiErrorBody.parse(body).error.code;

export function expectError(res: { status: number; body: unknown }, status: number, code?: string) {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  if (code) expect(codeOf(res.body)).toBe(code);
}

export const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000);

/** Creates an open slot for `mentor` through the API. */
export async function slot(mentor: Session, startsInHours: number, minutes = 60) {
  const startsAt = hoursFromNow(startsInHours);
  const res = await mentor.http.post('/api/hub/slots').send({
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + minutes * 60_000).toISOString(),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string; startsAt: string };
}

/** Query events are emitted only when NODE_ENV=test (src/platform/db.ts). */
export async function countQueries(fn: () => Promise<unknown>) {
  let count = 0;
  const client = prisma as unknown as { $on(event: 'query', cb: () => void): void };
  client.$on('query', () => {
    count += 1;
  });
  await fn();
  return count;
}
