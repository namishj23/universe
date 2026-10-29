import request from 'supertest';
import { expect, it } from 'vitest';
import { createApp } from '../src/app.js';

it('live is 200', async () => {
  await request(createApp()).get('/api/health/live').expect(200, { status: 'ok' });
});

it('ready is 200 with the database up', async () => {
  await request(createApp()).get('/api/health/ready').expect(200, { status: 'ok' });
});

it('echoes a valid X-Request-Id and replaces an invalid one', async () => {
  const app = createApp();
  const id = '6f1c1d3e-8a7b-4c2d-9e0f-1a2b3c4d5e6f';
  const kept = await request(app).get('/api/health/live').set('X-Request-Id', id);
  expect(kept.get('X-Request-Id')).toBe(id);
  const replaced = await request(app).get('/api/health/live').set('X-Request-Id', 'not-a-uuid');
  expect(replaced.get('X-Request-Id')).toMatch(/^[0-9a-f-]{36}$/);
  expect(replaced.get('X-Powered-By')).toBeUndefined();
});
