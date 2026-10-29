import { beforeAll, describe, expect, it } from 'vitest';
import {
  inMinutes,
  makeCarpoolDriver,
  offer,
  prisma,
  requestAt,
  setupRides,
  stop,
  user,
  type Rides,
} from './helpers.js';

// Budget for GET /offers/matches against 200 open offers, measured on the dev Mac (Apple
// silicon, PostgreSQL 18 local): one SQL pre-filter, one batched load, then O(k^2) insertion
// per offer with cached shortest paths. Logged so the report can quote it.
const BUDGET_MS = 200;

let rides: Rides;
beforeAll(async () => {
  rides = await setupRides();
});

describe('matching performance', () => {
  it(`matches a request against 200 open offers in under ${BUDGET_MS} ms`, async () => {
    const [driver, passenger] = await Promise.all([user(rides), user(rides)]);
    await makeCarpoolDriver(driver);
    // Four real offers on different routes, each cloned 50 times with departures spread
    // across the passenger's window.
    const routes = [
      ['Dahisar', 'SPIT Campus (Gate 2)'],
      ['Borivali Station', 'Andheri'],
      ['Kandivali', 'Ghatkopar'],
      ['Malad', 'Powai'],
    ];
    const bases = [];
    for (const [from, to] of routes) {
      bases.push(
        await offer(driver, {
          originNodeId: stop(from ?? ''),
          destNodeId: stop(to ?? ''),
          departAt: inMinutes(60),
          seats: 3,
        }),
      );
    }
    const rows = await prisma.ridesOffer.findMany({
      where: { id: { in: bases.map((b) => b.id) } },
    });
    const clones = rows.flatMap((o) =>
      Array.from({ length: 49 }, (_, i) => {
        return {
          driverId: o.driverId,
          vehicleId: o.vehicleId,
          originNodeId: o.originNodeId,
          destNodeId: o.destNodeId,
          seats: o.seats,
          maxDetourM: o.maxDetourM,
          maxDetourS: o.maxDetourS,
          costPerKmPaise: o.costPerKmPaise,
          basePath: o.basePath,
          baseDistanceM: o.baseDistanceM,
          baseDurationS: o.baseDurationS,
          planDistanceM: o.planDistanceM,
          planDurationS: o.planDurationS,
          tripCostPaise: o.tripCostPaise,
          driverSharePaise: o.driverSharePaise,
          departAt: new Date(o.departAt.getTime() + (i - 24) * 60_000),
        };
      }),
    );
    await prisma.ridesOffer.createMany({ data: clones });
    expect(await prisma.ridesOffer.count({ where: { status: 'open' } })).toBe(200);

    const req = await requestAt(passenger, 'Malad', 'Andheri', inMinutes(90));
    const url = `/api/rides/offers/matches?requestId=${req.id}&limit=50`;
    await passenger.http.get(url).expect(200); // warm: graph and path cache, connections
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      const res = await passenger.http.get(url).expect(200);
      times.push(performance.now() - t0);
      expect((res.body as { matches: unknown[] }).matches.length).toBeGreaterThan(0);
    }
    times.sort((a, b) => a - b);
    const median = times[2] ?? Infinity;
    console.log(
      `matching 200 open offers: median ${median.toFixed(1)} ms (runs: ${times.map((t) => t.toFixed(1)).join(', ')})`,
    );
    expect(median).toBeLessThan(BUDGET_MS);
  });
});
