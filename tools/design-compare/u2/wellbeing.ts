import { wellbeing as W } from '../../../packages/contracts/src/index.ts';
import type { U2Module } from './index.ts';

/**
 * The prototype's Wellbeing data (CATS, WEEK_MIN, wbPaused: true, the drawer's records) in the
 * exact shapes of the wellbeing routes. The prototype's chart ends at 222 minutes while its
 * TODAY card sums to 212 (the API would make them equal); the fixture keeps both as drawn.
 */
const CATS: [W.Category, number, boolean][] = [
  ['study', 95, true],
  ['communication', 52, true],
  ['social', 38, true],
  ['entertainment', 27, true],
  ['other', 10, false],
];
const WEEK = [252, 301, 284, 236, 262, 249, 222];
const DATES = ['23', '24', '25', '26', '27', '28', '29'].map((d) => `2026-10-${d}`);
const PAUSED = '2026-10-29T20:00:00+05:30';

const records = DATES.toReversed().flatMap((date, di) =>
  CATS.filter(([, , on]) => on || di > 0).map(([category, min]) => ({
    date,
    category,
    minutes: Math.max(4, Math.round(min * ((WEEK[6 - di] ?? 0) / 222))),
  })),
);

const settings = W.Settings.parse({
  tracking: 'paused',
  pausedSince: PAUSED,
  categories: CATS.filter(([, , on]) => on).map(([c]) => c),
  retentionDays: 90,
  shareStudyWithHub: false,
  updatedAt: PAUSED,
});

const summary = W.Summary.parse({
  today: '2026-10-29',
  todayMinutes: CATS.reduce((a, [, min, on]) => a + (on ? min : 0), 0),
  categories: CATS.map(([category, minutes, counted]) => ({ category, minutes, counted })),
  series: DATES.map((date, i) => ({ date, minutes: WEEK[i] })),
  average: 264,
  percentVsAverage: 16,
  direction: 'under',
  recordCount: records.length,
  tracking: 'paused',
  pausedSince: PAUSED,
});

const page = W.RecordsPage.parse({ items: records, nextCursor: null, total: records.length });

const mod: U2Module = {
  screens: [
    {
      name: 'wellbeing',
      role: 'student',
      path: '/wellbeing',
      prototype: async (p) => {
        await p.locator('aside button', { hasText: 'Wellbeing' }).first().click();
      },
      ready: async (p) => {
        await p.getByText('TODAY · DAILY TOTALS').waitFor();
      },
      // The undrawn Focus session and Rules cards sit below the designed grid.
      masks: ['[data-undrawn]'],
    },
  ],
  respond: (_role, method, url) => {
    const path = url.pathname;
    if (!path.startsWith('/api/wellbeing/')) return undefined;
    const route = `${method} ${path.slice('/api/wellbeing'.length)}`;
    if (route === 'GET /summary') return { body: summary };
    if (route === 'GET /settings' || route === 'PUT /settings' || route === 'POST /tracking')
      return { body: settings };
    if (route === 'GET /records') return { body: page };
    if (route === 'PUT /totals') return { body: { stored: 0 } };
    if (route === 'DELETE /data') return { body: { deleted: records.length } };
    if (route === 'GET /export')
      return {
        body: W.ExportDocument.parse({
          schemaVersion: 1,
          generatedAt: '2026-10-29T22:14:00+05:30',
          recordCount: records.length,
          settings,
          records,
        }),
      };
    return undefined;
  },
};
export default mod;
