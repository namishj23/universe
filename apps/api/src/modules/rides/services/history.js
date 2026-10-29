// A rider's history, totals and the dashboard summary, plus the campus-wide numbers. Ported
// from Module B's dashboard.service (whose Prisma path and mock path differed). Totals are
// computed from rides, never stored: a ride counts as completed once the rider boarded and
// the group was not cancelled and has either been completed by the driver or passed pickup.
const HOUR_BUCKETS = [8, 10, 12, 14, 16, 18, 20];

module.exports = function history(c, services) {
  const { prisma } = c;

  function row(m, coRiders, graph, now) {
    const g = m.group;
    const active =
      (g.status === 'forming' || g.status === 'confirmed') &&
      g.pickupAt.getTime() >= now - c.bufferMs;
    return {
      groupId: g.id,
      pickupName: graph.stop(m.request.pickupNodeId).name,
      dropName: graph.stop(m.dropNodeId).name,
      pickupTime: g.pickupAt.toISOString(),
      status: g.status,
      kind: g.kind,
      fareSharePaise: m.fareSharePaise,
      soloFarePaise: m.request.soloFarePaise,
      savedPaise: m.request.soloFarePaise - m.fareSharePaise,
      coRiderNames: coRiders,
      paid: Boolean(m.paidAt),
      boarded: Boolean(m.boardedAt),
      active,
      paymentPending: c.paymentPendingFor(g, m, now),
    };
  }

  async function rows(memberships) {
    const [members, graph] = await Promise.all([
      c.membersByGroup([...new Set(memberships.map((m) => m.groupId))]),
      c.loadGraph(),
    ]);
    const now = Date.now();
    return memberships.map((m) =>
      row(
        m,
        members
          .get(m.groupId)
          .filter((x) => x.userId !== m.userId)
          .map((x) => x.name),
        graph,
        now,
      ),
    );
  }

  const include = { group: true, request: { select: { pickupNodeId: true, soloFarePaise: true } } };

  // Every ride (group membership) of this user, newest first.
  async function list(userId, query) {
    const { cursor, limit } = c.pageQuery(query);
    const memberships = await prisma.ridesGroupMember.findMany({
      where: { userId, ...c.beforeDesc('joinedAt', cursor) },
      orderBy: [{ joinedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include,
    });
    const page = c.toPage(
      memberships,
      limit,
      (m) => m.joinedAt,
      (m) => m,
    );
    return { items: await rows(page.items), nextCursor: page.nextCursor };
  }

  async function totals(userId) {
    const now = new Date();
    // "done" = the completed-ride rule above: boarded, not cancelled, finished or past pickup.
    const [t] = await prisma.$queryRaw`
      SELECT count(*) FILTER (WHERE g.status <> 'cancelled')::int AS "totalRides",
             count(*) FILTER (WHERE x.done)::int AS "completedRides",
             COALESCE(sum(GREATEST(r.solo_fare_paise - m.fare_share_paise, 0)) FILTER (WHERE x.done), 0)::int
               AS "totalSavingsPaise",
             COALESCE(round(avg(m.fare_share_paise) FILTER (WHERE g.status <> 'cancelled')), 0)::int
               AS "avgFarePaise",
             COALESCE(sum(r.distance_m) FILTER (WHERE x.done AND x.size >= 2), 0)::int AS "sharedDistanceM"
      FROM rides_group_members m
      JOIN rides_groups g ON g.id = m.group_id
      JOIN rides_requests r ON r.id = m.request_id
      CROSS JOIN LATERAL (
        SELECT m.boarded_at IS NOT NULL AND g.status <> 'cancelled'
                 AND (g.status = 'completed' OR g.pickup_at < ${now}) AS done,
               (SELECT count(*) FROM rides_group_members o WHERE o.group_id = g.id) AS size
      ) x
      WHERE m.user_id = ${userId}::uuid`;
    return t;
  }

  async function upcoming(userId) {
    const now = Date.now();
    const soon = await prisma.ridesGroupMember.findMany({
      where: {
        userId,
        group: {
          status: { in: ['forming', 'confirmed'] },
          pickupAt: { gte: new Date(now - c.bufferMs) },
        },
      },
      orderBy: { group: { pickupAt: 'asc' } },
      take: 1,
      include,
    });
    const pending = await prisma.ridesGroupMember.findMany({
      where: {
        userId,
        paidAt: null,
        group: { kind: 'auto', status: { not: 'cancelled' }, pickupAt: { gt: new Date(now) } },
      },
      orderBy: { group: { pickupAt: 'asc' } },
      take: 20,
      include,
    });
    return { soon, pending };
  }

  async function stats(userId) {
    const [t, { soon, pending }] = await Promise.all([totals(userId), upcoming(userId)]);
    const all = await rows([...soon, ...pending]);
    return {
      totalRides: t.totalRides,
      completedRides: t.completedRides,
      totalSavingsPaise: t.totalSavingsPaise,
      avgFarePaise: t.avgFarePaise,
      activeRide: soon.length ? all[0] : null,
      pendingPayments: all.slice(soon.length),
    };
  }

  // Completed carpool seats (P3b): count, in-vehicle metres, savings (never negative per ride).
  async function carpoolTotals(userId) {
    const [t] = await prisma.$queryRaw`
      SELECT count(*)::int AS rides, COALESCE(sum(b.in_vehicle_m), 0)::int AS "sharedDistanceM",
             COALESCE(sum(GREATEST(b.solo_fare_paise - b.cost_share_paise, 0)), 0)::int AS "savedPaise"
      FROM rides_offer_bookings b JOIN rides_offers o ON o.id = b.offer_id
      WHERE b.passenger_id = ${userId}::uuid AND b.status = 'accepted' AND o.status = 'completed'`;
    return t;
  }

  // GET /api/dashboard for a rider: the next ride of either kind, rides completed, distance
  // shared and money saved over pooled autos and carpool seats; carpool drivers also see
  // seats filled and cost recovered.
  async function riderSummary(userId) {
    const now = Date.now();
    const [t, { soon }, graph, cp, seat, isDriver] = await Promise.all([
      totals(userId),
      upcoming(userId),
      c.loadGraph(),
      carpoolTotals(userId),
      prisma.ridesOfferBooking.findFirst({
        where: {
          passengerId: userId,
          status: 'accepted',
          plannedPickupAt: { gte: new Date(now - c.bufferMs) },
          offer: { status: { in: ['open', 'full', 'departed'] } },
        },
        orderBy: [{ plannedPickupAt: 'asc' }, { id: 'asc' }],
        include: { offer: { select: { peakOnboard: true } } },
      }),
      prisma.ridesDriver.count({ where: { userId, kind: 'carpool' } }),
    ]);
    const next = soon[0];
    let upcomingRide = null;
    if (next && (!seat || next.group.pickupAt <= seat.plannedPickupAt)) {
      upcomingRide = {
        rideType: 'pool',
        id: next.groupId,
        pickupName: graph.stop(next.group.pickupNodeId).name,
        dropName: graph.stop(next.dropNodeId).name,
        pickupTime: next.group.pickupAt.toISOString(),
        groupSize: await prisma.ridesGroupMember.count({ where: { groupId: next.groupId } }),
      };
    } else if (seat) {
      upcomingRide = {
        rideType: 'carpool',
        id: seat.offerId,
        pickupName: graph.stop(seat.pickupNodeId).name,
        dropName: graph.stop(seat.dropNodeId).name,
        pickupTime: seat.plannedPickupAt.toISOString(),
        groupSize: seat.offer.peakOnboard + 1,
      };
    }
    const driver = isDriver ? await services.stats.driverTotals(userId) : null;
    return {
      kind: 'rider',
      upcomingRide,
      ridesCompleted: t.completedRides + cp.rides,
      sharedDistanceM: t.sharedDistanceM + cp.sharedDistanceM,
      savedPaise: t.totalSavingsPaise + cp.savedPaise,
      carpool: driver
        ? { seatsFilled: driver.seatsFilled, costRecoveredPaise: driver.costRecoveredPaise }
        : null,
    };
  }

  // The busiest pickup -> drop corridors among live requests (open, or in a live group).
  async function busyRoutes() {
    const since = new Date(Date.now() - c.bufferMs);
    const rowsRaw = await prisma.$queryRaw`
      SELECT pn.name AS "pickupName", pn.short_name AS "pickupShort",
             dn.name AS "dropName", dn.short_name AS "dropShort", count(*)::int AS count
      FROM rides_requests r
      JOIN rides_nodes pn ON pn.id = r.pickup_node_id
      JOIN rides_nodes dn ON dn.id = r.drop_node_id
      LEFT JOIN rides_groups g ON g.id = r.group_id
      WHERE r.pickup_at >= ${since}
        AND (r.status = 'open' OR (r.status = 'matched' AND g.status IN ('forming', 'confirmed')))
      GROUP BY pn.name, pn.short_name, dn.name, dn.short_name
      ORDER BY count DESC, pn.name, dn.name
      LIMIT 5`;
    const max = Math.max(1, ...rowsRaw.map((r) => r.count));
    return rowsRaw.map((r) => ({
      name: `${r.pickupName} → ${r.dropName}`,
      pickupShort: r.pickupShort,
      dropShort: r.dropShort,
      count: r.count,
      widthPercent: Math.round((r.count * 100) / max),
    }));
  }

  // Campus insights, from ride data only. A "pool" is a non-cancelled group of 2+ riders;
  // savings = what each pooled rider would have paid alone minus their share.
  async function campusStats() {
    const [[t], hours] = await Promise.all([
      prisma.$queryRaw`
        WITH pools AS (
          SELECT g.id, g.total_fare_paise FROM rides_groups g
          JOIN rides_group_members m ON m.group_id = g.id
          WHERE g.status <> 'cancelled' GROUP BY g.id, g.total_fare_paise HAVING count(*) >= 2)
        SELECT (SELECT count(DISTINCT user_id)::int FROM rides_requests WHERE status <> 'cancelled') AS "totalUsers",
               (SELECT count(*)::int FROM pools) AS "totalPools",
               (SELECT COALESCE(round(avg(total_fare_paise)), 0)::int FROM pools) AS "avgFarePaise",
               (SELECT COALESCE(sum(GREATEST(r.solo_fare_paise - m.fare_share_paise, 0)), 0)::int
                  FROM rides_group_members m JOIN pools p ON p.id = m.group_id
                  JOIN rides_requests r ON r.id = m.request_id) AS "totalSavingsPaise"`,
      // Hour of day on campus (India time) for the chart.
      prisma.$queryRaw`
        SELECT EXTRACT(HOUR FROM pickup_at AT TIME ZONE 'Asia/Kolkata')::int AS hour, count(*)::int AS count
        FROM rides_requests WHERE status <> 'cancelled' GROUP BY hour`,
    ]);
    const byHour = HOUR_BUCKETS.map(() => 0);
    for (const h of hours) {
      for (let i = HOUR_BUCKETS.length - 1; i >= 0; i--) {
        if (h.hour >= HOUR_BUCKETS[i]) {
          byHour[i] += h.count;
          break;
        }
      }
    }
    return {
      ...t,
      hourLabels: HOUR_BUCKETS.map((h) => `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`),
      byHour,
    };
  }

  return { list, stats, riderSummary, busyRoutes, campusStats };
};
