// Drivers: assignment of a group's auto, the driver portal (availability, offers, trip steps,
// documents) and what riders see about their driver. Ported from Module B's groups.service
// getDriver, drivers/availability.js and drivers/drivers.service.js. Drivers are platform
// users with role `driver`; sign-in is the platform's.
const { randomInt } = require('node:crypto');
const fare = require('../lib/fare');
const { driverRequirement } = require('../lib/genderRules');
const { verificationOf, documentStatus } = require('../lib/verification');
const { isRoadworthy } = require('../lib/vehicleStatus');

module.exports = function drivers(c, services) {
  const { p, cfg, prisma } = c;
  const R = p.contracts.rides;

  // No driver satisfies the group: say why, and whether THIS student may waive it. Never a
  // silent fallback to a driver nobody agreed to, and never who asked for a female driver.
  function noDriverError(requirement, userId, freeCount) {
    if (freeCount === 0 || !requirement.female) {
      return c.fail(
        409,
        'NO_DRIVER_AVAILABLE',
        'No drivers are available right now — please wait a few minutes and try again.',
        { canWaive: false },
      );
    }
    const youAsked = requirement.requestedBy.includes(userId);
    const canWaive = !requirement.womenOnly && youAsked;
    let message;
    if (requirement.womenOnly) {
      message =
        'No female drivers available right now. This is a women-only group, so only a female driver will be assigned — please wait a few minutes and try again.';
    } else if (youAsked) {
      message = 'No female drivers available right now — wait, or allow any driver?';
    } else {
      message =
        'A female driver will be assigned to this ride, and none is available right now — please wait a few minutes and try again.';
    }
    return c.fail(409, 'NO_MATCHING_DRIVER', message, {
      canWaive,
      womenOnly: requirement.womenOnly,
    });
  }

  /**
   * Picks and stores a driver for a locked group inside `tx`. Candidates: online auto drivers
   * with valid documents, a roadworthy vehicle that isn't busy on another live ride, who have
   * not declined this group; female only when the group requires it. Candidate vehicle rows are
   * locked (SKIP LOCKED: one being assigned elsewhere right now is passed over), and the
   * exclusion constraint rides_groups_vehicle_busy is the last word. Returns null or throws.
   */
  async function assignInTx(
    tx,
    emit,
    g,
    members,
    graph,
    { userId = null, throwIfNone = true } = {},
  ) {
    const requirement = driverRequirement(
      g,
      members.map((m) => ({ userId: m.userId, user: m.profile, allowAnyDriver: m.allowAnyDriver })),
    );
    const now = new Date();
    const locked = await tx.$queryRaw`
      SELECT v.id FROM rides_vehicles v
      JOIN rides_drivers d ON d.vehicle_id = v.id
      WHERE d.online AND d.kind = 'auto'
        AND NOT EXISTS (SELECT 1 FROM rides_driver_trips t
                        WHERE t.group_id = ${g.id}::uuid AND t.driver_id = d.user_id AND t.status = 'declined')
      ORDER BY v.id
      FOR UPDATE OF v SKIP LOCKED`;
    const vehicleIds = locked.map((r) => r.id);
    const [vehicles, busy, docs] = await Promise.all([
      tx.ridesVehicle.findMany({
        where: { id: { in: vehicleIds } },
        include: { driver: { include: { user: { select: { name: true } } } } },
      }),
      tx.ridesGroup.findMany({
        where: {
          vehicleId: { in: vehicleIds },
          id: { not: g.id },
          status: { not: 'cancelled' },
          pickupAt: { gt: new Date(now.getTime() - c.busyMs) },
        },
        select: { vehicleId: true },
      }),
      tx.ridesDriverDocument.findMany({
        where: { driver: { vehicleId: { in: vehicleIds } } },
        orderBy: [{ uploadedAt: 'desc' }, { id: 'desc' }],
      }),
    ]);
    const busyIds = new Set(busy.map((b) => b.vehicleId));
    const docsBy = new Map();
    for (const d of docs) docsBy.set(d.driverId, [...(docsBy.get(d.driverId) ?? []), d]);
    const free = vehicles.filter(
      (v) =>
        v.driver &&
        !busyIds.has(v.id) &&
        isRoadworthy(v, now.getTime()) &&
        verificationOf(docsBy.get(v.driver.userId) ?? [], now.getTime()).verified,
    );
    const eligible = requirement.female ? free.filter((v) => v.driver.gender === 'female') : free;
    if (eligible.length === 0) {
      if (throwIfNone) throw noDriverError(requirement, userId, free.length);
      return null;
    }
    const pick = eligible[randomInt(eligible.length)];
    const { min, max } = cfg.drivers.etaMinutes;
    const updated = await tx.ridesGroup.updateMany({
      where: { id: g.id, vehicleId: null },
      data: {
        vehicleId: pick.id,
        driverAssignedAt: now,
        etaMinutes: min + randomInt(max - min + 1),
        driverFemaleRequested: requirement.female,
        driverAcceptedAt: null,
      },
    });
    if (updated.count === 0) return null;
    const info = services.riders.rideInfo(graph, g);
    await emit({
      recipients: members.map((m) => m.userId),
      actorId: null,
      module: 'rides',
      type: 'rides.driver_assigned',
      payload: { ...info, driverName: pick.driver.user.name, plateNumber: pick.plateNumber },
    });
    await emit({
      recipients: pick.driver.userId,
      actorId: null,
      module: 'rides',
      type: 'rides.ride_offered',
      payload: info,
    });
    return pick.id;
  }

  // "Verified vehicle · inspected <date>" on the driver card: an approved self-inspection that
  // is still current, or the driver's approved inspection certificate.
  async function riderBadge(vehicle, driverId) {
    const [inspection, certs] = await Promise.all([
      prisma.ridesVehicleInspection.findFirst({
        where: { vehicleId: vehicle.id, status: 'approved' },
        orderBy: { reviewedAt: 'desc' },
      }),
      prisma.ridesDriverDocument.findMany({
        where: { driverId, type: 'inspection_certificate' },
        orderBy: [{ uploadedAt: 'desc' }, { id: 'desc' }],
      }),
    ]);
    const now = Date.now();
    const inspectionCurrent =
      inspection?.reviewedAt &&
      now - inspection.reviewedAt.getTime() <= cfg.vehicles.inspectionValidDays * 86_400_000;
    const cert = verificationOf(certs, now).documents.find(
      (d) => d.type === 'inspection_certificate',
    );
    const certOn = cert.cleared
      ? (certs.find((d) => d.status === 'verified')?.reviewedAt ?? null)
      : null;
    const dates = [inspectionCurrent ? inspection.reviewedAt : null, certOn]
      .filter(Boolean)
      .sort((a, b) => a - b);
    const serviceDays = Math.floor((now - vehicle.lastServiceAt.getTime()) / 86_400_000);
    return {
      verified: Boolean(inspectionCurrent) || Boolean(certOn),
      inspectedOn: (dates.pop() ?? inspection?.reviewedAt ?? null)?.toISOString() ?? null,
      registrationNumber: vehicle.registrationNumber,
      serviceOverdue:
        serviceDays > cfg.vehicles.serviceDueDays ||
        vehicle.drivenM - vehicle.lastServiceM > cfg.vehicles.serviceDueMetres,
    };
  }

  /**
   * The group's driver: picked once (first member to ask), stored on the group, and returned
   * as-is to every member. The group row lock makes two members asking at once get the same one.
   */
  async function getDriver(userId, groupId) {
    const graph = await c.loadGraph();
    const vehicleId = await p.transaction(async (tx, emit) => {
      const g = await c.lockGroup(tx, groupId);
      const members = g && (await c.membersByGroup([groupId], tx)).get(groupId);
      if (!members?.some((m) => m.userId === userId)) throw c.notFound('Group not found');
      if (g.kind !== 'auto')
        throw c.badRequest('Public-transport groups book no auto, so they have no driver.');
      if (g.status === 'cancelled') throw c.conflict('This ride was cancelled.');
      if (g.vehicleId) return g.vehicleId;
      try {
        return await assignInTx(tx, emit, g, members, graph, { userId });
      } catch (err) {
        if (String(err?.message).includes('rides_groups_vehicle_busy')) {
          throw c.fail(
            409,
            'NO_DRIVER_AVAILABLE',
            'No drivers are available right now — please wait a few minutes and try again.',
            { canWaive: false },
          );
        }
        throw err;
      }
    });
    const [g, vehicle] = await Promise.all([
      prisma.ridesGroup.findUniqueOrThrow({ where: { id: groupId } }),
      prisma.ridesVehicle.findUniqueOrThrow({
        where: { id: vehicleId },
        include: { driver: { include: { user: { select: { name: true } } } } },
      }),
    ]);
    const arrivesAt = new Date(g.driverAssignedAt.getTime() + g.etaMinutes * 60_000);
    return {
      name: vehicle.driver?.user.name ?? 'Driver',
      ratingTenths: vehicle.driver?.ratingTenths ?? null,
      vehicle: vehicle.model,
      plateNumber: vehicle.plateNumber,
      arrivesAt: arrivesAt.toISOString(),
      etaMinutes: Math.max(0, Math.ceil((arrivesAt.getTime() - Date.now()) / 60_000)),
      // Shown as "Female driver, as requested" - only when someone asked for it.
      femaleDriverAsRequested: g.driverFemaleRequested,
      accepted: Boolean(g.driverAcceptedAt),
      vehicleCheck: await riderBadge(vehicle, vehicle.driver?.userId ?? null),
    };
  }

  // ── The driver portal ─────────────────────────────────────────────────────────────────
  async function driverOf(userId, db = prisma) {
    const d = await db.ridesDriver.findUnique({
      where: { userId },
      include: { vehicle: true, user: { select: { name: true } } },
    });
    if (!d)
      throw c.notFound('Your driver profile is not set up yet. Contact the transport office.');
    return d;
  }

  // Verification, and the automatic switch-off when it lapses: a driver whose documents
  // aren't cleared is never left online.
  async function verificationFor(d) {
    const docs = await prisma.ridesDriverDocument.findMany({
      where: { driverId: d.userId },
      orderBy: [{ uploadedAt: 'desc' }, { id: 'desc' }],
    });
    const verification = verificationOf(docs);
    if (!verification.verified && d.online) {
      await prisma.ridesDriver.update({ where: { userId: d.userId }, data: { online: false } });
      d.online = false;
    }
    return verification;
  }

  async function me(userId) {
    const d = await driverOf(userId);
    const verification = await verificationFor(d);
    const [rides, ratingsCount] = await Promise.all([
      prisma.ridesDriverTrip.count({ where: { driverId: userId, status: 'completed' } }),
      d.vehicleId ? prisma.ridesVehicleFeedback.count({ where: { vehicleId: d.vehicleId } }) : 0,
    ]);
    const v = d.vehicle;
    return {
      id: d.userId,
      name: d.user.name,
      initials: c.initialsOf(d.user.name),
      driverCode: d.driverCode,
      kind: d.kind,
      online: d.online,
      vehicle: v
        ? {
            id: v.id,
            model: v.model,
            plateNumber: v.plateNumber,
            registrationNumber: v.registrationNumber,
            colour: v.colour,
            seats: v.seats,
          }
        : null,
      verification,
      rating: { ratingTenths: d.ratingTenths, rides, ratingsCount },
    };
  }

  async function updateVehicle(userId, body) {
    const { model, colour, seats } = R.DriverVehicleRequest.parse(body);
    const d = await driverOf(userId);
    if (!d.vehicleId) throw c.conflict('No vehicle is linked to your account.');
    await prisma.ridesVehicle.update({
      where: { id: d.vehicleId },
      data: { model, colour, seats },
    });
    return me(userId);
  }

  async function setOnline(userId, body) {
    const { online } = R.AvailabilityRequest.parse(body);
    const d = await driverOf(userId);
    if (online) {
      const v = await verificationFor(d);
      if (!v.verified)
        throw c.conflict(
          v.message || 'Your documents need to be verified before you can go online.',
        );
      if (!d.vehicleId) throw c.conflict('No vehicle is linked to your account.');
    }
    await prisma.ridesDriver.update({ where: { userId }, data: { online } });
    return me(userId);
  }

  // A ride as the driver sees it: route, time, rider first names, fare and their payout.
  function describeRide(graph, g, members, trip) {
    const f = c.fareBreakup(graph, g.pickupNodeId, members.map(services.riders.riderOf), null);
    const split = fare.payoutSplit(f.totalFarePaise, cfg.drivers.payoutPercent);
    const far = members.reduce((a, b) => (b.distanceM > a.distanceM ? b : a));
    return {
      groupId: g.id,
      pickupName: graph.stop(g.pickupNodeId).name,
      dropName: graph.stop(far.dropNodeId).name,
      drops: [...new Set(members.map((m) => graph.stop(m.dropNodeId).name))],
      pickupTime: g.pickupAt.toISOString(),
      womenOnly: g.womenOnly,
      riders: members.map((m) => ({
        firstName: c.firstNameOf(m.name),
        dropName: graph.stop(m.dropNodeId).name,
        boarded: Boolean(m.boardedAt),
      })),
      distanceM: f.distanceM,
      totalFarePaise: f.totalFarePaise,
      payoutPaise: split.payoutPaise,
      platformFeePaise: split.platformFeePaise,
      status: trip?.status ?? 'offered',
      acceptedAt: trip?.acceptedAt?.toISOString() ?? null,
      completedAt: trip?.completedAt?.toISOString() ?? null,
    };
  }

  async function describeRides(groups, tripsByGroup) {
    const [members, graph] = await Promise.all([
      c.membersByGroup(groups.map((g) => g.id)),
      c.loadGraph(),
    ]);
    return groups
      .filter((g) => members.get(g.id).length > 0)
      .map((g) => describeRide(graph, g, members.get(g.id), tripsByGroup.get(g.id) ?? null));
  }

  // Rides offered to this driver's vehicle that they haven't answered, soonest first.
  async function listOffers(userId, query) {
    const { cursor, limit } = c.pageQuery(query);
    const d = await driverOf(userId);
    if (!d.vehicleId) return { items: [], nextCursor: null };
    const groups = await prisma.ridesGroup.findMany({
      where: {
        AND: [
          { vehicleId: d.vehicleId, driverAcceptedAt: null, status: { not: 'cancelled' } },
          { pickupAt: { gt: new Date(Date.now() - c.busyMs) } },
          { trips: { none: { driverId: userId } } },
          c.afterAsc('pickupAt', cursor),
        ],
      },
      orderBy: [{ pickupAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
    });
    const page = c.toPage(
      groups,
      limit,
      (g) => g.pickupAt,
      (g) => g,
    );
    return { items: await describeRides(page.items, new Map()), nextCursor: page.nextCursor };
  }

  // Every trip this driver accepted, newest first, plus totals over all completed trips.
  async function listTrips(userId, query) {
    const { cursor, limit } = c.pageQuery(query);
    await driverOf(userId);
    const trips = await prisma.ridesDriverTrip.findMany({
      where: {
        driverId: userId,
        status: { not: 'declined' },
        ...c.beforeDesc('createdAt', cursor),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: { group: true },
    });
    const page = c.toPage(
      trips,
      limit,
      (t) => t.createdAt,
      (t) => t,
    );
    const [[summary], items] = await Promise.all([
      prisma.$queryRaw`
        SELECT count(*)::int AS "completedTrips",
               COALESCE(sum((2 * g.total_fare_paise * ${cfg.drivers.payoutPercent} + 100) / 200), 0)::int AS "earnedPaise"
        FROM rides_driver_trips t JOIN rides_groups g ON g.id = t.group_id
        WHERE t.driver_id = ${userId}::uuid AND t.status = 'completed'`,
      describeRides(
        page.items.map((t) => t.group),
        new Map(page.items.map((t) => [t.groupId, t])),
      ),
    ]);
    return { items, nextCursor: page.nextCursor, summary };
  }

  async function tripView(userId, groupId) {
    const trip = await prisma.ridesDriverTrip.findUnique({
      where: { groupId_driverId: { groupId, driverId: userId } },
      include: { group: true },
    });
    if (!trip || trip.status === 'declined') throw c.notFound('Trip not found');
    return (await describeRides([trip.group], new Map([[groupId, trip]])))[0];
  }

  async function assertVerified(d) {
    const v = await verificationFor(d);
    if (!v.verified)
      throw c.conflict(
        v.message || 'Your documents need to be verified before you can take rides.',
      );
  }

  // Exactly one driver wins a group: a conditional update on the group row (the one it is
  // offered to, not yet accepted). Anyone else, or a second click, gets 409.
  async function accept(userId, groupId) {
    const d = await driverOf(userId);
    await assertVerified(d);
    const graph = await c.loadGraph();
    await p.transaction(async (tx, emit) => {
      const g = await tx.ridesGroup.findUnique({ where: { id: groupId } });
      if (!g) throw c.notFound('Ride not found');
      // Women-only groups are only offered to female drivers; this is the backstop.
      if (g.womenOnly && d.gender !== 'female')
        throw c.fail(403, 'FORBIDDEN', 'Women-only rides go to female drivers only');
      if (!d.vehicleId) throw c.conflict('This ride is no longer offered to you');
      const won = await tx.ridesGroup.updateMany({
        where: {
          id: groupId,
          vehicleId: d.vehicleId,
          driverAcceptedAt: null,
          status: { not: 'cancelled' },
        },
        data: { driverAcceptedAt: new Date() },
      });
      if (won.count === 0) throw c.conflict('This ride is no longer offered to you');
      // An earlier trip of this driver for this group (cancelled or unassigned by an admin) is
      // reused: one row per (group, driver) stays the rule (P7-003).
      const accepted = { vehicleId: d.vehicleId, status: 'accepted', acceptedAt: new Date() };
      await tx.ridesDriverTrip.upsert({
        where: { groupId_driverId: { groupId, driverId: userId } },
        create: { groupId, driverId: userId, ...accepted },
        update: {
          ...accepted,
          declinedAt: null,
          headingAt: null,
          startedAt: null,
          completedAt: null,
        },
      });
      const members = await tx.ridesGroupMember.findMany({
        where: { groupId },
        select: { userId: true },
      });
      await emit({
        recipients: members.map((m) => m.userId),
        actorId: userId,
        module: 'rides',
        type: 'rides.driver_accepted',
        payload: { ...services.riders.rideInfo(graph, g), driverName: d.user.name },
      });
    });
    return tripView(userId, groupId);
  }

  // Declining hands the ride straight to another free driver (same rules as a booking), so
  // the riders are never left without one if anyone is free.
  async function decline(userId, groupId) {
    const d = await driverOf(userId);
    const graph = await c.loadGraph();
    await p.transaction(async (tx, emit) => {
      const g = await c.lockGroup(tx, groupId);
      if (!g) throw c.notFound('Ride not found');
      if (!d.vehicleId || g.vehicleId !== d.vehicleId || g.driverAcceptedAt)
        throw c.conflict('This ride is no longer offered to you');
      const declined = { vehicleId: d.vehicleId, status: 'declined', declinedAt: new Date() };
      await tx.ridesDriverTrip.upsert({
        where: { groupId_driverId: { groupId, driverId: userId } },
        create: { groupId, driverId: userId, ...declined },
        update: declined,
      });
      const cleared = await tx.ridesGroup.update({
        where: { id: groupId },
        data: {
          vehicleId: null,
          driverAssignedAt: null,
          etaMinutes: null,
          driverFemaleRequested: false,
        },
      });
      const members = (await c.membersByGroup([groupId], tx)).get(groupId);
      // Nobody free: the riders see it the next time they look.
      await assignInTx(tx, emit, cleared, members, graph, { throwIfNone: false });
    });
    return { declined: true };
  }

  // A trip only moves while its group is live and still holds this trip's vehicle (P7-003).
  const rideClosed = () =>
    c.fail(409, 'RIDE_CLOSED', 'This ride was cancelled, completed or given to another driver');
  const assertLive = (g, trip) => {
    if (['cancelled', 'completed'].includes(g.status) || g.vehicleId !== trip.vehicleId)
      throw rideClosed();
  };

  // One trip step: only from the listed states (conditional update, so a double click is 409).
  async function tripStep(userId, groupId, from, to, after) {
    await driverOf(userId);
    const graph = await c.loadGraph();
    await p.transaction(async (tx, emit) => {
      const locked = await c.lockGroup(tx, groupId);
      const current =
        locked &&
        (await tx.ridesDriverTrip.findUnique({
          where: { groupId_driverId: { groupId, driverId: userId } },
        }));
      if (current) assertLive(locked, current);
      const stamp = { heading: 'headingAt', started: 'startedAt', completed: 'completedAt' }[to];
      const moved = await tx.ridesDriverTrip.updateMany({
        where: { groupId, driverId: userId, status: { in: from } },
        data: { status: to, [stamp]: new Date() },
      });
      if (moved.count === 0) throw c.conflict('That step is not available for this trip right now');
      const g = await tx.ridesGroup.findUniqueOrThrow({ where: { id: groupId } });
      await after(tx, emit, g, services.riders.rideInfo(graph, g));
    });
    return tripView(userId, groupId);
  }

  const headToPickup = (userId, groupId) =>
    tripStep(userId, groupId, ['accepted'], 'heading', async (tx, emit, g, info) => {
      const [members, driver] = await Promise.all([
        tx.ridesGroupMember.findMany({ where: { groupId }, select: { userId: true } }),
        tx.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } }),
      ]);
      await emit({
        recipients: members.map((m) => m.userId),
        actorId: userId,
        module: 'rides',
        type: 'rides.driver_heading',
        payload: { ...info, driverName: driver.name },
      });
    });

  const complete = (userId, groupId) =>
    tripStep(userId, groupId, ['started'], 'completed', async (tx, emit, g, info) => {
      await tx.ridesGroup.update({ where: { id: groupId }, data: { status: 'completed' } });
      await tx.ridesRequest.updateMany({
        where: { groupId, status: 'matched' },
        data: { status: 'completed' },
      });
      const { payoutPaise } = fare.payoutSplit(g.totalFarePaise, cfg.drivers.payoutPercent);
      await emit({
        recipients: userId,
        actorId: null,
        module: 'rides',
        type: 'rides.trip_completed',
        payload: { ...info, payoutPaise },
      });
    });

  // The rider reads out the 6-digit code from their profile; a match boards them (exactly as
  // if they had boarded themselves) and starts the trip.
  async function boardRider(userId, groupId, body) {
    const { code } = R.BoardRequest.parse(body);
    await driverOf(userId);
    const graph = await c.loadGraph();
    const rider = await p.transaction(async (tx, emit) => {
      const g = await c.lockGroup(tx, groupId);
      const trip =
        g &&
        (await tx.ridesDriverTrip.findUnique({
          where: { groupId_driverId: { groupId, driverId: userId } },
        }));
      if (!trip || !['accepted', 'heading', 'started'].includes(trip.status))
        throw c.conflict('Accept the ride before verifying riders');
      assertLive(g, trip);
      const members = (await c.membersByGroup([groupId], tx)).get(groupId);
      const match = members.find((m) => m.profile.riderCode === code);
      if (!match) throw c.badRequest("That code doesn't match any rider in this group");
      if (match.boardedAt) throw c.conflict(`${c.firstNameOf(match.name)} is already verified`);
      await services.riders.markBoarded(tx, emit, g, match, graph);
      if (trip.status !== 'started') {
        await tx.ridesDriverTrip.update({
          where: { id: trip.id },
          data: { status: 'started', startedAt: new Date() },
        });
      }
      return c.firstNameOf(match.name);
    });
    return { rider, trip: await tripView(userId, groupId) };
  }

  // Attach an uploaded file (POST /api/files/rides.driver_document) as a document.
  async function addDocument(userId, body) {
    const { type, fileId } = R.DriverDocumentRequest.parse(body);
    await driverOf(userId);
    const file = await prisma.file.findFirst({
      where: { id: fileId, ownerId: userId, purpose: 'rides.driver_document', deletedAt: null },
    });
    if (!file) throw c.badRequest('Upload the file first (it must be your own PDF, JPEG or PNG)');
    await prisma.ridesDriverDocument.create({ data: { driverId: userId, type, fileId } });
    return me(userId);
  }

  // Dashboard: online, document status, completed trips and payout today (UTC day).
  async function dashboardSummary(userId) {
    const d = await driverOf(userId);
    const verification = await verificationFor(d);
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const [today] = await prisma.$queryRaw`
      SELECT count(*)::int AS "tripsToday",
             COALESCE(sum((2 * g.total_fare_paise * ${cfg.drivers.payoutPercent} + 100) / 200), 0)::int AS "payoutTodayPaise"
      FROM rides_driver_trips t JOIN rides_groups g ON g.id = t.group_id
      WHERE t.driver_id = ${userId}::uuid AND t.status = 'completed' AND t.completed_at >= ${start}`;
    return {
      kind: 'driver',
      online: d.online,
      documentStatus: documentStatus(verification),
      ...today,
    };
  }

  return {
    assignInTx,
    getDriver,
    me,
    updateVehicle,
    setOnline,
    listOffers,
    listTrips,
    accept,
    decline,
    headToPickup,
    complete,
    boardRider,
    addDocument,
    dashboardSummary,
    verificationFor,
    driverOf,
  };
};
