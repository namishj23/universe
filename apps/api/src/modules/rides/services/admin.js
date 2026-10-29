// The rides admin panel: live rides board, cancel and unassign, rider suspension, safety
// reports, notices and driver document review. Ported from Module B's admin.service (which
// read the mock store directly); every action writes a platform audit entry in its
// transaction, and its activity events go out after commit.
const { verificationOf } = require('../lib/verification');

module.exports = function admin(c, services) {
  const { p, prisma } = c;
  const R = p.contracts.rides;
  const audit = (tx, adminId, action, targetType, targetId, metadata, requestId) =>
    p.audit.record(tx, { actorId: adminId, action, targetType, targetId, metadata, requestId });

  // ── Live rides board ──────────────────────────────────────────────────────────────────
  // Every live group (or every one, with includePast), soonest first, with who is riding,
  // whether they boarded and paid, and the assigned auto. Members and vehicles are batched.
  async function rides(query) {
    const q = R.AdminRidesQuery.parse(query);
    const now = new Date();
    const groups = await prisma.ridesGroup.findMany({
      where: {
        AND: [
          { status: { not: 'cancelled' }, members: { some: {} } },
          q.includePast === 'true' ? {} : { pickupAt: { gte: now } },
          c.afterAsc('pickupAt', q.cursor),
        ],
      },
      orderBy: [{ pickupAt: 'asc' }, { id: 'asc' }],
      take: q.limit + 1,
      include: {
        vehicle: { include: { driver: { include: { user: { select: { name: true } } } } } },
      },
    });
    const page = groups.slice(0, q.limit);
    const [members, graph] = await Promise.all([
      c.membersByGroup(page.map((g) => g.id)),
      c.loadGraph(),
    ]);
    return c.toPage(
      groups,
      q.limit,
      (g) => g.pickupAt,
      (g) => {
        const ms = members.get(g.id);
        const far = ms.reduce((a, b) => (b.distanceM > a.distanceM ? b : a));
        return {
          id: g.id,
          kind: g.kind,
          status: g.status,
          womenOnly: g.womenOnly,
          pickupName: graph.stop(g.pickupNodeId).name,
          dropName: graph.stop(far.dropNodeId).name,
          pickupTime: g.pickupAt.toISOString(),
          isPast: g.pickupAt < now,
          totalFarePaise: g.totalFarePaise,
          driver: g.vehicle
            ? {
                name: g.vehicle.driver?.user.name ?? 'Driver',
                plateNumber: g.vehicle.plateNumber,
                accepted: Boolean(g.driverAcceptedAt),
              }
            : null,
          members: ms.map((m) => ({
            userId: m.userId,
            name: m.name,
            dropName: graph.stop(m.dropNodeId).name,
            fareSharePaise: m.fareSharePaise,
            boarded: Boolean(m.boardedAt),
            paid: Boolean(m.paidAt),
          })),
        };
      },
    );
  }

  // Call off a ride: the group is cancelled and every rider's request with it, so nobody is
  // left thinking they have a seat. Members hear it through the activity feed.
  async function cancelRide(adminUser, groupId, body, requestId) {
    const { reason } = R.ReasonRequest.parse(body);
    const graph = await c.loadGraph();
    return p.transaction(async (tx, emit) => {
      const g = await c.lockGroup(tx, groupId);
      if (!g) throw c.notFound('Group not found');
      if (g.status === 'cancelled') throw c.conflict('This ride is already cancelled');
      const members = await tx.ridesGroupMember.findMany({
        where: { groupId },
        select: { userId: true, requestId: true, boardedAt: true },
      });
      if (members.some((m) => m.boardedAt))
        throw c.conflict('Someone has already boarded this ride');
      await tx.ridesRequest.updateMany({
        where: { id: { in: members.map((m) => m.requestId) } },
        data: { status: 'cancelled' },
      });
      await tx.ridesGroup.update({ where: { id: groupId }, data: { status: 'cancelled' } });
      await audit(
        tx,
        adminUser.id,
        'rides.ride_cancelled',
        'rides_group',
        groupId,
        { riders: members.length, reason: reason ?? null },
        requestId,
      );
      const recipients = members.map((m) => m.userId);
      const driver =
        g.vehicleId &&
        (await tx.ridesDriver.findUnique({
          where: { vehicleId: g.vehicleId },
          select: { userId: true },
        }));
      if (driver) recipients.push(driver.userId);
      if (recipients.length) {
        await emit({
          recipients,
          actorId: adminUser.id,
          module: 'rides',
          type: 'rides.ride_cancelled',
          payload: { ...services.riders.rideInfo(graph, g), reason: reason ?? null },
        });
      }
      return { cancelled: true, groupId, riders: members.length };
    });
  }

  // Drop the assigned auto so the next driver request picks a different one.
  async function unassignDriver(adminUser, groupId, body, requestId) {
    const { reason } = R.ReasonRequest.parse(body);
    return p.transaction(async (tx) => {
      const g = await c.lockGroup(tx, groupId);
      if (!g) throw c.notFound('Group not found');
      if (!g.vehicleId) throw c.badRequest('No driver is assigned to this ride');
      if (await tx.ridesGroupMember.count({ where: { groupId, boardedAt: { not: null } } })) {
        throw c.conflict('Someone has already boarded this ride');
      }
      await tx.ridesGroup.update({
        where: { id: groupId },
        data: {
          vehicleId: null,
          driverAssignedAt: null,
          etaMinutes: null,
          driverFemaleRequested: false,
          driverAcceptedAt: null,
        },
      });
      await audit(
        tx,
        adminUser.id,
        'rides.driver_unassigned',
        'rides_group',
        groupId,
        { vehicleId: g.vehicleId, reason: reason ?? null },
        requestId,
      );
      return { groupId, previousVehicleId: g.vehicleId };
    });
  }

  // ── Riders and suspension ─────────────────────────────────────────────────────────────
  async function riders(query) {
    const { cursor, limit } = c.pageQuery(query);
    const rows = await prisma.ridesProfile.findMany({
      where: { user: { role: { not: 'driver' } }, ...c.beforeDesc('createdAt', cursor, 'userId') },
      orderBy: [{ createdAt: 'desc' }, { userId: 'desc' }],
      take: limit + 1,
      include: { user: { select: { name: true, email: true } } },
    });
    const ids = rows.slice(0, limit).map((r) => r.userId);
    const [all, boarded, unpaid, reports] = await Promise.all([
      prisma.ridesGroupMember.groupBy({
        by: ['userId'],
        where: { userId: { in: ids } },
        _count: { _all: true },
      }),
      prisma.ridesGroupMember.groupBy({
        by: ['userId'],
        where: { userId: { in: ids }, boardedAt: { not: null } },
        _count: { _all: true },
      }),
      prisma.ridesGroupMember.groupBy({
        by: ['userId'],
        where: { userId: { in: ids }, boardedAt: { not: null }, paidAt: null },
        _count: { _all: true },
      }),
      prisma.ridesSafetyReport.groupBy({
        by: ['aboutUserId'],
        where: { aboutUserId: { in: ids } },
        _count: { _all: true },
      }),
    ]);
    const count = (list, key, id) => list.find((x) => x[key] === id)?._count._all ?? 0;
    const withId = rows.map((r) => ({ ...r, id: r.userId }));
    return c.toPage(
      withId,
      limit,
      (r) => r.createdAt,
      (r) => ({
        id: r.userId,
        name: r.user.name,
        email: r.user.email,
        joinedOn: r.createdAt.toISOString(),
        rides: count(all, 'userId', r.userId),
        ridesBoarded: count(boarded, 'userId', r.userId),
        unpaid: count(unpaid, 'userId', r.userId),
        reportsAgainst: count(reports, 'aboutUserId', r.userId),
        suspended: Boolean(r.suspendedAt),
        suspendedReason: r.suspendedReason,
      }),
    );
  }

  // Rides-only: platform deactivation stays the admin's tool for the whole account.
  async function setSuspension(adminUser, userId, body, requestId) {
    const { suspended, reason } = R.SuspensionRequest.parse(body);
    await p.transaction(async (tx, emit) => {
      const profile = await tx.ridesProfile.findUnique({ where: { userId } });
      if (!profile) throw c.notFound('Rider not found');
      const text = reason || 'Suspended by admin';
      await tx.ridesProfile.update({
        where: { userId },
        data: suspended
          ? { suspendedAt: new Date(), suspendedReason: text }
          : { suspendedAt: null, suspendedReason: null },
      });
      await audit(
        tx,
        adminUser.id,
        suspended ? 'rides.rider_suspended' : 'rides.rider_unsuspended',
        'user',
        userId,
        suspended ? { reason: reason ?? null } : {},
        requestId,
      );
      await emit(
        suspended
          ? {
              recipients: userId,
              actorId: adminUser.id,
              module: 'rides',
              type: 'rides.suspended',
              payload: { reason: text },
            }
          : {
              recipients: userId,
              actorId: adminUser.id,
              module: 'rides',
              type: 'rides.unsuspended',
              payload: {},
            },
      );
    });
    return { userId, suspended };
  }

  // ── Safety reports ────────────────────────────────────────────────────────────────────
  const reportView = (r) => ({
    id: r.id,
    status: r.status,
    category: r.category,
    message: r.message,
    reportedBy: r.reporter.user.name,
    aboutRider: r.aboutUser?.user.name ?? null,
    aboutRiderId: r.aboutUserId,
    aboutPlate: r.aboutVehicle?.plateNumber ?? null,
    groupId: r.groupId,
    at: r.createdAt.toISOString(),
    resolution: r.resolution,
    resolvedBy: r.resolvedBy?.user.name ?? null,
  });
  const reportInclude = {
    reporter: { select: { user: { select: { name: true } } } },
    aboutUser: { select: { user: { select: { name: true } } } },
    resolvedBy: { select: { user: { select: { name: true } } } },
    aboutVehicle: { select: { plateNumber: true } },
  };

  async function reports(query) {
    const { cursor, limit } = c.pageQuery(query);
    const rows = await prisma.ridesSafetyReport.findMany({
      where: c.beforeDesc('createdAt', cursor),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: reportInclude,
    });
    return c.toPage(rows, limit, (r) => r.createdAt, reportView);
  }

  async function resolveReport(adminUser, id, body, requestId) {
    const { status, resolution } = R.ResolveReportRequest.parse(body);
    await c.ensureProfile(adminUser.id);
    const r = await p.transaction(async (tx, emit) => {
      const [locked] =
        await tx.$queryRaw`SELECT id FROM rides_safety_reports WHERE id = ${id}::uuid FOR UPDATE`;
      if (!locked) throw c.notFound('Report not found');
      const current = await tx.ridesSafetyReport.findUniqueOrThrow({ where: { id } });
      if (current.status !== 'open') throw c.conflict('This report was already closed');
      const updated = await tx.ridesSafetyReport.update({
        where: { id },
        data: {
          status,
          resolution: resolution || null,
          resolvedById: adminUser.id,
          resolvedAt: new Date(),
        },
        include: reportInclude,
      });
      await audit(
        tx,
        adminUser.id,
        'rides.report_resolved',
        'rides_safety_report',
        id,
        { status },
        requestId,
      );
      await emit({
        recipients: current.reporterId,
        actorId: adminUser.id,
        module: 'rides',
        type: 'rides.report_resolved',
        payload: { reportId: id, status },
      });
      return updated;
    });
    return reportView(r);
  }

  // ── Notices ───────────────────────────────────────────────────────────────────────────
  const noticeView = (n) => ({
    id: n.id,
    message: n.message,
    level: n.level,
    at: n.createdAt.toISOString(),
    expiresAt: n.expiresAt?.toISOString() ?? null,
  });

  async function notices(query, { activeOnly }) {
    const { cursor, limit } = c.pageQuery(query);
    const rows = await prisma.ridesNotice.findMany({
      where: {
        AND: [
          activeOnly ? { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } : {},
          c.beforeDesc('createdAt', cursor),
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    return c.toPage(rows, limit, (n) => n.createdAt, noticeView);
  }

  // Posted to every rider's activity feed (everyone with a rides profile who isn't a driver).
  async function postNotice(adminUser, body, requestId) {
    const { message, level = 'info', expiresAt } = R.NoticeRequest.parse(body);
    await c.ensureProfile(adminUser.id);
    const n = await p.transaction(async (tx, emit) => {
      const created = await tx.ridesNotice.create({
        data: {
          message,
          level,
          createdById: adminUser.id,
          expiresAt: expiresAt ? new Date(expiresAt) : null,
        },
      });
      await audit(
        tx,
        adminUser.id,
        'rides.notice_posted',
        'rides_notice',
        created.id,
        { level },
        requestId,
      );
      const riders = await tx.ridesProfile.findMany({
        where: { user: { role: { not: 'driver' }, isActive: true } },
        select: { userId: true },
      });
      if (riders.length) {
        await emit({
          recipients: riders.map((r) => r.userId),
          actorId: adminUser.id,
          module: 'rides',
          type: 'rides.notice_posted',
          payload: { noticeId: created.id, message, level },
        });
      }
      return created;
    });
    return noticeView(n);
  }

  async function deleteNotice(adminUser, id, requestId) {
    await p.transaction(async (tx) => {
      const { count } = await tx.ridesNotice.deleteMany({ where: { id } });
      if (count === 0) throw c.notFound('Notice not found');
      await audit(tx, adminUser.id, 'rides.notice_deleted', 'rides_notice', id, {}, requestId);
    });
    return { removed: true, id };
  }

  // ── Drivers and their documents ───────────────────────────────────────────────────────
  async function drivers(query) {
    const { cursor, limit } = c.pageQuery(query);
    const rows = await prisma.ridesDriver.findMany({
      where: c.afterAsc('createdAt', cursor),
      orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }],
      take: limit + 1,
      include: { user: { select: { name: true, email: true } }, vehicle: true },
    });
    const ids = rows.slice(0, limit).map((d) => d.userId);
    const docs = await prisma.ridesDriverDocument.findMany({
      where: { driverId: { in: ids } },
      orderBy: [{ uploadedAt: 'desc' }, { id: 'desc' }],
    });
    const now = Date.now();
    const withId = rows.map((d) => ({ ...d, id: d.userId }));
    return c.toPage(
      withId,
      limit,
      (d) => d.createdAt,
      (d) => {
        const verification = verificationOf(
          docs.filter((x) => x.driverId === d.userId),
          now,
        );
        return {
          id: d.userId,
          name: d.user.name,
          email: d.user.email,
          driverCode: d.driverCode,
          vehicle: d.vehicle?.model ?? null,
          plateNumber: d.vehicle?.plateNumber ?? null,
          // Lapsed documents count as offline, as the driver's own next request will record.
          online: d.online && verification.verified,
          verification,
        };
      },
    );
  }

  async function reviewDocument(adminUser, id, body, requestId) {
    const { approve, note } = R.ReviewRequest.parse(body);
    await c.ensureProfile(adminUser.id);
    return p.transaction(async (tx, emit) => {
      const [locked] =
        await tx.$queryRaw`SELECT id FROM rides_driver_documents WHERE id = ${id}::uuid FOR UPDATE`;
      if (!locked) throw c.notFound('Document not found');
      const doc = await tx.ridesDriverDocument.findUniqueOrThrow({ where: { id } });
      if (doc.status !== 'pending') throw c.conflict('This document was already reviewed');
      const status = approve ? 'verified' : 'rejected';
      await tx.ridesDriverDocument.update({
        where: { id },
        data: { status, reviewedById: adminUser.id, reviewedAt: new Date(), note: note || null },
      });
      await audit(
        tx,
        adminUser.id,
        'rides.driver_document_reviewed',
        'rides_driver_document',
        id,
        { type: doc.type, status },
        requestId,
      );
      await emit({
        recipients: doc.driverId,
        actorId: adminUser.id,
        module: 'rides',
        type: 'rides.document_reviewed',
        payload: { documentId: id, type: doc.type, status },
      });
      return { id, status };
    });
  }

  return {
    rides,
    cancelRide,
    unassignDriver,
    riders,
    setSuspension,
    reports,
    resolveReport,
    notices,
    postNotice,
    deleteNotice,
    drivers,
    reviewDocument,
  };
};
