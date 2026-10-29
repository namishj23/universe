import type { Express } from 'express';
import { expect } from 'vitest';
import type { Role } from '@universe/contracts';
import { createApp } from '../../src/app.js';
import { hashPassword } from '../../src/platform/auth/password.js';
import { prisma } from '../../src/platform/db.js';
import { loadModules, type ModuleDefinition } from '../../src/platform/modules/index.js';
import { as, login, PASSWORD, seed } from '../helpers.js';

export interface Rides {
  app: Express;
  modules: ModuleDefinition[];
}

/** Platform + rides seed, without the seed's demo rides (each test builds its own). */
export async function setupRides(): Promise<Rides> {
  await seed();
  const modules = await loadModules();
  await modules.find((m) => m.id === 'rides')?.seed?.();
  await prisma.ridesGroup.deleteMany();
  await prisma.ridesRequest.deleteMany();
  return { app: createApp({ modules }), modules };
}

let n = 0;
/** A fresh signed-in user (students by default) with a request builder. */
export async function user(rides: Rides, role: Role = 'student', name?: string) {
  n += 1;
  const email = `rider${n}.${Date.now()}@universe.test`;
  await prisma.user.create({
    data: {
      email,
      name: name ?? `Rider ${n} Test`,
      role,
      passwordHash: await hashPassword(PASSWORD),
    },
  });
  return signIn(rides, email);
}

// One app per session: the login limiter (10 per minute per IP) is per app instance, and
// every instance shares the same database, modules and SSE broker.
async function signIn(rides: Rides, email: string) {
  const session = await login(email, createApp({ modules: rides.modules }));
  return { ...session, http: as(session) };
}

/** A seeded account (demo user or driver) signed in. */
export const account = (rides: Rides, email: string) => signIn(rides, email);

export type Session = Awaited<ReturnType<typeof user>>;

const minutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

/** Creates a request (free text, like Module B's check scripts) and returns its body. */
export async function request(s: Session, pickupText: string, dropText: string, inMinutes: number) {
  const res = await s.http
    .post('/api/rides/requests')
    .send({ pickupText, dropText, pickupTime: minutes(inMinutes) });
  if (res.status !== 201)
    throw new Error(`request failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { id: string; soloFarePaise: number; distanceM: number };
}

export interface Detail {
  id: string;
  status: string;
  totalFarePaise: number;
  members: { userId: string; fareSharePaise: number; isYou: boolean }[];
  memberRideRequestIds: string[];
}

/** Starts a group of one. */
export async function startGroup(s: Session, pickup: string, drop: string, inMinutes: number) {
  const req = await request(s, pickup, drop, inMinutes);
  const res = await s.http
    .post('/api/rides/groups/join')
    .send({ rideRequestId: req.id, memberRideRequestIds: [req.id] });
  if (res.status !== 201)
    throw new Error(`start failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as Detail;
}

/** Joins `group` with a fresh request on the given drop. */
export async function joinGroup(
  s: Session,
  group: Detail,
  pickup: string,
  drop: string,
  inMinutes: number,
) {
  const req = await request(s, pickup, drop, inMinutes);
  return s.http
    .post('/api/rides/groups/join')
    .send({ rideRequestId: req.id, memberRideRequestIds: [...group.memberRideRequestIds, req.id] });
}

/** Awaits a response and checks its status, showing the body when it differs. */
export async function status<T extends { status: number; body: unknown }>(
  res: Promise<T> | T,
  code: number,
) {
  const r = await res;
  expect(r.status, JSON.stringify(r.body)).toBe(code);
  return r;
}

/** The first element, or a failed test. */
export function first<T>(items: readonly T[]): T {
  const [x] = items;
  if (x === undefined) throw new Error('expected at least one item');
  return x;
}

/** n fresh students, signed in. */
export const users = (rides: Rides, count: number) =>
  Promise.all(Array.from({ length: count }, () => user(rides)));

export const driverEmail = (name: string) =>
  `${name.toLowerCase().replace(/\s+/g, '.')}@drivers.universe.test`;

export { prisma };
