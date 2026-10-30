// Placement prep: tracked topics, progress events, weekly goal, readiness and the 30-day series.
import { hub, istDate, istDayStart, weekOf } from '@universe/contracts';
import type { Platform } from '../../platform/modules/index.js';
import { config } from './config.js';
import { ensureProfile, errors, iso, percent, type Db } from './shared.js';

type Track = hub.Track;
const TRACKS = hub.Track.options;
const DAY_MS = 86_400_000;

interface ProgressRow {
  track: string;
  solved: number;
  total: number;
}

/** Σ weight × (Σ solved ÷ Σ total of the track's tracked topics); an untracked track counts 0. */
export function readiness(rows: readonly ProgressRow[]): hub.Readiness {
  const sums = new Map<string, { solved: number; total: number }>();
  for (const r of rows) {
    const s = sums.get(r.track) ?? { solved: 0, total: 0 };
    s.solved += r.solved;
    s.total += r.total;
    sums.set(r.track, s);
  }
  const share = (t: Track) => {
    const s = sums.get(t);
    return s && s.total > 0 ? s.solved / s.total : 0;
  };
  const w = config.readinessWeights;
  const score = TRACKS.reduce((acc, t) => acc + w[t] * share(t), 0);
  const tracks = Object.fromEntries(TRACKS.map((t) => [t, Math.round(share(t) * 100)]));
  return {
    score: Math.round(score * 100),
    tracks: tracks as hub.Readiness['tracks'],
    weights: { ...w },
  };
}

export const dsaTotals = (rows: readonly ProgressRow[]) => {
  const dsa = rows.filter((r) => r.track === 'dsa');
  const solved = dsa.reduce((s, r) => s + r.solved, 0);
  const total = dsa.reduce((s, r) => s + r.total, 0);
  return { solved, total, percent: percent(solved, total) };
};

/** This week's goal from the changes since Sunday 00:00 IST. */
export function weekGoal(
  events: readonly { delta: number; createdAt: Date }[],
  target: number,
  now: Date,
): hub.WeekGoal {
  const week = weekOf(now);
  const sum = events
    .filter((e) => e.createdAt >= week.start && e.createdAt < week.end)
    .reduce((s, e) => s + e.delta, 0);
  const done = Math.max(0, sum);
  const elapsed = Math.min(1, Math.max(0, (now.getTime() - week.start.getTime()) / (7 * DAY_MS)));
  const expected = target * elapsed;
  return {
    target,
    done,
    left: Math.max(0, target - done),
    weekStart: week.startDate,
    weekEndsAt: iso(week.endsAt),
    expectedByNow: Math.round(expected * 10) / 10,
    status: done >= target || done >= expected ? 'on_track' : 'behind',
  };
}

/**
 * Cumulative solved over the tracked topics at the end of each of the last `days` IST days,
 * worked backwards from today's totals: a topic's changes count only from when it was tracked
 * (its row started at 0), so re-tracking a topic never makes an earlier day negative.
 */
export function series(
  tracked: readonly { topicId: string; solved: number; trackedSince: Date }[],
  events: readonly { topicId: string; delta: number; createdAt: Date }[],
  now: Date,
  days: number = config.seriesDays,
): { date: string; solved: number }[] {
  const firstDay = new Date(istDayStart(now).getTime() - (days - 1) * DAY_MS);
  const since = new Map(tracked.map((t) => [t.topicId, t.trackedSince]));
  const perDay = new Array<number>(days).fill(0);
  for (const e of events) {
    const from = since.get(e.topicId);
    if (!from || e.createdAt < from || e.createdAt < firstDay) continue;
    const i = Math.floor((e.createdAt.getTime() - firstDay.getTime()) / DAY_MS);
    if (i < days) perDay[i] = (perDay[i] ?? 0) + e.delta;
  }
  const out = new Array<{ date: string; solved: number }>(days);
  let value = tracked.reduce((s, t) => s + t.solved, 0);
  for (let i = days - 1; i >= 0; i -= 1) {
    out[i] = {
      date: istDate(new Date(firstDay.getTime() + i * DAY_MS)),
      solved: Math.max(0, value),
    };
    value -= perDay[i] ?? 0;
  }
  return out;
}

const trackIndex = (t: string) => TRACKS.indexOf(t as Track);

export function prepService(p: Platform) {
  const E = errors(p);

  /** The catalogue in display order (track, then sort). */
  async function catalogue(db: Db) {
    const topics = await db.hubTopic.findMany({ orderBy: [{ sort: 'asc' }] });
    return topics.sort((a, b) => trackIndex(a.track) - trackIndex(b.track) || a.sort - b.sort);
  }

  async function targetFor(db: Db, userId: string, now: Date) {
    const goal = await db.hubWeeklyGoal.findFirst({
      where: { userId, weekStart: { lte: new Date(`${weekOf(now).startDate}T00:00:00Z`) } },
      orderBy: { weekStart: 'desc' },
    });
    return goal?.target ?? config.defaultWeeklyTarget;
  }

  async function get(userId: string, now = new Date()): Promise<hub.PrepView> {
    const db = p.prisma;
    const firstDay = new Date(istDayStart(now).getTime() - (config.seriesDays - 1) * DAY_MS);
    const [topics, progress, events, target] = await Promise.all([
      catalogue(db),
      db.hubTopicProgress.findMany({ where: { userId } }),
      db.hubProgressEvent.findMany({
        where: { userId, createdAt: { gte: firstDay } },
        select: { topicId: true, delta: true, createdAt: true },
      }),
      targetFor(db, userId, now),
    ]);
    const byTopic = new Map(progress.map((r) => [r.topicId, r]));
    const rows = topics.flatMap((t) => {
      const r = byTopic.get(t.id);
      return r ? [{ t, r }] : [];
    });
    const tracks = TRACKS.flatMap((track) => {
      const mine = rows.filter(({ t }) => t.track === track);
      if (mine.length === 0) return [];
      const solved = mine.reduce((s, x) => s + x.r.solved, 0);
      const total = mine.reduce((s, x) => s + x.r.totalItems, 0);
      return [
        {
          track,
          solved,
          total,
          percent: percent(solved, total),
          topics: mine.map(({ t, r }) => ({
            topicId: t.id,
            track,
            name: t.name,
            tag: t.tag,
            solved: r.solved,
            total: r.totalItems,
            percent: percent(r.solved, r.totalItems),
          })),
        },
      ];
    });
    const flat = rows.map(({ t, r }) => ({
      track: t.track,
      solved: r.solved,
      total: r.totalItems,
    }));
    return {
      tracks,
      untracked: topics
        .filter((t) => !byTopic.has(t.id))
        .map((t) => ({
          topicId: t.id,
          track: t.track as Track,
          name: t.name,
          tag: t.tag,
          total: t.totalItems,
        })),
      dsa: dsaTotals(flat),
      readiness: readiness(flat),
      week: weekGoal(events, target, now),
      series: series(progress, events, now),
    };
  }

  /** Sets the tracked topics: new ones start at 0; removed ones lose their row, keep their events. */
  async function trackTopics(userId: string, body: unknown) {
    const ids = [...new Set(hub.TrackTopicsRequest.parse(body).topicIds)];
    await p.transaction(async (tx) => {
      await ensureProfile(tx, userId);
      const topics = await tx.hubTopic.findMany({ where: { id: { in: ids } } });
      if (topics.length !== ids.length) throw E.bad('Unknown topic id.');
      await tx.hubTopicProgress.deleteMany({ where: { userId, topicId: { notIn: ids } } });
      await tx.hubTopicProgress.createMany({
        data: topics.map((t) => ({ userId, topicId: t.id, totalItems: t.totalItems })),
        skipDuplicates: true,
      });
    });
    return get(userId);
  }

  /** +delta on one tracked topic: one row-locking conditional UPDATE plus its event. */
  async function increment(userId: string, params: unknown, body: unknown) {
    const { topicId } = hub.TopicParam.parse(params);
    const { delta } = hub.IncrementRequest.parse(body);
    await p.transaction(async (tx) => {
      const updated = await tx.$queryRaw<{ solved: number }[]>`
        UPDATE hub_topic_progress SET solved = solved + ${delta}, updated_at = now()
        WHERE user_id = ${userId}::uuid AND topic_id = ${topicId}
          AND solved + ${delta} BETWEEN 0 AND total_items
        RETURNING solved`;
      if (updated.length === 0) {
        const row = await tx.hubTopicProgress.findUnique({
          where: { userId_topicId: { userId, topicId } },
        });
        if (!row) throw E.fail(404, 'TOPIC_NOT_TRACKED', 'You are not tracking this topic.');
        throw E.conflict(
          'PROGRESS_OUT_OF_RANGE',
          `Solved must stay between 0 and ${row.totalItems} (now ${row.solved}).`,
        );
      }
      await tx.hubProgressEvent.create({ data: { userId, topicId, delta } });
    });
    const view = await get(userId);
    const topic = view.tracks.flatMap((t) => t.topics).find((t) => t.topicId === topicId);
    if (!topic) throw E.fail(404, 'TOPIC_NOT_TRACKED', 'You are not tracking this topic.');
    return { topic, dsa: view.dsa, week: view.week };
  }

  async function setGoal(userId: string, body: unknown) {
    const { target } = hub.GoalRequest.parse(body);
    const weekStart = new Date(`${weekOf().startDate}T00:00:00Z`);
    await p.transaction(async (tx) => {
      await ensureProfile(tx, userId);
      await tx.hubWeeklyGoal.upsert({
        where: { userId_weekStart: { userId, weekStart } },
        create: { userId, weekStart, target },
        update: { target },
      });
    });
    return (await get(userId)).week;
  }

  /** Progress rows of many users in one query, for readiness and DSA %. */
  async function progressOf(db: Db, userIds: readonly string[]) {
    const rows = await db.hubTopicProgress.findMany({
      where: { userId: { in: [...userIds] } },
      select: { userId: true, solved: true, totalItems: true, topic: { select: { track: true } } },
    });
    const out = new Map<string, ProgressRow[]>();
    for (const r of rows) {
      const list = out.get(r.userId) ?? [];
      list.push({ track: r.topic.track, solved: r.solved, total: r.totalItems });
      out.set(r.userId, list);
    }
    return (id: string) => out.get(id) ?? [];
  }

  /** What a mentor (or admin) sees of students: two queries for any number of them. */
  async function studentCards(db: Db, userIds: readonly string[]) {
    const ids = [...new Set(userIds)];
    const [users, progress] = await Promise.all([
      db.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, hubProfile: { select: { year: true, branch: true } } },
      }),
      progressOf(db, ids),
    ]);
    return new Map(
      users.map((u): [string, hub.StudentCard] => [
        u.id,
        {
          id: u.id,
          name: u.name,
          year: (u.hubProfile?.year ?? null) as hub.StudentCard['year'],
          branch: u.hubProfile?.branch ?? null,
          dsaPercent: dsaTotals(progress(u.id)).percent,
          readiness: readiness(progress(u.id)).score,
        },
      ]),
    );
  }

  return { catalogue, get, trackTopics, increment, setGoal, progressOf, studentCards, targetFor };
}
export type PrepService = ReturnType<typeof prepService>;
