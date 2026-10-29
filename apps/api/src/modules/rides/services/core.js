// Shared helpers for every rides service: errors, the stop graph, paging, batched member
// loading and rider profiles. Built once per platform by the module factory.
const { randomInt } = require('node:crypto');
const cfg = require('../config');
const { dijkstra } = require('../lib/dijkstra');
const fare = require('../lib/fare');

const MIN = 60_000;

module.exports = function core(p) {
  const { prisma } = p;
  const { ApiError } = p.http;

  const fail = (status, code, message, details) => new ApiError(status, code, message, details);
  const notFound = (what = 'Not found') => fail(404, 'NOT_FOUND', what);
  const conflict = (message, details) => fail(409, 'CONFLICT', message, details);
  const badRequest = (message, details) => fail(400, 'BAD_REQUEST', message, details);

  // ── Time ──────────────────────────────────────────────────────────────────────────────
  const bufferMs = cfg.matching.bufferMinutes * MIN;
  const busyMs = cfg.drivers.busyAfterPickupMinutes * MIN;
  // Display only (messages); all comparisons are on UTC instants.
  const clock = (d) =>
    d.toLocaleTimeString('en-IN', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata',
    });

  const minutesToPickup = (g, now = Date.now()) => (g.pickupAt.getTime() - now) / MIN;
  // Locked only while the pickup is still ahead and inside the lock window; a past pickup
  // (a ride that never filled) stays leaveable.
  const leaveLockedReason = (g, now = Date.now()) => {
    const m = minutesToPickup(g, now);
    return m > 0 && m <= cfg.matching.leaveLockMinutes
      ? `Pickup is in under ${cfg.matching.leaveLockMinutes} minutes — you're locked in. Message the group if something changed.`
      : null;
  };
  // An auto ride this member hasn't paid for yet, still ahead and not cancelled.
  const paymentPendingFor = (g, member, now = Date.now()) =>
    g.kind === 'auto' &&
    g.status !== 'cancelled' &&
    Boolean(member) &&
    !member.paidAt &&
    g.pickupAt.getTime() > now;

  // ── Names ─────────────────────────────────────────────────────────────────────────────
  const initialsOf = (name) =>
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join('');
  const firstNameOf = (name) => name.split(/\s+/).filter((w) => !/\.$/.test(w))[0] || name;

  // ── Stop graph: two small tables, loaded once per request ─────────────────────────────
  async function loadGraph(db = prisma) {
    const [nodes, edges] = await Promise.all([
      db.$queryRaw`
        SELECT id::text, name, short_name AS "shortName", area, aliases,
               ST_Y(geom::geometry) AS lat, ST_X(geom::geometry) AS lng
        FROM rides_nodes ORDER BY area, name`,
      db.ridesRouteEdge.findMany({ select: { nodeAId: true, nodeBId: true, distanceM: true } }),
    ]);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const trees = new Map();
    const from = (sourceId) => {
      if (!trees.has(sourceId)) trees.set(sourceId, dijkstra(edges, sourceId));
      return trees.get(sourceId);
    };
    const stop = (id) => {
      const n = byId.get(id);
      return n
        ? { id: n.id, name: n.name, shortName: n.shortName }
        : { id, name: 'Unknown stop', shortName: '?' };
    };
    return { nodes, byId, edges, from, stop };
  }

  /**
   * Full price breakup for riders sharing one auto from `pickupNodeId`, in paise.
   * riders: [{ userId, name, dropNodeId }] in join order. The same split the join charges.
   */
  function fareBreakup(graph, pickupNodeId, riders, youUserId) {
    const t = cfg.tariff;
    const { pathTo } = graph.from(pickupNodeId);
    const withM = riders.map((r) => {
      const path = pathTo(r.dropNodeId);
      if (!path) throw badRequest('No known route between these stops');
      return { ...r, m: path.distanceM };
    });
    const far = withM.reduce((a, b) => (b.m > a.m ? b : a));
    const backbone = pathTo(far.dropNodeId);
    const stops = fare.buildCumulativePath(graph.edges, backbone.nodeIds);
    const split = fare.splitFareBySegments(
      stops,
      withM.map((r) => ({ userId: r.userId, dropM: r.m })),
      t,
    );
    const meter = fare.meterBreakdown(backbone.distanceM, t);
    return {
      distanceM: backbone.distanceM,
      baseFarePaise: t.baseFarePaise,
      baseMetres: t.baseMetres,
      extraMetres: meter.extraMetres,
      perKmPaise: t.perKmPaise,
      distanceChargePaise: meter.distanceChargePaise,
      meterFarePaise: meter.meterFarePaise,
      surgePercent: t.surgePercent,
      surgeChargePaise: split.totalFarePaise - meter.meterFarePaise,
      totalFarePaise: split.totalFarePaise,
      members: withM.map((r) => {
        const solo = fare.fareForDistance(r.m, t);
        const share = split.shares.get(r.userId);
        return {
          name: r.name,
          dropName: graph.stop(r.dropNodeId).name,
          distanceM: r.m,
          fareSharePaise: share,
          soloFarePaise: solo,
          savedPaise: solo - share,
          isYou: r.userId === youUserId,
        };
      }),
    };
  }

  // ── Paging: keyset cursors over (sort key, id); the platform encodes them ─────────────
  const pageQuery = (query) => p.contracts.rides.RidesPageQuery.parse(query);
  const cursorOf = (cursor) => (cursor ? p.paging.decodeCursor(cursor) : null);
  // Rows strictly after the cursor, ascending by `field` then id.
  function afterAsc(field, cursor) {
    const c = cursorOf(cursor);
    if (!c) return {};
    return {
      [field]: { gte: c.createdAt },
      OR: [{ [field]: { gt: c.createdAt } }, { [field]: c.createdAt, id: { gt: c.id } }],
    };
  }
  function beforeDesc(field, cursor, idField = 'id') {
    const c = cursorOf(cursor);
    if (!c) return {};
    return {
      [field]: { lte: c.createdAt },
      OR: [{ [field]: { lt: c.createdAt } }, { [field]: c.createdAt, [idField]: { lt: c.id } }],
    };
  }
  function toPage(rows, limit, key, map) {
    const last = rows.length > limit ? rows[limit - 1] : undefined;
    return {
      items: rows.slice(0, limit).map(map),
      nextCursor: last ? p.paging.encodeCursor({ createdAt: key(last), id: last.id }) : null,
    };
  }

  // ── Members, loaded for many groups in one query ──────────────────────────────────────
  const memberInclude = {
    user: {
      select: {
        gender: true,
        womenOnlyGroups: true,
        driverPreference: true,
        riderCode: true,
        user: { select: { name: true } },
      },
    },
    request: {
      select: { soloFarePaise: true, distanceM: true, pickupAt: true, pickupNodeId: true },
    },
  };
  const flatMember = (m) => ({
    id: m.id,
    groupId: m.groupId,
    userId: m.userId,
    requestId: m.requestId,
    dropNodeId: m.dropNodeId,
    fareSharePaise: m.fareSharePaise,
    boardedAt: m.boardedAt,
    paidAt: m.paidAt,
    allowAnyDriver: m.allowAnyDriver,
    joinedAt: m.joinedAt,
    name: m.user.user.name,
    soloFarePaise: m.request.soloFarePaise,
    distanceM: m.request.distanceM,
    requestPickupAt: m.request.pickupAt,
    // Server-side only: never put these in a response about someone else.
    profile: {
      gender: m.user.gender,
      womenOnlyGroups: m.user.womenOnlyGroups,
      driverPreference: m.user.driverPreference,
      riderCode: m.user.riderCode,
    },
  });
  /** Map groupId -> members in join order, for any number of groups, in one query. */
  async function membersByGroup(groupIds, db = prisma) {
    const out = new Map(groupIds.map((id) => [id, []]));
    if (groupIds.length === 0) return out;
    const rows = await db.ridesGroupMember.findMany({
      where: { groupId: { in: groupIds } },
      orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
      include: memberInclude,
    });
    for (const m of rows) out.get(m.groupId).push(flatMember(m));
    return out;
  }

  // Locks a group row for the rest of the transaction; returns it, or null.
  async function lockGroup(tx, groupId) {
    await tx.$queryRaw`SELECT id FROM rides_groups WHERE id = ${groupId}::uuid FOR UPDATE`;
    return tx.ridesGroup.findUnique({ where: { id: groupId } });
  }

  // ── Profiles ──────────────────────────────────────────────────────────────────────────
  const newRiderCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

  /** Every rides user has a profile (rider code generated once). Idempotent, race-safe. */
  async function ensureProfile(userId, db = prisma) {
    for (let attempt = 0; attempt < 5; attempt++) {
      // No conflict target: a clash on user_id (already there) or on rider_code (retry) both skip.
      await db.$executeRaw`
        INSERT INTO rides_profiles (user_id, rider_code) VALUES (${userId}::uuid, ${newRiderCode()})
        ON CONFLICT DO NOTHING`;
      const profile = await db.ridesProfile.findUnique({ where: { userId } });
      if (profile) return profile;
    }
    throw new Error('could not allocate a rider code');
  }

  const suspendedError = (profile) =>
    fail(
      403,
      'RIDES_SUSPENDED',
      `Your rides access is suspended: ${profile.suspendedReason || 'Suspended by admin'}. Contact the transport office.`,
    );
  function assertNotSuspended(profile) {
    if (profile.suspendedAt) throw suspendedError(profile);
  }

  // A rider who handed a driver their code is on that ride until it is over (pickup + busy
  // window) or cancelled: they can't take a seat anywhere else meanwhile.
  async function boardedBlockReason(userId, db = prisma, now = Date.now()) {
    const boarded = await db.ridesGroupMember.findFirst({
      where: {
        userId,
        boardedAt: { not: null },
        group: { status: { not: 'cancelled' }, pickupAt: { gt: new Date(now - busyMs) } },
      },
      select: { group: { select: { pickupAt: true } } },
    });
    return boarded
      ? `You've already boarded your ${clock(boarded.group.pickupAt)} ride (you gave the driver your rider code), so you can't join another group until that ride is over.`
      : null;
  }

  return {
    p,
    cfg,
    prisma,
    fail,
    notFound,
    conflict,
    badRequest,
    bufferMs,
    busyMs,
    clock,
    leaveLockedReason,
    paymentPendingFor,
    initialsOf,
    firstNameOf,
    loadGraph,
    fareBreakup,
    pageQuery,
    afterAsc,
    beforeDesc,
    toPage,
    membersByGroup,
    memberInclude,
    flatMember,
    lockGroup,
    ensureProfile,
    assertNotSuspended,
    boardedBlockReason,
  };
};
