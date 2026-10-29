// Mentor slots and mentorship requests. Every state change is one transaction that locks, in
// this order, the mentor's profile row, the request row, then the slot row.
import { hub } from '@universe/contracts';
import type { Platform } from '../../platform/modules/index.js';
import { config } from './config.js';
import type { PrepService } from './prep.js';
import {
  ensureProfile,
  errors,
  iso,
  isMentor,
  isoOrNull,
  toSlot,
  violates,
  type Db,
  type Tx,
  type User,
} from './shared.js';

const requestInclude = {
  slot: true,
  mentor: { select: { mentorDepartment: true, user: { select: { name: true } } } },
} as const;

export function requestService(p: Platform, prep: PrepService) {
  const E = errors(p);
  const { olderThan, toPage, newestFirst } = p.paging;

  /** Mentor routes: role mentor, or a student who is a peer mentor. */
  async function requireMentor(db: Db, user: User) {
    if (user.role === 'mentor') return;
    const profile = await db.hubProfile.findUnique({ where: { userId: user.id } });
    if (!isMentor(user.role, profile))
      throw E.forbidden(
        'Only mentors can do this. Students can become peer mentors in their profile.',
        'NOT_A_MENTOR',
      );
  }

  // ── Slots ─────────────────────────────────────────────────────────────────────────────

  /** The mentor's slots that have not ended, soonest first, with who booked them. */
  async function mySlots(user: User, query: unknown) {
    const q = hub.SlotQuery.parse(query);
    const db = p.prisma;
    await requireMentor(db, user);
    const after = q.cursor ? p.paging.decodeCursor(q.cursor) : null;
    const rows = await db.hubMentorSlot.findMany({
      where: {
        mentorId: user.id,
        endsAt: { gte: new Date() },
        ...(q.status && { status: q.status }),
        ...(after && {
          startsAt: { gte: after.createdAt },
          OR: [
            { startsAt: { gt: after.createdAt } },
            { startsAt: after.createdAt, id: { gt: after.id } },
          ],
        }),
      },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      take: q.limit + 1,
      include: {
        requests: {
          where: { status: { in: ['accepted', 'completed'] } },
          select: { id: true, student: { select: { user: { select: { name: true } } } } },
        },
      },
    });
    const last = rows.length > q.limit ? rows[q.limit - 1] : undefined;
    return {
      items: rows.slice(0, q.limit).map((s) => {
        const booking = s.requests[0];
        return {
          ...toSlot(s),
          booking: booking
            ? { requestId: booking.id, studentName: booking.student.user.name }
            : null,
        };
      }),
      nextCursor: last ? p.paging.encodeCursor({ createdAt: last.startsAt, id: last.id }) : null,
    };
  }

  async function createSlot(user: User, body: unknown) {
    const input = hub.CreateSlotRequest.parse(body);
    const startsAt = new Date(input.startsAt);
    if (startsAt.getTime() <= Date.now()) throw E.bad('A slot must start in the future.');
    try {
      const slot = await p.transaction(async (tx) => {
        await requireMentor(tx, user);
        await ensureProfile(tx, user.id);
        return tx.hubMentorSlot.create({
          data: {
            mentorId: user.id,
            startsAt,
            endsAt: new Date(input.endsAt),
            locationLabel: input.locationLabel ?? null,
            locationStopId: input.locationStopId ?? null,
          },
        });
      });
      return { ...toSlot(slot), booking: null };
    } catch (err) {
      if (
        violates(err, 'hub_mentor_slots_no_overlap') ||
        violates(err, 'hub_mentor_slots_live_start_key')
      )
        throw E.conflict('SLOT_OVERLAP', 'This slot overlaps another of your slots.');
      throw err;
    }
  }

  /** Cancels an open slot (a booked one must be cancelled through its request). */
  async function deleteSlot(user: User, params: unknown) {
    const { id } = hub.HubIdParam.parse(params);
    await p.transaction(async (tx) => {
      await requireMentor(tx, user);
      const [slot] = await tx.$queryRaw<{ status: string }[]>`
        SELECT status FROM hub_mentor_slots WHERE id = ${id}::uuid AND mentor_id = ${user.id}::uuid FOR UPDATE`;
      if (!slot || slot.status === 'cancelled') throw E.notFound();
      if (slot.status !== 'open')
        throw E.conflict('SLOT_BOOKED', 'This slot is booked. Cancel the session instead.');
      await tx.hubMentorSlot.update({ where: { id }, data: { status: 'cancelled' } });
    });
  }

  // ── Requests ──────────────────────────────────────────────────────────────────────────

  type Row = NonNullable<Awaited<ReturnType<typeof loadRequest>>>;
  const loadRequest = (db: Db, id: string) =>
    db.hubMentorshipRequest.findUnique({ where: { id }, include: requestInclude });

  async function views(db: Db, rows: Row[]): Promise<hub.MentorshipRequest[]> {
    const cards = await prep.studentCards(
      db,
      rows.map((r) => r.studentId),
    );
    return rows.map((r) => {
      const student = cards.get(r.studentId);
      if (!student) throw new Error(`student ${r.studentId} missing`);
      return {
        id: r.id,
        status: r.status as hub.RequestStatus,
        note: r.note,
        createdAt: iso(r.createdAt),
        decidedAt: isoOrNull(r.decidedAt),
        slot: r.slot ? toSlot(r.slot) : null,
        mentor: { id: r.mentorId, name: r.mentor.user.name, department: r.mentor.mentorDepartment },
        student,
      };
    });
  }
  const view = async (db: Db, row: Row) => (await views(db, [row]))[0]!;

  /** A request the caller is a party to (admins see all); anyone else gets 404. */
  async function get(user: User, params: unknown) {
    const { id } = hub.HubIdParam.parse(params);
    const row = await loadRequest(p.prisma, id);
    if (!row || (user.role !== 'admin' && user.id !== row.studentId && user.id !== row.mentorId))
      throw E.notFound();
    return view(p.prisma, row);
  }

  const openSlotOf = async (tx: Tx, mentorId: string, slotId: string) => {
    const [slot] = await tx.$queryRaw<{ id: string; status: string; starts_at: Date }[]>`
      SELECT id, status, starts_at FROM hub_mentor_slots
      WHERE id = ${slotId}::uuid AND mentor_id = ${mentorId}::uuid FOR UPDATE`;
    return slot;
  };

  const menteesOf = (tx: Tx, mentorId: string) =>
    tx.$queryRaw<{ n: number }[]>`
      SELECT count(DISTINCT student_id)::int AS n FROM hub_mentorship_requests
      WHERE mentor_id = ${mentorId}::uuid AND status = 'accepted'`.then((r) => r[0]?.n ?? 0);

  /** One click: mentor only; slot and note optional. */
  async function create(user: User, body: unknown) {
    const input = hub.CreateMentorshipRequest.parse(body);
    if (input.mentorId === user.id) throw E.bad('You cannot request yourself.');
    try {
      const id = await p.transaction(async (tx, emit) => {
        const mentorUser = await tx.user.findUnique({
          where: { id: input.mentorId },
          select: { role: true, isActive: true, hubProfile: true },
        });
        if (!mentorUser?.isActive || !isMentor(mentorUser.role, mentorUser.hubProfile))
          throw E.notFound('Mentor not found');
        await ensureProfile(tx, user.id);
        await ensureProfile(tx, input.mentorId);
        const [profile] = await tx.$queryRaw<{ mentor_capacity: number }[]>`
          SELECT mentor_capacity FROM hub_profiles WHERE user_id = ${input.mentorId}::uuid FOR UPDATE`;
        if ((await menteesOf(tx, input.mentorId)) >= (profile?.mentor_capacity ?? 0))
          throw E.conflict('MENTOR_FULL', 'This mentor has no room for new mentees right now.');
        let startsAt: Date | null = null;
        if (input.slotId) {
          const slot = await openSlotOf(tx, input.mentorId, input.slotId);
          if (!slot || slot.status !== 'open' || slot.starts_at.getTime() <= Date.now())
            throw E.conflict('SLOT_TAKEN', 'That slot is no longer open.');
          startsAt = slot.starts_at;
        }
        const created = await tx.hubMentorshipRequest.create({
          data: {
            studentId: user.id,
            mentorId: input.mentorId,
            slotId: input.slotId ?? null,
            note: input.note ?? null,
          },
        });
        await emit({
          recipients: input.mentorId,
          actorId: user.id,
          module: 'hub',
          type: 'hub.request_received',
          payload: {
            requestId: created.id,
            studentName: user.name,
            note: created.note,
            startsAt: startsAt ? iso(startsAt) : null,
          },
        });
        return created.id;
      });
      const row = await loadRequest(p.prisma, id);
      if (!row) throw E.notFound();
      return view(p.prisma, row);
    } catch (err) {
      if (violates(err, 'hub_requests_one_live_key'))
        throw E.conflict(
          'REQUEST_EXISTS',
          'You already have a pending or accepted request with this mentor.',
        );
      throw err;
    }
  }

  async function mine(user: User, query: unknown) {
    const q = hub.HubPageQuery.parse(query);
    const rows = await p.prisma.hubMentorshipRequest.findMany({
      where: { studentId: user.id, ...olderThan(q.cursor) },
      orderBy: [...newestFirst],
      take: q.limit + 1,
      include: requestInclude,
    });
    const page = toPage(rows, q.limit, (r) => r);
    return { items: await views(p.prisma, page.items), nextCursor: page.nextCursor };
  }

  async function incoming(user: User, query: unknown) {
    const q = hub.IncomingQuery.parse(query);
    await requireMentor(p.prisma, user);
    const rows = await p.prisma.hubMentorshipRequest.findMany({
      where: { mentorId: user.id, ...(q.status && { status: q.status }), ...olderThan(q.cursor) },
      orderBy: [...newestFirst],
      take: q.limit + 1,
      include: requestInclude,
    });
    const page = toPage(rows, q.limit, (r) => r);
    return { items: await views(p.prisma, page.items), nextCursor: page.nextCursor };
  }

  /**
   * Locks the mentor's profile row, then the request row, and returns the request if `user`
   * may act on it as `as`; 404 otherwise (non-parties never learn it exists).
   */
  async function lockFor(tx: Tx, user: User, id: string, as: 'mentor' | 'party') {
    const row = await tx.hubMentorshipRequest.findUnique({ where: { id } });
    const allowed =
      row && (user.id === row.mentorId || (as === 'party' && user.id === row.studentId));
    if (!row || !allowed) throw E.notFound();
    await tx.$queryRaw`SELECT 1 FROM hub_profiles WHERE user_id = ${row.mentorId}::uuid FOR UPDATE`;
    const [fresh] = await tx.$queryRaw<{ status: string; slot_id: string | null }[]>`
      SELECT status, slot_id FROM hub_mentorship_requests WHERE id = ${id}::uuid FOR UPDATE`;
    if (!fresh) throw E.notFound();
    return { ...row, status: fresh.status, slotId: fresh.slot_id };
  }

  /**
   * Accept: re-checks capacity under the mentor lock, then books `slotId`, else the requested
   * slot, else the earliest open slot at least an hour away. Two accepts for one slot: the
   * second waits for the first's locks, sees the slot booked and gets 409.
   */
  async function accept(user: User, params: unknown, body: unknown) {
    const { id } = hub.HubIdParam.parse(params);
    const input = hub.AcceptRequest.parse(body ?? {});
    await p.transaction(async (tx, emit) => {
      const r = await lockFor(tx, user, id, 'mentor');
      if (r.status !== 'pending')
        throw E.conflict('REQUEST_NOT_PENDING', `This request is ${r.status}.`);
      const [profile] = await tx.$queryRaw<{ mentor_capacity: number }[]>`
        SELECT mentor_capacity FROM hub_profiles WHERE user_id = ${r.mentorId}::uuid`;
      if ((await menteesOf(tx, r.mentorId)) >= (profile?.mentor_capacity ?? 0))
        throw E.conflict(
          'MENTOR_FULL',
          'You are at capacity. Complete a mentorship or raise your capacity first.',
        );
      let slotId = input.slotId ?? r.slotId;
      if (!slotId) {
        const lead = new Date(Date.now() + config.acceptLeadMinutes * 60_000);
        const [earliest] = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM hub_mentor_slots
          WHERE mentor_id = ${r.mentorId}::uuid AND status = 'open' AND starts_at >= ${lead}
          ORDER BY starts_at, id LIMIT 1`;
        if (!earliest)
          throw E.conflict(
            'NO_OPEN_SLOT',
            'You have no open slot at least an hour away. Add a slot first.',
          );
        slotId = earliest.id;
      }
      const slot = await openSlotOf(tx, r.mentorId, slotId);
      if (!slot) throw E.notFound('Slot not found');
      if (slot.status !== 'open' || slot.starts_at.getTime() <= Date.now())
        throw E.conflict('SLOT_TAKEN', 'That slot is no longer open. Pick another slot.');
      const booked = await tx.hubMentorSlot.update({
        where: { id: slotId },
        data: { status: 'booked' },
      });
      await tx.hubMentorshipRequest.update({
        where: { id },
        data: { status: 'accepted', slotId, decidedAt: new Date() },
      });
      await emit({
        recipients: r.studentId,
        actorId: user.id,
        module: 'hub',
        type: 'hub.request_accepted',
        payload: {
          requestId: id,
          mentorName: user.name,
          startsAt: iso(booked.startsAt),
          endsAt: iso(booked.endsAt),
          locationLabel: booked.locationLabel,
        },
      });
    });
    return get(user, params);
  }

  async function decline(user: User, params: unknown, body: unknown) {
    const { id } = hub.HubIdParam.parse(params);
    hub.NoBody.parse(body ?? {});
    await p.transaction(async (tx, emit) => {
      const r = await lockFor(tx, user, id, 'mentor');
      if (r.status !== 'pending')
        throw E.conflict('REQUEST_NOT_PENDING', `This request is ${r.status}.`);
      await tx.hubMentorshipRequest.update({
        where: { id },
        data: { status: 'declined', decidedAt: new Date() },
      });
      await emit({
        recipients: r.studentId,
        actorId: user.id,
        module: 'hub',
        type: 'hub.request_declined',
        payload: { requestId: id, mentorName: user.name },
      });
    });
    return get(user, params);
  }

  /** After the session has started: frees the mentee place (the slot stays booked, as history). */
  async function complete(user: User, params: unknown, body: unknown) {
    const { id } = hub.HubIdParam.parse(params);
    hub.NoBody.parse(body ?? {});
    await p.transaction(async (tx) => {
      const r = await lockFor(tx, user, id, 'mentor');
      if (r.status !== 'accepted')
        throw E.conflict('REQUEST_NOT_ACCEPTED', `This request is ${r.status}.`);
      const slot = r.slotId ? await tx.hubMentorSlot.findUnique({ where: { id: r.slotId } }) : null;
      if (slot && slot.startsAt.getTime() > Date.now())
        throw E.conflict('SESSION_NOT_STARTED', 'Mark the session completed after it has started.');
      await tx.hubMentorshipRequest.update({ where: { id }, data: { status: 'completed' } });
    });
    return get(user, params);
  }

  /** Student or mentor; pending or accepted. Cancelling an accepted request reopens its future slot. */
  async function cancel(user: User, params: unknown, body: unknown) {
    const { id } = hub.HubIdParam.parse(params);
    hub.NoBody.parse(body ?? {});
    await p.transaction(async (tx, emit) => {
      const r = await lockFor(tx, user, id, 'party');
      if (r.status !== 'pending' && r.status !== 'accepted')
        throw E.conflict('REQUEST_CLOSED', `This request is ${r.status}.`);
      let startsAt: Date | null = null;
      if (r.slotId) {
        const slot = await openSlotOf(tx, r.mentorId, r.slotId);
        startsAt = slot?.starts_at ?? null;
        if (
          r.status === 'accepted' &&
          slot &&
          slot.status === 'booked' &&
          slot.starts_at.getTime() > Date.now()
        )
          await tx.hubMentorSlot.update({ where: { id: r.slotId }, data: { status: 'open' } });
      }
      await tx.hubMentorshipRequest.update({
        where: { id },
        data: { status: 'cancelled', decidedAt: new Date() },
      });
      await emit({
        recipients: user.id === r.studentId ? r.mentorId : r.studentId,
        actorId: user.id,
        module: 'hub',
        type: 'hub.request_cancelled',
        payload: { requestId: id, byName: user.name, startsAt: startsAt ? iso(startsAt) : null },
      });
    });
    return get(user, params);
  }

  return {
    mySlots,
    createSlot,
    deleteSlot,
    get,
    create,
    mine,
    incoming,
    accept,
    decline,
    complete,
    cancel,
    requireMentor,
  };
}
