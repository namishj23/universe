import { beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/platform/db.js';
import { account, daysAgo, setupWellbeing, user, type Wb } from './helpers.js';

// Every log line the API writes during this file, at the most verbose level (vi.mock is
// hoisted above the imports, so the app and the platform use this logger).
const { lines } = vi.hoisted(() => ({ lines: [] as string[] }));
vi.mock('../../src/platform/logger.js', async () => {
  const { pino } = await import('pino');
  return { logger: pino({ level: 'trace' }, { write: (line: string) => void lines.push(line) }) };
});

let w: Wb;
beforeAll(async () => {
  w = await setupWellbeing();
});

describe('wellbeing privacy in logs and the audit log', () => {
  it('logs only route patterns: no values, dates, categories, domains or query strings', async () => {
    const s = await user(w);
    const aarav = await account(w, 'student@universe.test');
    const auditBefore = await prisma.auditLog.count();
    lines.length = 0;

    const day = daysAgo(4);
    await s.http.post('/api/wellbeing/tracking').send({ state: 'on' }).expect(200);
    await s.http
      .put('/api/wellbeing/settings')
      .send({ retentionDays: 123, shareStudyWithHub: true })
      .expect(200);
    await s.http
      .put('/api/wellbeing/totals')
      .send({
        rows: [
          { date: day, category: 'entertainment', minutes: 987 },
          { date: day, category: 'social', minutes: 321 },
        ],
      })
      .expect(200);
    await s.http
      .put('/api/wellbeing/totals')
      .send({
        rows: [
          {
            date: day,
            category: 'social',
            minutes: 5,
            domain: 'youtube.com',
            url: 'https://youtube.com/watch?v=secret',
          },
        ],
      })
      .expect(400);
    await s.http
      .put('/api/wellbeing/totals')
      .send({ rows: [{ date: day, category: 'other', minutes: 654 }] })
      .expect(422);
    await s.http.get('/api/wellbeing/summary?days=9').expect(200);
    await s.http.get('/api/wellbeing/records?limit=1').expect(200);
    await s.http.get('/api/wellbeing/export').expect(200);
    await s.http.delete(`/api/wellbeing/records/${day}/entertainment`).expect(204);
    await s.http.delete(`/api/wellbeing/records/${day}/entertainment`).expect(404);
    await s.http.delete(`/api/wellbeing/records?from=${day}&to=${daysAgo(1)}`).expect(200);
    await s.http.delete('/api/wellbeing/data').send({ confirm: 'DELETE' }).expect(200);
    await aarav.http.get('/api/wellbeing/summary').expect(200);
    await aarav.http.get('/api/dashboard').expect(200);
    await s.http.get('/API/Wellbeing/summary?days=8').expect(200); // Express ignores case

    const log = lines.join('');
    expect(log).toContain('"route":"/api/wellbeing/records/:date/:category"');
    expect(log).toContain('"route":"/api/wellbeing/totals"');
    // Values as numbers (not digits inside ids or timestamps), and every word that gives data away.
    const values = log.replace(/"(responseTime|time|pid)":\d+/g, '');
    for (const value of [987, 321, 654, 123])
      expect(values, String(value)).not.toMatch(new RegExp(`(^|[^0-9a-f-])${value}([^0-9a-f-]|$)`));
    for (const secret of [
      day,
      'youtube',
      'secret',
      'days=',
      'from=',
      'limit=',
      'entertainment',
      'social',
      'retention',
      'wellbeing-export',
      '"minutes"',
      '/API/Wellbeing',
    ])
      expect(log, secret).not.toContain(secret);
    // Wellbeing request lines carry no headers or params.
    const wellbeingLines = lines.filter((l) => l.includes('"route":"/api/wellbeing'));
    expect(wellbeingLines.length).toBeGreaterThan(10);
    for (const l of wellbeingLines) {
      const entry = JSON.parse(l) as {
        req?: Record<string, unknown>;
        res?: Record<string, unknown>;
      };
      if (entry.req) expect(Object.keys(entry.req).sort()).toEqual(['id', 'method']);
      if (entry.res) expect(Object.keys(entry.res)).toEqual(['statusCode']);
    }

    expect(await prisma.auditLog.count()).toBe(auditBefore);
    expect(await prisma.auditLog.count({ where: { action: { startsWith: 'wellbeing' } } })).toBe(0);
  });

  it('still logs other routes in full (the change is scoped to wellbeing)', async () => {
    const s = await user(w);
    lines.length = 0;
    await s.http.get('/api/activity?limit=5').expect(200);
    expect(lines.join('')).toContain('/api/activity?limit=5');
  });
});
