import type { Express } from 'express';
import { ApiErrorBody, istDate, type Role } from '@universe/contracts';
import { createApp } from '../../src/app.js';
import { hashPassword } from '../../src/platform/auth/password.js';
import { prisma } from '../../src/platform/db.js';
import { loadModules, type ModuleDefinition } from '../../src/platform/modules/index.js';
import { addDays } from '../../src/modules/wellbeing/service.js';
import { as, login, PASSWORD, seed } from '../helpers.js';

export interface Wb {
  app: Express;
  modules: ModuleDefinition[];
}

/** Platform seed plus the wellbeing seed (Aarav, paused, the design's week). */
export async function setupWellbeing(): Promise<Wb> {
  await seed();
  const modules = await loadModules();
  await modules.find((m) => m.id === 'wellbeing')?.seed?.();
  return { app: createApp({ modules }), modules };
}

// One app per session: the login limiter is per app instance.
async function signIn(wb: Wb, email: string) {
  const session = await login(email, createApp({ modules: wb.modules }));
  return { ...session, http: as(session) };
}
export type Session = Awaited<ReturnType<typeof signIn>>;

export const account = (wb: Wb, email: string) => signIn(wb, email);

let n = 0;
export async function user(wb: Wb, role: Role = 'student') {
  n += 1;
  const email = `wb${n}.${Date.now()}@universe.test`;
  await prisma.user.create({
    data: { email, name: `Wellbeing User ${n}`, role, passwordHash: await hashPassword(PASSWORD) },
  });
  return signIn(wb, email);
}

export const codeOf = (body: unknown) => ApiErrorBody.parse(body).error.code;
export const today = () => istDate(new Date());
export const daysAgo = (k: number) => addDays(today(), -k);
export { addDays };

/** A user with tracking on, ready to upload. */
export async function tracking(wb: Wb) {
  const s = await user(wb);
  await s.http.post('/api/wellbeing/tracking').send({ state: 'on' }).expect(200);
  return s;
}
