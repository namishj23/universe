import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Router } from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { ApiErrorBody, ModuleInfo } from '@universe/contracts';
import { z } from 'zod';
import { createApp } from '../src/app.js';
import {
  loadModules,
  validateModules,
  type ModuleDefinition,
} from '../src/platform/modules/index.js';
import { fixtureModules } from './fixtures.js';
import { login, seed } from './helpers.js';

let modules: ModuleDefinition[];
beforeAll(async () => {
  await seed();
  modules = [...(await loadModules()), ...fixtureModules()];
});

const valid = (id: string) => ({
  id,
  label: 'Label',
  order: 1,
  roles: ['admin'],
  router: Router(),
});

describe('discovery', () => {
  it('finds the hub and wellbeing folders and nothing else', async () => {
    expect((await loadModules()).map((m) => m.id)).toEqual(['hub', 'wellbeing']);
  });

  it('loads a CommonJS module folder (how rides will be added in P3)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'universe-modules-'));
    mkdirSync(join(dir, 'rides'));
    writeFileSync(join(dir, 'rides', 'package.json'), '{"type":"commonjs"}');
    writeFileSync(
      join(dir, 'rides', 'index.js'),
      `const router = Object.assign(function router() {}, { use() {} });
       module.exports = { id: 'rides', label: 'Rides', order: 20, roles: ['student'], router };`,
    );
    const loaded = await loadModules(pathToFileURL(`${dir}/`));
    expect(loaded.map((m) => m.id)).toEqual(['rides']);
  });

  it('fails at startup with a clear message for an invalid definition', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'universe-modules-'));
    mkdirSync(join(dir, 'exam'));
    writeFileSync(
      join(dir, 'exam', 'index.js'),
      `export default { id: 'exam', label: '', order: 1.5, roles: [], router: {} };`,
    );
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    await expect(loadModules(pathToFileURL(`${dir}/`))).rejects.toThrow(
      /Invalid module definitions:[\s\S]*exam: label[\s\S]*exam: order[\s\S]*exam: roles[\s\S]*exam: router/,
    );
  });
});

describe('validation', () => {
  it('rejects two modules with the same id (and so the same base path)', () => {
    expect(() =>
      validateModules([
        { folder: 'exam', value: valid('exam') },
        { folder: 'exam-copy', value: valid('exam') },
      ]),
    ).toThrow(/id "exam" \(base path \/api\/exam\) is already used by exam/);
  });

  it('rejects an id that does not match its folder, unknown ids and unknown fields', () => {
    expect(() => validateModules([{ folder: 'hub', value: valid('rides') }])).toThrow(
      /hub: id "rides" must match its folder name/,
    );
    expect(() => validateModules([{ folder: 'chess', value: valid('chess') }])).toThrow(
      /chess: id/,
    );
    expect(() =>
      validateModules([{ folder: 'hub', value: { ...valid('hub'), rolez: ['admin'] } }]),
    ).toThrow(/Unrecognized key/);
  });

  it('rejects a file purpose outside the module namespace', () => {
    const purpose = {
      id: 'exam.clip',
      mimeTypes: ['video/mp4'],
      maxBytes: 1,
      authorizeRead: () => true,
    };
    expect(() =>
      validateModules([{ folder: 'hub', value: { ...valid('hub'), filePurposes: [purpose] } }]),
    ).toThrow(/file purpose exam.clip must start with "hub."/);
  });
});

describe('mounting', () => {
  it('mounts a module at /api/<id> behind sign-in and its role list', async () => {
    const app = createApp({ modules });
    await request(app).get('/api/observatory/ping').expect(401);

    const admin = await login('admin@universe.test', app);
    await request(app)
      .get('/api/observatory/ping')
      .set('Cookie', admin.cookie)
      .expect(200, { ok: true });

    const student = await login('student@universe.test', app);
    const res = await request(app)
      .get('/api/observatory/ping')
      .set('Cookie', student.cookie)
      .expect(403);
    expect(ApiErrorBody.parse(res.body).error.code).toBe('FORBIDDEN');
    // Admins cannot reach wellbeing (personal data), even though its router is empty.
    await request(app).get('/api/wellbeing/anything').set('Cookie', admin.cookie).expect(403);
  });

  it.each([
    ['student@universe.test', ['hub', 'rides', 'wellbeing']],
    ['mentor@universe.test', ['hub', 'rides', 'wellbeing']],
    ['invigilator@universe.test', ['exam']],
    ['admin@universe.test', ['hub', 'rides', 'observatory', 'exam']],
  ])('GET /api/modules for %s matches the agreed table', async (email, ids) => {
    const app = createApp({ modules });
    const { cookie } = await login(email, app);
    const res = await request(app).get('/api/modules').set('Cookie', cookie).expect(200);
    const list = z.array(ModuleInfo).parse(res.body);
    expect(list.map((m) => m.id)).toEqual(ids);
    for (const m of list) expect(m.basePath).toBe(`/api/${m.id}`);
    const hub = list.find((m) => m.id === 'hub');
    if (hub) expect(hub).toMatchObject({ label: 'Student Hub', order: 10 });
  });
});
