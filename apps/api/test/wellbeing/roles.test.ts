import { beforeAll, describe, expect, it } from 'vitest';
import { CATEGORIES } from '@universe/wellbeing-core';
import { wellbeing } from '@universe/contracts';
import {
  account,
  daysAgo,
  setupWellbeing,
  tracking,
  user,
  type Session,
  type Wb,
} from './helpers.js';

let w: Wb;
beforeAll(async () => {
  w = await setupWellbeing();
});

// Every wellbeing route, from the module's own OpenAPI table (the table that builds the router).
const routes = (date = daysAgo(1)) =>
  Object.entries(w.modules.find((m) => m.id === 'wellbeing')?.openapi ?? {}).flatMap(
    ([path, ops]) =>
      Object.keys(ops as object).map((method) => ({
        method: method as 'get' | 'post' | 'put' | 'delete',
        url: `/api/wellbeing${path.replace('{date}', date).replace('{category}', 'study')}`,
      })),
  );
const call = (s: Session, r: { method: 'get' | 'post' | 'put' | 'delete'; url: string }) =>
  r.method === 'get' ? s.http.get(r.url) : s.http[r.method](r.url).send({});

describe('wellbeing access', () => {
  it('has ten routes and the same categories as the browser library', () => {
    expect(routes()).toHaveLength(10);
    expect(wellbeing.Category.options).toEqual([...CATEGORIES]);
  });

  it.each(['admin', 'driver', 'invigilator'] as const)(
    'gives a %s 403 on every wellbeing route',
    async (role) => {
      const s = role === 'admin' ? await account(w, 'admin@universe.test') : await user(w, role);
      for (const r of routes()) expect((await call(s, r)).status, `${r.method} ${r.url}`).toBe(403);
    },
  );

  it('keeps every record route to the owner: another student gets 404 and sees nothing', async () => {
    const owner = await tracking(w);
    await owner.http
      .put('/api/wellbeing/totals')
      .send({ rows: [{ date: daysAgo(1), category: 'study', minutes: 40 }] })
      .expect(200);
    const other = await account(w, 'student2@universe.test');
    await other.http.delete(`/api/wellbeing/records/${daysAgo(1)}/study`).expect(404);
    const records = await other.http.get('/api/wellbeing/records').expect(200);
    expect(records.body).toEqual({ items: [], nextCursor: null, total: 0 });
    const exported = await other.http.get('/api/wellbeing/export').expect(200);
    expect(wellbeing.ExportDocument.parse(exported.body).recordCount).toBe(0);
    await other.http
      .delete(`/api/wellbeing/records?from=${daysAgo(9)}&to=${daysAgo(0)}`)
      .expect(200, { deleted: 0 });
    await other.http
      .delete('/api/wellbeing/data')
      .send({ confirm: 'DELETE' })
      .expect(200, { deleted: 0 });
    // The owner's row is untouched.
    const mine = await owner.http.get('/api/wellbeing/records').expect(200);
    expect(wellbeing.RecordsPage.parse(mine.body).total).toBe(1);
  });

  it('sends Cache-Control: no-store on every response, errors included', async () => {
    const s = await account(w, 'mentor@universe.test');
    for (const r of routes()) expect((await call(s, r)).headers['cache-control']).toBe('no-store');
  });

  it('rejects unknown query fields and bodies on routes that take none', async () => {
    const s = await user(w);
    await s.http.get('/api/wellbeing/settings?x=1').expect(400);
    await s.http.get('/api/wellbeing/export?q=1').expect(400);
    await s.http
      .delete(`/api/wellbeing/records/${daysAgo(1)}/study`)
      .send({ x: 1 })
      .expect(400);
    await s.http.get('/api/wellbeing/summary?days=3').expect(400);
  });

  it('needs the CSRF header for changes', async () => {
    const s = await user(w);
    const { default: request } = await import('supertest');
    await request(s.app)
      .post('/api/wellbeing/tracking')
      .set('Cookie', s.cookie)
      .send({ state: 'on' })
      .expect(403);
  });
});
