// Rider side: profile, ride requests, matches, groups, boarding, payment, chat, feedback and
// safety reports. Ported from Module B's rides, groups, auth (preferences) and vehicles
// (feedback) services; every multi-step write is one transaction with its activity events,
// and joins lock the group row so the last seat can only be taken once.
const { matchStop } = require('../lib/stopMatcher');
const { evaluate } = require('../lib/matching');
const fare = require('../lib/fare');
const {
  groupAccess,
  accessMessage,
  isFemale,
  wantsWomenOnly,
  wantsFemaleDriver,
  driverRequirement,
} = require('../lib/genderRules');

module.exports = function riders(c, services) {
  const { p, cfg, prisma } = c;
  const R = p.contracts.rides;

  // ── Profile ───────────────────────────────────────────────────────────────────────────
  // The student's own gender and pooling preferences: only ever sent to that student.
  const publicProfile = (profile) => ({
    riderCode: profile.riderCode,
    preferences: {
      gender: profile.gender ?? null,
      womenOnlyGroups: profile.womenOnlyGroups,
      driverPreference: profile.driverPreference,
    },
    suspended: profile.suspendedAt
      ? {
          at: profile.suspendedAt.toISOString(),
          reason: profile.suspendedReason || 'Suspended by admin',
        }
      : null,
  });

  const me = async (userId) => publicProfile(await c.ensureProfile(userId));

  // All optional. Women-only groups need gender 'female' (a CHECK constraint backs this).
  async function updatePreferences(userId, body) {
    const {
      gender = null,
      womenOnlyGroups = false,
      driverPreference = 'any',
    } = R.PreferencesRequest.parse(body);
    if (womenOnlyGroups && !isFemale({ gender })) {
      throw c.badRequest(
        'Women-only groups are available to students who set their gender as female.',
      );
    }
    await c.ensureProfile(userId);
    const profile = await prisma.ridesProfile.update({
      where: { userId },
      data: { gender, womenOnlyGroups, driverPreference },
    });
    return publicProfile(profile);
  }

  const listNodes = async () => (await c.loadGraph()).nodes;

  // ── Ride requests ─────────────────────────────────────────────────────────────────────
  async function alreadyInGroupError(duplicate, userId, graph) {
    const g =
      duplicate.groupId &&
      (await prisma.ridesGroup.findUnique({ where: { id: duplicate.groupId } }));
    if (!g) return c.conflict('You already have a ride for this route and time');
    const mine = await prisma.ridesGroupMember.findUnique({
      where: { groupId_userId: { groupId: g.id, userId } },
    });
    const ride = `${c.clock(g.pickupAt)} ${graph.stop(duplicate.pickupNodeId).name} → ${graph.stop(duplicate.dropNodeId).name}`;
    const window = `(Pickup times within ${cfg.matching.bufferMinutes} minutes of it on the same route count as the same ride.)`;
    const paid = Boolean(mine?.paidAt);
    let message;
    if (g.kind === 'transit') {
      message = `You're already in the ${ride} public-transport group — open it instead of starting a new search. ${window}`;
    } else if (paid) {
      message = `You already paid for the ${ride} group — open it to see details. ${window}`;
    } else {
      message = `You're already in the ${ride} group — finish booking it instead of starting a new search. ${window}`;
    }
    return c.fail(409, 'ALREADY_IN_GROUP', message, { groupId: g.id, paid, kind: g.kind });
  }

  const requestView = (r, graph) => ({
    id: r.id,
    pickup: graph.stop(r.pickupNodeId),
    drop: graph.stop(r.dropNodeId),
    pickupTime: r.pickupAt.toISOString(),
    windowStart: new Date(r.pickupAt.getTime() - c.bufferMs).toISOString(),
    windowEnd: new Date(r.pickupAt.getTime() + c.bufferMs).toISOString(),
    status: r.status,
    distanceM: r.distanceM,
    soloFarePaise: r.soloFarePaise,
    pooledEstimatePaise: {
      of2: fare.divRound(r.soloFarePaise, 2),
      of3: fare.divRound(r.soloFarePaise, 3),
    },
  });

  async function createRequest(userId, body) {
    const input = R.CreateRideRequest.parse(body);
    const profile = await c.ensureProfile(userId);
    c.assertNotSuspended(profile);
    const graph = await c.loadGraph();
    const resolve = (id, text, label) => {
      if (id) {
        if (!graph.byId.has(id)) throw c.notFound('Pickup or drop stop not found');
        return id;
      }
      const stop = matchStop(graph.nodes, text);
      if (!stop)
        throw c.badRequest(
          `Unknown ${label} "${text}". Try one of: ${graph.nodes.map((n) => n.name).join(', ')}`,
        );
      return stop.id;
    };
    const pickupNodeId = resolve(input.pickupNodeId, input.pickupText, 'pickup');
    const dropNodeId = resolve(input.dropNodeId, input.dropText, 'drop');
    if (pickupNodeId === dropNodeId)
      throw c.badRequest('Pickup and drop resolve to the same stop - pick two different places');

    const pickupMs = Date.parse(input.pickupTime);
    // 1 min grace so "now" from the client isn't rejected by clock skew.
    if (pickupMs < Date.now() - 60_000) throw c.badRequest('Pickup time must be in the future');

    // Same pickup + drop within the matching buffer is the same ride, not a new request.
    const duplicate = await prisma.ridesRequest.findFirst({
      where: {
        userId,
        pickupNodeId,
        dropNodeId,
        status: { in: ['open', 'matched'] },
        pickupAt: { gte: new Date(pickupMs - c.bufferMs), lte: new Date(pickupMs + c.bufferMs) },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (duplicate?.status === 'matched') throw await alreadyInGroupError(duplicate, userId, graph);
    if (duplicate) return requestView(duplicate, graph);

    const path = graph.from(pickupNodeId).pathTo(dropNodeId);
    if (!path) throw c.badRequest('No known route between the selected stops');
    const created = await prisma.ridesRequest.create({
      data: {
        userId,
        pickupNodeId,
        dropNodeId,
        pickupAt: new Date(pickupMs),
        distanceM: path.distanceM,
        soloFarePaise: fare.fareForDistance(path.distanceM, cfg.tariff),
      },
    });
    return requestView(created, graph);
  }

  // ── Views of groups ───────────────────────────────────────────────────────────────────
  const riderOf = (m) => ({ userId: m.userId, name: m.name, dropNodeId: m.dropNodeId });
  const farthestOf = (members) => members.reduce((a, b) => (b.distanceM > a.distanceM ? b : a));

  const memberRow = (m, f, i, graph, userId, extra = {}) => ({
    userId: m.userId,
    rideRequestId: m.requestId,
    name: m.name,
    initials: c.initialsOf(m.name),
    isYou: m.userId === userId,
    ...extra,
    dropNode: graph.stop(m.dropNodeId),
    dropDistanceM: f.members[i].distanceM,
    fareSharePaise: f.members[i].fareSharePaise,
    soloFarePaise: f.members[i].soloFarePaise,
  });

  /** A list entry. `joinAs`: preview with the viewer riding to the group's farthest drop. */
  function describeGroup(
    graph,
    g,
    members,
    userId,
    { joinAs = false, joinBlockedReason = null } = {},
  ) {
    const far = farthestOf(members);
    const riders = members.map(riderOf);
    if (joinAs) riders.push({ userId, name: 'You', dropNodeId: far.dropNodeId });
    const mine = members.find((m) => m.userId === userId);
    const now = Date.now();
    return {
      id: g.id,
      status: g.status,
      kind: g.kind,
      womenOnly: g.womenOnly,
      meetingPoint: g.meetingPoint,
      transitMode: g.transitMode,
      pickupName: graph.stop(g.pickupNodeId).name,
      dropName: graph.stop(far.dropNodeId).name,
      pickupTime: g.pickupAt.toISOString(),
      seatsLeft: cfg.matching.maxGroupSize - members.length,
      members: members.map((m) => ({
        name: m.name,
        initials: c.initialsOf(m.name),
        dropName: graph.stop(m.dropNodeId).name,
      })),
      fare: c.fareBreakup(graph, g.pickupNodeId, riders, userId),
      isMine: Boolean(mine),
      joinBlockedReason: mine ? null : joinBlockedReason,
      paymentPending: c.paymentPendingFor(g, mine, now),
      isPast: g.pickupAt.getTime() < now,
      leaveLockedReason: c.leaveLockedReason(g, now),
    };
  }

  async function memberOrNotFound(groupId, userId, db = prisma) {
    const m = await db.ridesGroupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });
    // 404, not 403: a non-member can't tell whether the group exists.
    if (!m) throw c.notFound('Group not found');
    return m;
  }

  async function getGroup(userId, groupId) {
    await memberOrNotFound(groupId, userId);
    const [g, members, graph] = await Promise.all([
      prisma.ridesGroup.findUniqueOrThrow({ where: { id: groupId } }),
      c.membersByGroup([groupId]).then((m) => m.get(groupId)),
      c.loadGraph(),
    ]);
    const f = c.fareBreakup(graph, g.pickupNodeId, members.map(riderOf), userId);
    const requirement = driverRequirement(
      g,
      members.map((m) => ({ userId: m.userId, user: m.profile, allowAnyDriver: m.allowAnyDriver })),
    );
    const mine = members.find((m) => m.userId === userId);
    return {
      id: g.id,
      womenOnly: g.womenOnly,
      // What this student needs to know about the driver choice - never who asked.
      driverPreference: {
        femaleRequired: requirement.female,
        youAskedFemale: wantsFemaleDriver(mine.profile),
        youWaived: mine.allowAnyDriver,
      },
      status: g.status,
      pickupTime: g.pickupAt.toISOString(),
      totalFarePaise: f.totalFarePaise,
      distanceM: f.distanceM,
      seatsLeft: cfg.matching.maxGroupSize - members.length,
      kind: g.kind,
      meetingPoint: g.meetingPoint,
      transitMode: g.transitMode,
      leaveLockedReason: c.leaveLockedReason(g),
      pickupNode: graph.stop(g.pickupNodeId),
      memberRideRequestIds: members.map((m) => m.requestId),
      fare: f,
      boarded: Boolean(mine.boardedAt),
      driverAssigned: Boolean(g.vehicleId),
      youPaid: Boolean(mine.paidAt),
      paymentPending: c.paymentPendingFor(g, mine),
      members: members.map((m, i) =>
        memberRow(m, f, i, graph, userId, { boarded: Boolean(m.boardedAt) }),
      ),
    };
  }

  // Forming groups with a free seat and an upcoming pickup that this student may join, plus
  // their own live groups (flagged isMine), soonest first. Gender rules are applied in SQL.
  async function listAvailable(userId, query) {
    const { cursor, limit } = c.pageQuery(query);
    const profile = await c.ensureProfile(userId);
    const genderWhere = {
      ...(isFemale(profile) ? {} : { womenOnly: false }),
      ...(wantsWomenOnly(profile) ? { womenOnly: true } : {}),
    };
    const groups = await prisma.ridesGroup.findMany({
      where: {
        AND: [
          { pickupAt: { gte: new Date() }, status: { not: 'cancelled' }, members: { some: {} } },
          { OR: [{ members: { some: { userId } } }, { status: 'forming', ...genderWhere }] },
          c.afterAsc('pickupAt', cursor),
        ],
      },
      orderBy: [{ pickupAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
    });
    const [members, graph, joinBlockedReason] = await Promise.all([
      c.membersByGroup(groups.slice(0, limit).map((g) => g.id)),
      c.loadGraph(),
      c.boardedBlockReason(userId),
    ]);
    return c.toPage(
      groups,
      limit,
      (g) => g.pickupAt,
      (g) => {
        const ms = members.get(g.id);
        const isMine = ms.some((m) => m.userId === userId);
        return describeGroup(graph, g, ms, userId, { joinAs: !isMine, joinBlockedReason });
      },
    );
  }

  // Groups the student joined (any state), soonest first.
  async function listMine(userId, query) {
    const { cursor, limit } = c.pageQuery(query);
    const groups = await prisma.ridesGroup.findMany({
      where: { AND: [{ members: { some: { userId } } }, c.afterAsc('pickupAt', cursor)] },
      orderBy: [{ pickupAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
    });
    const [members, graph] = await Promise.all([
      c.membersByGroup(groups.slice(0, limit).map((g) => g.id)),
      c.loadGraph(),
    ]);
    return c.toPage(
      groups,
      limit,
      (g) => g.pickupAt,
      (g) => describeGroup(graph, g, members.get(g.id), userId),
    );
  }

  // ── Matches ───────────────────────────────────────────────────────────────────────────
  /**
   * Every forming group this ride request could join, best first (Module B's rules: same
   * pickup stop, a free seat, every member's pickup within the buffer, one auto on one line,
   * overlap ≥ 50% of the shorter route; ranked 0.7 route similarity + 0.3 time). Groups
   * hidden only by the student's own women-only preference are counted.
   */
  async function findMatches(userId, query) {
    const q = R.MatchesQuery.parse(query);
    const target = await prisma.ridesRequest.findUnique({ where: { id: q.rideRequestId } });
    if (!target || target.userId !== userId) throw c.notFound('Ride request not found');
    if (target.status !== 'open') throw c.badRequest('This request is no longer open');
    const profile = await c.ensureProfile(userId);
    const graph = await c.loadGraph();
    const { pathTo } = graph.from(target.pickupNodeId);
    const targetPath = pathTo(target.dropNodeId);
    if (!targetPath) throw c.badRequest('No known route from pickup to drop');

    // The group's pickup is its latest member's, so a compatible group lies within ± buffer.
    const groups = await prisma.ridesGroup.findMany({
      where: {
        status: 'forming',
        kind: q.kind,
        pickupNodeId: target.pickupNodeId,
        pickupAt: {
          gte: new Date(target.pickupAt.getTime() - c.bufferMs),
          lte: new Date(target.pickupAt.getTime() + c.bufferMs),
        },
        members: { none: { userId } },
      },
    });
    const members = await c.membersByGroup(groups.map((g) => g.id));
    const relax = q.relaxPreference === 'true';
    const myName = (
      await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } })
    ).name;

    const results = [];
    let hiddenByPreference = 0;
    for (const g of groups) {
      const ms = members.get(g.id);
      if (ms.length === 0 || ms.length >= cfg.matching.maxGroupSize) continue;
      const maxGapMinutes = Math.max(
        ...ms.map((m) => Math.abs(m.requestPickupAt - target.pickupAt) / 60_000),
      );
      const memberPaths = ms.map((m) => pathTo(m.dropNodeId));
      if (memberPaths.some((x) => !x)) continue;
      const fit = evaluate(targetPath, memberPaths, maxGapMinutes, pathTo);
      if (!fit) continue;
      const access = groupAccess(profile, g, { relax });
      if (!access.ok) {
        if (access.reason === 'not_women_only') hiddenByPreference++;
        continue;
      }
      const all = [
        ...ms,
        {
          userId,
          requestId: target.id,
          name: myName,
          dropNodeId: target.dropNodeId,
          requestPickupAt: target.pickupAt,
        },
      ];
      const f = c.fareBreakup(graph, g.pickupNodeId, all.map(riderOf), userId);
      results.push({
        id: g.id,
        score: Math.round(fit.score * 1000) / 1000,
        routeOverlap: Math.round(fit.overlap * 100) / 100,
        routeSimilarity: Math.round(fit.similarity * 100) / 100,
        womenOnly: g.womenOnly,
        pickupTime: new Date(
          Math.max(...all.map((m) => m.requestPickupAt.getTime())),
        ).toISOString(),
        totalFarePaise: f.totalFarePaise,
        distanceM: f.distanceM,
        seatsLeft: cfg.matching.maxGroupSize - all.length,
        pickupNode: graph.stop(g.pickupNodeId),
        memberRideRequestIds: all.map((m) => m.requestId),
        fare: f,
        members: all.map((m, i) => memberRow(m, f, i, graph, userId)),
      });
    }
    results.sort((a, b) => b.score - a.score || a.pickupTime.localeCompare(b.pickupTime));
    return { groups: results.slice(0, q.limit), hiddenByPreference };
  }

  // ── Join ──────────────────────────────────────────────────────────────────────────────
  const rideInfo = (graph, g) => ({
    groupId: g.id,
    pickupName: graph.stop(g.pickupNodeId).name,
    pickupTime: g.pickupAt.toISOString(),
  });

  /**
   * Joins (or starts) the group made of `memberRideRequestIds`: the caller's own open request
   * plus the requests of an existing group's members. Inside one transaction the group row is
   * locked, then the requests, and every rule is checked against what is committed, so two
   * riders can never take the same last seat.
   */
  async function join(userId, body) {
    const input = R.JoinGroupRequest.parse(body);
    if (!input.memberRideRequestIds.includes(input.rideRequestId)) {
      throw c.badRequest('rideRequestId must be included in memberRideRequestIds');
    }
    const relax = Boolean(input.relaxPreference);
    const profile = await c.ensureProfile(userId);
    c.assertNotSuspended(profile);
    const graph = await c.loadGraph();

    const groupId = await p.transaction(async (tx, emit) => {
      // Unlocked read to find the group, then lock group -> requests (the order every write uses).
      const peek = await tx.ridesRequest.findMany({
        where: { id: { in: input.memberRideRequestIds } },
      });
      if (peek.length !== new Set(input.memberRideRequestIds).size)
        throw c.badRequest('One or more ride requests not found');
      const others = peek.filter((r) => r.id !== input.rideRequestId);
      const groupIds = [...new Set(others.map((r) => r.groupId))];
      if (others.some((r) => r.status !== 'matched' || !r.groupId)) {
        throw c.conflict('You can only join riders who are already in a group');
      }
      if (groupIds.length > 1) throw c.conflict('Selected riders are in different groups');
      const existingId = groupIds[0] ?? null;
      const group = existingId ? await c.lockGroup(tx, existingId) : null;
      await tx.$queryRaw`SELECT id FROM rides_requests WHERE id = ${input.rideRequestId}::uuid FOR UPDATE`;
      const own = await tx.ridesRequest.findUnique({ where: { id: input.rideRequestId } });
      if (!own || own.userId !== userId) throw c.notFound('Ride request not found');
      if (own.status === 'matched') throw c.conflict('This ride request has already been matched');
      if (own.status !== 'open') throw c.conflict('This ride request is no longer open');

      let members = [];
      if (group) {
        members = (await c.membersByGroup([group.id], tx)).get(group.id);
        if (members.some((m) => m.userId === userId))
          throw c.conflict("You're already in this group.");
        if (group.status === 'confirmed')
          throw c.conflict(
            'This group just filled up - refresh the list and pick another, or start a new group',
          );
        if (group.status !== 'forming') throw c.conflict('This group is no longer open');
        const current = new Set(members.map((m) => m.requestId));
        if (others.some((r) => !current.has(r.id)))
          throw c.conflict('This group changed - refresh the list and try again');
        if (members.length + 1 > cfg.matching.maxGroupSize) throw c.conflict('This group is full');
        if (group.pickupNodeId !== own.pickupNodeId)
          throw c.badRequest('All members must share the same pickup node');
      }
      const pickups = [...members.map((m) => m.requestPickupAt.getTime()), own.pickupAt.getTime()];
      if (Math.max(...pickups) - Math.min(...pickups) > c.bufferMs) {
        throw c.badRequest(
          `Pickup times in a group must be within ${cfg.matching.bufferMinutes} minutes of each other`,
        );
      }
      const boarded = await c.boardedBlockReason(userId, tx);
      if (boarded) throw c.conflict(boarded);

      // Gender preference (hard filter): a new group is women-only when the student starting
      // it asked for that; anyone entering a group must be allowed into it.
      const target = group ?? { womenOnly: wantsWomenOnly(profile) && !relax };
      const access = groupAccess(profile, target, { relax });
      if (!access.ok)
        throw c.fail(
          access.reason === 'women_only_group' ? 403 : 409,
          'GROUP_ACCESS',
          accessMessage(access.reason),
        );

      // One auto serves one line: every drop must lie on the farthest member's route.
      const { pathTo } = graph.from(own.pickupNodeId);
      const riders = [
        ...members.map((m) => ({
          userId: m.userId,
          name: m.name,
          dropNodeId: m.dropNodeId,
          requestId: m.requestId,
        })),
        { userId, name: '', dropNodeId: own.dropNodeId, requestId: own.id },
      ];
      const paths = riders.map((r) => pathTo(r.dropNodeId));
      if (paths.some((x) => !x)) throw c.badRequest('No known route for one of the ride requests');
      const backbone = paths.reduce((a, b) => (b.distanceM > a.distanceM ? b : a));
      if (!paths.every((x) => x.nodeIds.every((id, i) => id === backbone.nodeIds[i]))) {
        throw c.badRequest('This ride is not on the same route as the rest of the group');
      }
      const stops = fare.buildCumulativePath(graph.edges, backbone.nodeIds);
      const { totalFarePaise, shares } = fare.splitFareBySegments(
        stops,
        riders.map((r, i) => ({ userId: r.userId, dropM: paths[i].distanceM })),
        cfg.tariff,
      );
      const full = riders.length >= cfg.matching.maxGroupSize;
      const pickupAt = new Date(Math.max(...pickups));

      const g = group
        ? await tx.ridesGroup.update({
            where: { id: group.id },
            data: { totalFarePaise, pickupAt, ...(full && { status: 'confirmed' }) },
          })
        : await tx.ridesGroup.create({
            data: {
              pickupNodeId: own.pickupNodeId,
              pickupAt,
              totalFarePaise,
              kind: input.kind ?? 'auto',
              womenOnly: target.womenOnly,
              status: full ? 'confirmed' : 'forming',
            },
          });
      for (const m of members) {
        if (m.fareSharePaise !== shares.get(m.userId)) {
          await tx.ridesGroupMember.update({
            where: { id: m.id },
            data: { fareSharePaise: shares.get(m.userId) },
          });
        }
      }
      await tx.ridesGroupMember.create({
        data: {
          groupId: g.id,
          userId,
          requestId: own.id,
          dropNodeId: own.dropNodeId,
          fareSharePaise: shares.get(userId),
        },
      });
      await tx.ridesRequest.update({
        where: { id: own.id },
        data: { status: 'matched', groupId: g.id },
      });
      // Confirmed on a ride -> drop this rider's other pending requests.
      await tx.ridesRequest.updateMany({
        where: { userId, status: 'open', id: { not: own.id } },
        data: { status: 'cancelled' },
      });

      const name = (
        await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } })
      ).name;
      if (members.length > 0) {
        await emit({
          recipients: members.map((m) => m.userId),
          actorId: userId,
          module: 'rides',
          type: 'rides.member_joined',
          payload: { ...rideInfo(graph, g), memberName: name },
        });
      }
      if (full) {
        await emit({
          recipients: riders.map((r) => r.userId),
          actorId: null,
          module: 'rides',
          type: 'rides.group_confirmed',
          payload: rideInfo(graph, g),
        });
      }
      return g.id;
    });
    return getGroup(userId, groupId);
  }

  // Join a listed group directly: creates the student's request on the group's route and
  // time (to its farthest drop), then joins through the normal path.
  async function joinById(userId, groupId) {
    const g = await prisma.ridesGroup.findUnique({ where: { id: groupId } });
    if (!g) throw c.notFound('Group not found');
    if (
      await prisma.ridesGroupMember.findUnique({ where: { groupId_userId: { groupId, userId } } })
    ) {
      throw c.conflict("You're already in this group.");
    }
    if (g.status !== 'forming') throw c.conflict('This group is no longer open');
    const members = (await c.membersByGroup([groupId])).get(groupId);
    if (members.length === 0) throw c.conflict('This group is no longer open');
    const req = await createRequest(userId, {
      pickupNodeId: g.pickupNodeId,
      dropNodeId: farthestOf(members).dropNodeId,
      pickupTime: g.pickupAt.toISOString(),
    });
    return join(userId, {
      rideRequestId: req.id,
      memberRideRequestIds: [req.id, ...members.map((m) => m.requestId)],
    });
  }

  // ── Leave ─────────────────────────────────────────────────────────────────────────────
  // Drop the rider (and their request), re-split the fare for whoever is left, and reopen
  // the group if it had been full.
  async function leave(userId, groupId) {
    const graph = await c.loadGraph();
    await p.transaction(async (tx, emit) => {
      const g = await c.lockGroup(tx, groupId);
      const mine =
        g &&
        (await tx.ridesGroupMember.findUnique({ where: { groupId_userId: { groupId, userId } } }));
      if (!mine) throw c.notFound('Group not found');
      const locked = c.leaveLockedReason(g);
      if (locked) throw c.conflict(locked);
      if (mine.boardedAt) throw c.conflict("You've already boarded this ride.");
      await tx.ridesGroupMember.delete({ where: { id: mine.id } });
      await tx.ridesRequest.update({
        where: { id: mine.requestId },
        data: { status: 'cancelled', groupId: null },
      });
      const rest = (await c.membersByGroup([groupId], tx)).get(groupId);
      if (rest.length === 0) {
        await tx.ridesGroup.update({ where: { id: groupId }, data: { status: 'cancelled' } });
        return;
      }
      const f = c.fareBreakup(graph, g.pickupNodeId, rest.map(riderOf), null);
      for (const [i, m] of rest.entries()) {
        if (m.fareSharePaise !== f.members[i].fareSharePaise) {
          await tx.ridesGroupMember.update({
            where: { id: m.id },
            data: { fareSharePaise: f.members[i].fareSharePaise },
          });
        }
      }
      await tx.ridesGroup.update({
        where: { id: groupId },
        data: {
          totalFarePaise: f.totalFarePaise,
          ...(g.status === 'confirmed' && { status: 'forming' }),
        },
      });
      const name = (
        await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } })
      ).name;
      await emit({
        recipients: rest.map((m) => m.userId),
        actorId: userId,
        module: 'rides',
        type: 'rides.member_left',
        payload: { ...rideInfo(graph, g), memberName: name },
      });
    });
    return { left: true, groupId };
  }

  // ── Boarding, payment, preferences for one ride ───────────────────────────────────────
  /**
   * Marks a member boarded (rider code checked by the caller) inside `tx`. The first boarding
   * puts the ride's distance on the auto's odometer, which is what makes servicing fall due.
   */
  async function markBoarded(tx, emit, g, member, graph) {
    if (member.boardedAt) return false;
    const before = await tx.ridesGroupMember.count({
      where: { groupId: g.id, boardedAt: { not: null } },
    });
    await tx.ridesGroupMember.update({ where: { id: member.id }, data: { boardedAt: new Date() } });
    if (g.vehicleId && before === 0) {
      const members = (await c.membersByGroup([g.id], tx)).get(g.id);
      const distance = c.fareBreakup(graph, g.pickupNodeId, members.map(riderOf), null).distanceM;
      await tx.ridesVehicle.update({
        where: { id: g.vehicleId },
        data: { drivenM: { increment: distance } },
      });
    }
    const driver =
      g.vehicleId &&
      (await tx.ridesDriver.findUnique({
        where: { vehicleId: g.vehicleId },
        select: { userId: true },
      }));
    if (driver) {
      const name = (
        await tx.user.findUniqueOrThrow({ where: { id: member.userId }, select: { name: true } })
      ).name;
      await emit({
        recipients: driver.userId,
        actorId: null,
        module: 'rides',
        type: 'rides.rider_boarded',
        payload: { ...rideInfo(graph, g), riderFirstName: c.firstNameOf(name) },
      });
    }
    return true;
  }

  // The rider gives the driver their permanent rider code; entering it here boards them.
  async function board(userId, groupId, body) {
    const { code } = R.BoardRequest.parse(body);
    const profile = await c.ensureProfile(userId);
    const graph = await c.loadGraph();
    await p.transaction(async (tx, emit) => {
      const g = await c.lockGroup(tx, groupId);
      const mine =
        g &&
        (await tx.ridesGroupMember.findUnique({ where: { groupId_userId: { groupId, userId } } }));
      if (!mine) throw c.notFound('Group not found');
      c.assertNotSuspended(profile);
      if (g.status === 'cancelled') throw c.conflict('This ride was cancelled.');
      if (code !== profile.riderCode) throw c.badRequest('That rider code does not match');
      await markBoarded(tx, emit, g, mine, graph);
    });
    return getGroup(userId, groupId);
  }

  // The rider completed the payment step (no real gateway): recorded so an unpaid booking
  // can be resumed from anywhere.
  async function pay(userId, groupId, body) {
    const { method } = R.PayRequest.parse(body);
    const mine = await memberOrNotFound(groupId, userId);
    const g = await prisma.ridesGroup.findUniqueOrThrow({ where: { id: groupId } });
    if (g.kind !== 'auto') throw c.badRequest('Public-transport groups have nothing to pay for.');
    if (g.status === 'cancelled') throw c.conflict('This ride was cancelled.');
    if (!g.vehicleId)
      throw c.conflict('Confirm the booking first - a driver is assigned before payment.');
    await prisma.ridesGroupMember.updateMany({
      where: { id: mine.id, paidAt: null },
      data: { paidAt: new Date(), paymentMethod: method },
    });
    return getGroup(userId, groupId);
  }

  // "Allow any driver" for this ride: waives only the caller's own female-driver preference.
  async function setDriverPreference(userId, groupId, body) {
    const { allowAnyDriver } = R.DriverPreferenceRequest.parse(body);
    await p.transaction(async (tx) => {
      const g = await c.lockGroup(tx, groupId);
      const mine =
        g &&
        (await tx.ridesGroupMember.findUnique({ where: { groupId_userId: { groupId, userId } } }));
      if (!mine) throw c.notFound('Group not found');
      if (g.vehicleId) throw c.conflict('A driver is already assigned to this ride.');
      await tx.ridesGroupMember.update({ where: { id: mine.id }, data: { allowAnyDriver } });
    });
    return getGroup(userId, groupId);
  }

  // Where and how a public-transport group meets. Any member can set it.
  async function setMeeting(userId, groupId, body) {
    const { meetingPoint, transitMode } = R.MeetingRequest.parse(body);
    await memberOrNotFound(groupId, userId);
    const g = await prisma.ridesGroup.findUniqueOrThrow({ where: { id: groupId } });
    if (g.kind !== 'transit')
      throw c.badRequest('Only public-transport groups have meeting details');
    await prisma.ridesGroup.update({
      where: { id: groupId },
      data: { meetingPoint: meetingPoint || null, transitMode: transitMode ?? null },
    });
    return getGroup(userId, groupId);
  }

  // ── Chat ──────────────────────────────────────────────────────────────────────────────
  const chatView = (m, userId) => ({
    id: m.id,
    groupId: m.groupId,
    message: m.message,
    createdAt: m.createdAt.toISOString(),
    userId: m.userId,
    name: m.user.user.name,
    initials: c.initialsOf(m.user.user.name),
    isYou: m.userId === userId,
  });
  const chatInclude = { user: { select: { user: { select: { name: true } } } } };

  // Newest first, cursor-paged (the screen reverses a page).
  async function listChat(userId, groupId, query) {
    const { cursor, limit } = c.pageQuery(query);
    await memberOrNotFound(groupId, userId);
    const rows = await prisma.ridesChatMessage.findMany({
      where: { groupId, ...c.beforeDesc('createdAt', cursor) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: chatInclude,
    });
    return c.toPage(
      rows,
      limit,
      (m) => m.createdAt,
      (m) => chatView(m, userId),
    );
  }

  // Stored, then pushed to the other members' open streams as `rides.chat` (not the feed).
  async function postChat(userId, groupId, body) {
    const { message } = R.ChatPostRequest.parse(body);
    await memberOrNotFound(groupId, userId);
    const saved = await prisma.ridesChatMessage.create({
      data: { groupId, userId, message },
      include: chatInclude,
    });
    const others = await prisma.ridesGroupMember.findMany({
      where: { groupId, userId: { not: userId } },
      select: { userId: true },
    });
    const view = chatView(saved, userId);
    p.pushEvent(
      others.map((o) => o.userId),
      'rides.chat',
      { ...view, isYou: false },
    );
    return view;
  }

  // ── Vehicle feedback and safety reports (members of the ride only) ────────────────────
  // Repeated complaints flag the vehicle for inspection; enough of them take it off the road.
  async function addFeedback(userId, groupId, body) {
    const input = R.FeedbackRequest.parse(body);
    await memberOrNotFound(groupId, userId);
    const g = await prisma.ridesGroup.findUniqueOrThrow({ where: { id: groupId } });
    if (!g.vehicleId) throw c.badRequest('No driver has been assigned to this ride yet');
    const vehicle = await p.transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM rides_vehicles WHERE id = ${g.vehicleId}::uuid FOR UPDATE`;
      const exists = await tx.ridesVehicleFeedback.findUnique({
        where: { groupId_userId: { groupId, userId } },
      });
      if (exists) throw c.conflict('You already rated this ride');
      await tx.ridesVehicleFeedback.create({
        data: {
          vehicleId: g.vehicleId,
          groupId,
          userId,
          cleanliness: input.cleanliness,
          condition: input.condition,
          tags: input.tags ?? [],
        },
      });
      return services.vehicles.applyComplaintRules(tx, g.vehicleId);
    });
    return { vehicle: { plateNumber: vehicle.plateNumber, status: vehicle.status } };
  }

  // Report something that happened on a ride the student was on.
  async function fileReport(userId, groupId, body) {
    const input = R.ReportRequest.parse(body);
    await memberOrNotFound(groupId, userId);
    if (
      input.aboutUserId &&
      !(await prisma.ridesGroupMember.findUnique({
        where: { groupId_userId: { groupId, userId: input.aboutUserId } },
      }))
    ) {
      throw c.badRequest('That student was not on this ride');
    }
    const g = await prisma.ridesGroup.findUniqueOrThrow({ where: { id: groupId } });
    if (input.aboutVehicle && !g.vehicleId)
      throw c.badRequest('No vehicle was assigned to this ride');
    const r = await prisma.ridesSafetyReport.create({
      data: {
        reporterId: userId,
        groupId,
        aboutUserId: input.aboutUserId ?? null,
        aboutVehicleId: input.aboutVehicle ? g.vehicleId : null,
        category: input.category,
        message: input.message,
      },
    });
    return { id: r.id, status: r.status, at: r.createdAt.toISOString() };
  }

  return {
    me,
    updatePreferences,
    listNodes,
    createRequest,
    findMatches,
    listAvailable,
    listMine,
    getGroup,
    join,
    joinById,
    leave,
    board,
    markBoarded,
    pay,
    setDriverPreference,
    setMeeting,
    listChat,
    postChat,
    addFeedback,
    fileReport,
    riderOf,
    rideInfo,
    memberOrNotFound,
  };
};
