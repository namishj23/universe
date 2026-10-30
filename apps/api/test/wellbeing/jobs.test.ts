import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { WEEKLY_SUMMARY_TEXT } from '@universe/contracts';
import { prisma } from '../../src/platform/db.js';
import { platform } from '../../src/platform/modules/platform.js';
import { schedule, startScheduledJobs, stopScheduledJobs } from '../../src/platform/scheduler.js';
import { runOnce } from '../../src/modules/wellbeing/jobs.js';
import { wellbeingService } from '../../src/modules/wellbeing/service.js';
import { addDays, setupWellbeing, user, type Wb } from './helpers.js';

let w: Wb;
beforeAll(async () => {
  w = await setupWellbeing();
});

// Sunday 1 Nov 2026 in Asia/Kolkata; the week that just ended is Sun 25 – Sat 31 Oct.
const SUNDAY = '2026-11-01';
const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+05:30`);

async function withSettings(
  tracking: 'on' | 'paused' | 'off',
  dates: string[],
  retentionDays = 90,
) {
  const s = await user(w);
  await prisma.wbSettings.create({
    data: {
      userId: s.user.id,
      tracking,
      pausedSince: tracking === 'paused' ? new Date() : null,
      retentionDays,
    },
  });
  for (const date of dates)
    await prisma.wbDailyTotal.create({
      data: {
        userId: s.user.id,
        date: new Date(`${date}T00:00:00Z`),
        category: 'study',
        minutes: 30,
      },
    });
  return s.user.id;
}
const summaries = (userId: string) =>
  prisma.activityEvent.findMany({
    where: { recipientId: userId, type: 'wellbeing.weekly_summary' },
  });

describe('retention', () => {
  it("removes only rows older than each user's own window", async () => {
    const now = at('2026-10-30', '12:00');
    const short = await withSettings('on', ['2026-10-22', '2026-10-23', '2026-10-24'], 7);
    const long = await withSettings('off', ['2026-10-22', '2026-08-01', '2026-07-31'], 90);
    await runOnce(platform(), now);
    const left = async (userId: string) =>
      (await prisma.wbDailyTotal.findMany({ where: { userId }, orderBy: { date: 'asc' } })).map(
        (r) => r.date.toISOString().slice(0, 10),
      );
    // today − 7 = 23 Oct is kept; 22 Oct is older than 7 days. 90 days back is 1 Aug.
    expect(await left(short)).toEqual(['2026-10-23', '2026-10-24']);
    expect(await left(long)).toEqual(['2026-08-01', '2026-10-22']);
  });
});

describe('weekly summary', () => {
  it('waits for Sunday 09:00, then sends once per user per week to on and paused users only', async () => {
    const on = await withSettings('on', ['2026-10-28']);
    const paused = await withSettings('paused', ['2026-10-25', '2026-10-31']);
    const off = await withSettings('off', ['2026-10-28']);
    const noData = await withSettings('on', ['2026-10-24', SUNDAY]);

    expect((await runOnce(platform(), at(SUNDAY, '08:59'))).sent).toBe(0);
    // (The seeded Aarav may get one too, depending on today's date.)
    expect((await runOnce(platform(), at(SUNDAY, '09:00'))).sent).toBeGreaterThanOrEqual(2);
    await runOnce(platform(), at(SUNDAY, '10:00'));
    await runOnce(platform(), at(addDays(SUNDAY, 3), '10:00'));

    for (const id of [on, paused]) {
      const events = await summaries(id);
      expect(events).toHaveLength(1);
      expect(events[0]?.payload).toEqual({ message: WEEKLY_SUMMARY_TEXT });
      expect(JSON.stringify(events[0]?.payload)).not.toMatch(/\d/);
    }
    expect(await summaries(off)).toHaveLength(0);
    expect(await summaries(noData)).toHaveLength(0);
    expect(
      await prisma.wbWeeklySummary.findMany({ where: { userId: on }, select: { weekStart: true } }),
    ).toEqual([{ weekStart: new Date('2026-10-25T00:00:00Z') }]);

    // The next week is its own summary.
    await prisma.wbDailyTotal.create({
      data: { userId: on, date: new Date('2026-11-03T00:00:00Z'), category: 'social', minutes: 5 },
    });
    await runOnce(platform(), at('2026-11-08', '09:30'));
    expect(await summaries(on)).toHaveLength(2);
  });
});

describe('platform.schedule', () => {
  afterEach(() => {
    stopScheduledJobs();
    vi.useRealTimers();
  });

  it('runs a job at start and on its interval, and stops at shutdown', async () => {
    vi.useFakeTimers();
    const fn = vi.fn((_now: Date) => Promise.resolve());
    schedule('test.tick', 1_000, fn);
    expect(fn).not.toHaveBeenCalled(); // registering never starts a timer
    const stop = startScheduledJobs();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0]?.[0]).toBeInstanceOf(Date);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fn).toHaveBeenCalledTimes(3);
    stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('skips a tick while the previous run is still going, and survives a failing job', async () => {
    vi.useFakeTimers();
    let release = () => {};
    const slow = vi.fn(() => new Promise<void>((r) => (release = r)));
    const failing = vi.fn(() => Promise.reject(new Error('boom')));
    schedule('test.slow', 1_000, slow);
    schedule('test.failing', 1_000, failing);
    startScheduledJobs();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(slow).toHaveBeenCalledTimes(1);
    expect(failing).toHaveBeenCalledTimes(4);
    release();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(slow).toHaveBeenCalledTimes(2);
  });

  it('registers the wellbeing job and rejects bad names', () => {
    expect(() => schedule('NoModule', 1_000, () => Promise.resolve())).toThrow();
    expect(() => schedule('test.fast', 10, () => Promise.resolve())).toThrow();
  });
});

describe('studyMinutesThisWeek (for the Student Hub)', () => {
  it('returns a number only to the user themselves and only when sharing is on', async () => {
    const service = wellbeingService(platform());
    const now = at('2026-10-30', '12:00'); // week Sun 25 – Sat 31 Oct
    const id = await withSettings('on', ['2026-10-25', '2026-10-29', '2026-10-24']);
    const other = (await user(w)).user.id;
    expect(await service.studyMinutesThisWeek({ actorId: id, userId: id }, now)).toBeNull();
    await prisma.wbSettings.update({ where: { userId: id }, data: { shareStudyWithHub: true } });
    expect(await service.studyMinutesThisWeek({ actorId: id, userId: id }, now)).toBe(60);
    expect(await service.studyMinutesThisWeek({ actorId: other, userId: id }, now)).toBeNull();
    expect(await service.studyMinutesThisWeek({ actorId: other, userId: other }, now)).toBeNull();
    await prisma.wbSettings.update({ where: { userId: id }, data: { categories: ['social'] } });
    expect(await service.studyMinutesThisWeek({ actorId: id, userId: id }, now)).toBeNull();
  });
});
