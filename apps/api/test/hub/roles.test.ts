import { beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { account, setupHub, user, type Hub, type Session } from './helpers.js';

let h: Hub;
beforeAll(async () => {
  h = await setupHub();
});

// Every hub route, from the module's own OpenAPI table (the same table that builds the router).
const routes = () => {
  const hub = h.modules.find((m) => m.id === 'hub');
  return Object.entries(hub?.openapi ?? {}).flatMap(([path, ops]) =>
    Object.keys(ops as object).map((method) => ({
      method: method as 'get' | 'post' | 'put' | 'delete',
      url: `/api/hub${path.replace(/\{(\w+)\}/g, (_, name: string) => (name === 'topicId' ? 'dsa-dp' : randomUUID()))}`,
    })),
  );
};
const call = (s: Session, r: { method: 'get' | 'post' | 'put' | 'delete'; url: string }) =>
  r.method === 'get' ? s.http.get(r.url) : s.http[r.method](r.url).send({});

describe('hub roles', () => {
  it('has the expected number of routes', () => {
    expect(routes()).toHaveLength(26);
  });

  it.each(['driver', 'invigilator'] as const)('gives a %s 403 on every hub route', async (role) => {
    const s = await user(h, role);
    for (const r of routes()) expect((await call(s, r)).status, `${r.method} ${r.url}`).toBe(403);
  });

  it('refuses students and mentors on admin routes', async () => {
    const admin = routes().filter((r) => r.url.startsWith('/api/hub/admin/'));
    expect(admin).toHaveLength(2);
    for (const email of ['student@universe.test', 'mentor@universe.test']) {
      const s = await account(h, email);
      for (const r of admin) expect((await call(s, r)).status).toBe(403);
    }
  });

  it('refuses mentors and admins on student-only routes', async () => {
    const studentOnly = ['/api/hub/prep', '/api/hub/mentors', '/api/hub/requests/mine'];
    for (const email of ['mentor@universe.test', 'admin@universe.test']) {
      const s = await account(h, email);
      for (const url of studentOnly) expect((await s.http.get(url)).status, url).toBe(403);
    }
  });
});
