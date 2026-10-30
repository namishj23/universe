import { describe, expect, it } from 'vitest';
import { addDays, DAY_MINUTES, dailyTotals, mergeOverlaps, type Slice } from '../src/index.js';

// P7-022 (d): the library never builds a batch `PUT /api/wellbeing/totals` refuses.
const MIN = 60_000;
const DAY = Date.UTC(2026, 9, 28, 18, 30); // 29 Oct 00:00 IST
const slice = (from: number, to: number, category: Slice['category'] = 'study'): Slice => ({
  from,
  to,
  domain: 'x',
  category,
  distracting: false,
});
const sum = (rows: { minutes: number }[]) => rows.reduce((a, r) => a + r.minutes, 0);

describe('overlapping slices', () => {
  it('count each minute once, to the earliest slice', () => {
    expect(mergeOverlaps([slice(10 * MIN, 30 * MIN, 'social'), slice(0, 20 * MIN)])).toEqual([
      slice(0, 20 * MIN),
      slice(20 * MIN, 30 * MIN, 'social'),
    ]);
  });

  it('cap a day at 1,440 minutes even when two whole-day sessions overlap', () => {
    const rows = dailyTotals([
      slice(DAY, DAY + 1440 * MIN, 'study'),
      slice(DAY, DAY + 1440 * MIN, 'social'),
      slice(DAY + 60 * MIN, DAY + 600 * MIN, 'entertainment'),
    ]);
    expect(rows.every((r) => r.date === '2026-10-29')).toBe(true);
    expect(sum(rows)).toBe(DAY_MINUTES);
    expect(rows.find((r) => r.category === 'study')?.minutes).toBe(DAY_MINUTES);
  });
});

describe('date bounds', () => {
  const slices = [
    slice(DAY - 2 * 1440 * MIN, DAY - 2 * 1440 * MIN + 30 * MIN), // 27 Oct
    slice(DAY, DAY + 30 * MIN), // 29 Oct
    slice(DAY + 1440 * MIN, DAY + 1470 * MIN), // 30 Oct
  ];

  it('drop dates older than the retention and after the last allowed date', () => {
    const rows = dailyTotals(slices, {
      minDate: addDays('2026-10-30', -2),
      maxDate: '2026-10-29',
    });
    expect([...new Set(rows.map((r) => r.date))]).toEqual(['2026-10-29']);
  });

  it('keep the boundary days themselves', () => {
    const rows = dailyTotals(slices, { minDate: '2026-10-27', maxDate: '2026-10-30' });
    expect([...new Set(rows.map((r) => r.date))]).toEqual([
      '2026-10-27',
      '2026-10-29',
      '2026-10-30',
    ]);
  });

  it('addDays crosses months', () => {
    expect(addDays('2026-11-01', -2)).toBe('2026-10-30');
  });
});
