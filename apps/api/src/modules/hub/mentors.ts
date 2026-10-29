// Mentor discovery: one query loads every candidate with slot counts, loads, next slots and the
// caller's live request; ranking.ts scores them in memory.
import { hub } from '@universe/contracts';
import type { Platform } from '../../platform/modules/index.js';
import { config } from './config.js';
import type { PrepService } from './prep.js';
import {
  makeNormaliser,
  rankMentors,
  reasonFor,
  round4,
  weakestTopics,
  type Components,
  type MentorCandidate,
  type TrackedTopic,
  type WeakTopic,
} from './ranking.js';
import { errors, iso, type Db, type User } from './shared.js';

interface CandidateRow {
  id: string;
  name: string;
  department: string | null;
  expertise: string[];
  interests: string[];
  capacity: number;
  mentees: number;
  open_slots: number;
  next_slots: {
    id: string;
    starts_at: string;
    ends_at: string;
    location_label: string | null;
    location_stop_id: string | null;
  }[];
  recent_requests: number;
  my_request_id: string | null;
  my_request_status: string | null;
  my_starts_at: Date | null;
  my_ends_at: Date | null;
}

export type Candidate = MentorCandidate & { row: CandidateRow };

const DAY_MS = 86_400_000;

/** Page a ranked, in-memory list: the cursor is the offset (lists are bounded by mentor count). */
const offsetOf = (cursor: string | undefined) => {
  if (!cursor) return 0;
  const n = Number(Buffer.from(cursor, 'base64url').toString());
  return Number.isInteger(n) && n >= 0 ? n : 0;
};
const pageAt = <T>(items: T[], cursor: string | undefined, limit: number) => {
  const start = offsetOf(cursor);
  const end = start + limit;
  return {
    items: items.slice(start, end),
    nextCursor: end < items.length ? Buffer.from(String(end)).toString('base64url') : null,
  };
};

const round = (c: Components) => ({
  match: round4(c.match),
  weakTopicCoverage: round4(c.weakTopicCoverage),
  interestOverlap: round4(c.interestOverlap),
  availability: round4(c.availability),
  load: round4(c.load),
});

const weakView = (w: WeakTopic[]) => w.map((t) => ({ ...t, weakness: round4(t.weakness) }));

export function mentorService(p: Platform, prep: PrepService) {
  const E = errors(p);

  /**
   * Active mentors (role mentor, or a student peer mentor with expertise). `callerId` excludes
   * the caller and joins their live request; `onlyId` loads one mentor. One SQL statement.
   */
  async function candidates(
    db: Db,
    opts: { callerId?: string | null; onlyId?: string | null; slotLimit?: number },
    now = new Date(),
  ): Promise<Candidate[]> {
    const callerId = opts.callerId ?? null;
    const onlyId = opts.onlyId ?? null;
    const windowEnd = new Date(now.getTime() + config.ranking.windowDays * DAY_MS);
    const since = new Date(now.getTime() - 30 * DAY_MS);
    const slotLimit = opts.slotLimit ?? config.ranking.nextSlots;
    const rows = await db.$queryRaw<CandidateRow[]>`
      SELECT u.id, u.name,
        p.mentor_department AS department,
        coalesce(p.mentor_expertise, '{}') AS expertise,
        coalesce(p.interests, '{}') AS interests,
        coalesce(p.mentor_capacity, 3)::int AS capacity,
        (SELECT count(DISTINCT r.student_id)::int FROM hub_mentorship_requests r
          WHERE r.mentor_id = u.id AND r.status = 'accepted') AS mentees,
        (SELECT count(*)::int FROM hub_mentor_slots s
          WHERE s.mentor_id = u.id AND s.status = 'open'
            AND s.starts_at >= ${now} AND s.starts_at < ${windowEnd}) AS open_slots,
        (SELECT coalesce(json_agg(x ORDER BY x.starts_at), '[]'::json) FROM (
           SELECT s.id, s.starts_at, s.ends_at, s.location_label, s.location_stop_id
           FROM hub_mentor_slots s
           WHERE s.mentor_id = u.id AND s.status = 'open'
             AND s.starts_at >= ${now} AND s.starts_at < ${windowEnd}
           ORDER BY s.starts_at LIMIT ${slotLimit}) x) AS next_slots,
        (SELECT count(*)::int FROM hub_mentorship_requests r
          WHERE r.mentor_id = u.id AND r.created_at >= ${since}) AS recent_requests,
        mine.id AS my_request_id, mine.status AS my_request_status,
        ms.starts_at AS my_starts_at, ms.ends_at AS my_ends_at
      FROM users u
      LEFT JOIN hub_profiles p ON p.user_id = u.id
      LEFT JOIN hub_mentorship_requests mine
        ON mine.mentor_id = u.id AND mine.student_id = ${callerId}::uuid
       AND mine.status IN ('pending', 'accepted')
      LEFT JOIN hub_mentor_slots ms ON ms.id = mine.slot_id
      WHERE u.is_active
        AND (u.role = 'mentor'
             OR (u.role = 'student' AND p.is_peer_mentor AND cardinality(p.mentor_expertise) > 0))
        AND (${callerId}::uuid IS NULL OR u.id <> ${callerId}::uuid)
        AND (${onlyId}::uuid IS NULL OR u.id = ${onlyId}::uuid)`;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      expertise: row.expertise,
      interests: row.interests,
      capacity: row.capacity,
      mentees: row.mentees,
      openSlots: row.open_slots,
      row,
    }));
  }

  const slotsOf = (c: Candidate) =>
    c.row.next_slots.map((s) => ({
      id: s.id,
      startsAt: iso(new Date(s.starts_at)),
      endsAt: iso(new Date(s.ends_at)),
      locationLabel: s.location_label,
      locationStopId: s.location_stop_id,
      status: 'open' as const,
    }));

  const myRequest = (c: Candidate): hub.MyRequest => {
    const r = c.row;
    if (r.my_request_status === 'accepted' && r.my_request_id && r.my_starts_at && r.my_ends_at)
      return {
        status: 'accepted',
        requestId: r.my_request_id,
        startsAt: iso(r.my_starts_at),
        endsAt: iso(r.my_ends_at),
      };
    if (r.my_request_status === 'pending' && r.my_request_id)
      return { status: 'pending', requestId: r.my_request_id };
    return { status: 'none' };
  };

  const capacityLeft = (c: Candidate) => Math.max(0, c.capacity - c.mentees);
  const full = (c: Candidate) => c.capacity <= 0 || c.mentees >= c.capacity;

  async function topicsAndNormaliser() {
    const topics = await prep.catalogue(p.prisma);
    return { topics, norm: makeNormaliser(topics) };
  }

  /** The caller's ranked list. Full mentors are hidden unless the caller has a live request with them. */
  async function list(user: User, query: unknown): Promise<hub.MentorList> {
    const { cursor, limit } = hub.HubPageQuery.parse(query);
    const db = p.prisma;
    const [{ topics, norm }, progress, profile, all] = await Promise.all([
      topicsAndNormaliser(),
      db.hubTopicProgress.findMany({ where: { userId: user.id } }),
      db.hubProfile.findUnique({ where: { userId: user.id }, select: { interests: true } }),
      candidates(db, { callerId: user.id }),
    ]);
    const byId = new Map(topics.map((t) => [t.id, t]));
    const tracked: TrackedTopic[] = progress.flatMap((r) => {
      const t = byId.get(r.topicId);
      return t
        ? [
            {
              topicId: t.id,
              name: t.name,
              tag: t.tag,
              sort: t.sort,
              solved: r.solved,
              total: r.totalItems,
            },
          ]
        : [];
    });
    const weak = weakestTopics(tracked);
    const interests = new Set((profile?.interests ?? []).map(norm));
    const visible = all.filter((c) => !full(c) || c.row.my_request_status !== null);
    const ranked = rankMentors(visible, weak, interests, norm).map((s, i) => ({
      rank: i + 1,
      mentorId: s.candidate.id,
      name: s.candidate.name,
      department: s.candidate.row.department,
      expertise: s.candidate.row.expertise,
      capacity: s.candidate.capacity,
      capacityLeft: capacityLeft(s.candidate),
      score: round4(s.score),
      components: round(s.components),
      slotsThisWeek: s.candidate.openSlots,
      nextSlots: slotsOf(s.candidate),
      coveredTopics: s.covered.map((t) => t.name),
      reason: reasonFor(s, weak),
      myRequest: myRequest(s.candidate),
    }));
    return { ...pageAt(ranked, cursor, limit), weakTopics: weakView(weak) };
  }

  /** A mentor's public profile (any hub role): every open slot in the next 7 days. */
  async function profile(params: unknown): Promise<hub.MentorProfile> {
    const { id } = hub.HubIdParam.parse(params);
    const [c] = await candidates(p.prisma, { onlyId: id, slotLimit: 100 });
    if (!c) throw E.notFound();
    return {
      mentorId: c.id,
      name: c.name,
      department: c.row.department,
      expertise: c.row.expertise,
      capacity: c.capacity,
      capacityLeft: capacityLeft(c),
      slotsThisWeek: c.openSlots,
      openSlots: slotsOf(c),
    };
  }

  /**
   * Admin "Mentor ranking": every mentor (full ones too) scored against demand. Weakness per
   * topic = 1 − Σ solved ÷ Σ total over every student tracking it; interests = the union of
   * students' interests.
   */
  async function adminList(query: unknown): Promise<hub.AdminMentorList> {
    const { cursor, limit } = hub.HubPageQuery.parse(query);
    const db = p.prisma;
    const [{ topics, norm }, sums, interestRows, all] = await Promise.all([
      topicsAndNormaliser(),
      db.hubTopicProgress.groupBy({
        by: ['topicId'],
        where: { profile: { user: { role: 'student', isActive: true } } },
        _sum: { solved: true, totalItems: true },
      }),
      db.$queryRaw<{ interest: string }[]>`
        SELECT DISTINCT unnest(p.interests) AS interest
        FROM hub_profiles p JOIN users u ON u.id = p.user_id
        WHERE u.role = 'student' AND u.is_active`,
      candidates(db, {}),
    ]);
    const byId = new Map(topics.map((t) => [t.id, t]));
    const tracked: TrackedTopic[] = sums.flatMap((s) => {
      const t = byId.get(s.topicId);
      return t
        ? [
            {
              topicId: t.id,
              name: t.name,
              tag: t.tag,
              sort: t.sort,
              solved: s._sum.solved ?? 0,
              total: s._sum.totalItems ?? 0,
            },
          ]
        : [];
    });
    const weak = weakestTopics(tracked);
    const interests = new Set(interestRows.map((r) => norm(r.interest)));
    const rows = rankMentors(all, weak, interests, norm).map((s, i) => ({
      rank: i + 1,
      mentorId: s.candidate.id,
      name: s.candidate.name,
      department: s.candidate.row.department,
      expertise: s.candidate.row.expertise,
      capacity: s.candidate.capacity,
      mentees: s.candidate.mentees,
      score: round4(s.score),
      components: round(s.components),
      reason: reasonFor(s, weak, "students'"),
      slotsThisWeek: s.candidate.openSlots,
      requestsLast30Days: s.candidate.row.recent_requests,
    }));
    return { ...pageAt(rows, cursor, limit), weakTopics: weakView(weak) };
  }

  return { candidates, list, profile, adminList, full };
}
export type MentorService = ReturnType<typeof mentorService>;
