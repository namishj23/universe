// Shared-ride statistics over both ride types (P3b): pooled autos (Module B's completed-ride
// rule) and completed carpool offers. Computed in SQL; every figure is an estimate and the
// assumptions behind it are returned with it.
//  - shared trip: a pooled auto with 2+ riders, or a carpool ride with 1+ passenger;
//  - shared distance: a pooled rider's trip metres, a carpool passenger's in-vehicle metres
//    (the driver is aboard the whole way);
//  - savings: solo auto fare minus the rider's share, never negative per ride;
//  - occupancy: people sharing the vehicle (pooled riders; carpool passengers + driver).
module.exports = function stats(c) {
  const { cfg, prisma } = c;

  // One query: totals, the per-week series (IST weeks) and the five busiest routes.
  // `me` = null: everyone (admin); otherwise only that rider's rides.
  async function aggregate(me, now) {
    const [row] = await prisma.$queryRaw`
      WITH trips AS (
        SELECT 'pool' AS type, g.id AS trip_id, g.pickup_at AS at,
               r.pickup_node_id AS from_id, m.drop_node_id AS to_id, r.distance_m AS shared_m,
               GREATEST(r.solo_fare_paise - m.fare_share_paise, 0) AS saved,
               (SELECT count(*) FROM rides_group_members x WHERE x.group_id = g.id) AS people
        FROM rides_group_members m
        JOIN rides_groups g ON g.id = m.group_id
        JOIN rides_requests r ON r.id = m.request_id
        WHERE m.boarded_at IS NOT NULL AND g.status <> 'cancelled'
          AND (g.status = 'completed' OR g.pickup_at < ${now})
          AND (${me}::uuid IS NULL OR m.user_id = ${me}::uuid)
        UNION ALL
        SELECT 'carpool', o.id, o.depart_at, b.pickup_node_id, b.drop_node_id, b.in_vehicle_m,
               GREATEST(b.solo_fare_paise - b.cost_share_paise, 0),
               (SELECT count(*) FROM rides_offer_bookings x WHERE x.offer_id = o.id AND x.status = 'accepted') + 1
        FROM rides_offer_bookings b
        JOIN rides_offers o ON o.id = b.offer_id
        WHERE b.status = 'accepted' AND o.status = 'completed'
          AND (${me}::uuid IS NULL OR b.passenger_id = ${me}::uuid)
      ),
      shared AS (
        SELECT *, (date_trunc('week', at AT TIME ZONE 'Asia/Kolkata'))::date AS week
        FROM trips WHERE people >= 2
      ),
      per_trip AS (SELECT type, trip_id, week, max(people) AS people FROM shared GROUP BY type, trip_id, week)
      SELECT
        (SELECT count(*) FROM per_trip)::int AS "sharedTrips",
        (SELECT count(*) FROM per_trip WHERE type = 'pool')::int AS "pooledTrips",
        (SELECT count(*) FROM per_trip WHERE type = 'carpool')::int AS "carpoolTrips",
        (SELECT COALESCE(round(avg(people), 2), 0) FROM per_trip)::float8 AS "averageOccupancy",
        (SELECT COALESCE(sum(shared_m), 0) FROM shared)::int AS "sharedDistanceM",
        (SELECT COALESCE(sum(saved), 0) FROM shared)::int AS "savingsPaise",
        (SELECT COALESCE(json_agg(w ORDER BY w."weekStart"), '[]') FROM (
           SELECT s.week::text AS "weekStart",
                  (SELECT count(*) FROM per_trip t WHERE t.week = s.week)::int AS "sharedTrips",
                  sum(s.shared_m)::int AS "sharedDistanceM", sum(s.saved)::int AS "savingsPaise",
                  (SELECT round(avg(t.people), 2) FROM per_trip t WHERE t.week = s.week)::float8 AS "averageOccupancy"
           FROM shared s GROUP BY s.week) w) AS weeks,
        (SELECT COALESCE(json_agg(r), '[]') FROM (
           SELECT pn.name AS "pickupName", dn.name AS "dropName", count(*)::int AS trips
           FROM shared s JOIN rides_nodes pn ON pn.id = s.from_id JOIN rides_nodes dn ON dn.id = s.to_id
           GROUP BY pn.name, dn.name ORDER BY trips DESC, pn.name, dn.name LIMIT 5) r) AS routes`;
    const { weeks, routes, ...totals } = row;
    return { totals, weeks, busiestRoutes: routes };
  }

  const assumptions = () => ({
    autoTariff: { ...cfg.tariff },
    carpoolCostPerKmPaise: { ...cfg.offers.costPerKmPaise },
    speedKmh: { ...cfg.graph.speedKmh },
    notes: [
      'Savings = what the same trip would cost riding solo in an auto (meter tariff, shortest path) minus the rider’s share, never negative.',
      'Carpool cost = route km x cost per km, split per road segment among everyone aboard (the driver counts as one person).',
      'Distances are road distances from OpenStreetMap (OSRM); campus paths are straight line x 1.3.',
      'Occupancy = people sharing the vehicle: pooled riders, or carpool passengers plus the driver.',
    ],
  });

  /** Seats filled and cost recovered on a carpool driver's completed offers. */
  async function driverTotals(userId) {
    const [t] = await prisma.$queryRaw`
      SELECT count(DISTINCT o.id)::int AS "completedOffers",
             count(b.id)::int AS "seatsFilled",
             COALESCE(sum(b.cost_share_paise), 0)::int AS "costRecoveredPaise"
      FROM rides_offers o
      LEFT JOIN rides_offer_bookings b ON b.offer_id = o.id AND b.status = 'accepted'
      WHERE o.driver_id = ${userId}::uuid AND o.status = 'completed'`;
    return t;
  }

  async function report(userId) {
    const [summary, isDriver] = await Promise.all([
      aggregate(userId, new Date()),
      userId
        ? prisma.ridesDriver.count({ where: { userId, kind: 'carpool' } })
        : Promise.resolve(0),
    ]);
    return {
      estimate: true,
      ...summary,
      driver: isDriver ? await driverTotals(userId) : null,
      assumptions: assumptions(),
    };
  }

  return { report: (userId) => report(userId), all: () => report(null), driverTotals };
};
