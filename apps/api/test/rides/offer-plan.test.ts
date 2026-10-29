import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// Detour-based matching (lib/offerPlan.js), hand-worked on a small graph:
//
//   A ──1000── B ──1000── C ──1000── D        (the driver's route A -> D, 3000 m)
//   │          ├──300── X                     (just off the route)
//   300        └──5000── Y                    (far off)
//   W
// Durations are distance / 10 (10 m/s) so every number below can be checked by hand.
const require = createRequire(import.meta.url);
interface Path {
  distanceM: number;
  durationS: number;
  nodeIds: string[];
}
type Sp = (a: string, b: string) => Path | null;
interface Stop {
  bookingId: string;
  nodeId: string;
  type: 'pickup' | 'drop';
}
interface Ev {
  distanceM: number;
  peakOnboard: number;
  byBooking: Map<string, { pickupM: number; pickupS: number; dropM: number }>;
  points: { atM: number }[];
}
interface Fit {
  ok: boolean;
  reason: string | null;
  stops: Stop[] | null;
  ev: Ev | null;
  addedDetourM: number;
}
const plan = require('../../src/modules/rides/lib/offerPlan.js') as {
  evaluatePlan: (sp: Sp, offer: object, stops: Stop[]) => Ev | null;
  insertPassenger: (
    sp: Sp,
    offer: object,
    stops: Stop[],
    directM: Map<string, number>,
    passenger: { bookingId: string; pickupNodeId: string; dropNodeId: string; directM: number },
    limits: { maxPickupDelayS: number; maxRideFactorPercent: number },
  ) => Fit;
  splitCost: (
    ev: Ev,
    perKm: number,
  ) => { tripCostPaise: number; driverSharePaise: number; shares: Map<string, number> };
  score: (x: {
    sharedM: number;
    passengerM: number;
    routeM: number;
    minutesApart: number;
    bufferMinutes: number;
    weights: { route: number; time: number };
  }) => { score: number; routeSimilarity: number; overlapRatio: number; timeFit: number };
  sharedMetres: (
    path: string[],
    route: string[],
    edgeM: (a: string, b: string) => number,
  ) => number;
};
const { buildGraph, shortestPaths } = require('../../src/modules/rides/lib/dijkstra.js') as {
  buildGraph: (edges: object[]) => unknown;
  shortestPaths: (g: unknown, s: string) => { pathTo: (t: string) => Path | null };
};
const { fareForDistance } = require('../../src/modules/rides/lib/fare.js') as {
  fareForDistance: (m: number, t: object) => number;
};
const { tariff } = require('../../src/modules/rides/config.js') as { tariff: object };

const edge = (a: string, b: string, m: number) => ({
  nodeAId: a,
  nodeBId: b,
  distanceM: m,
  durationS: m / 10,
});
const EDGES = [
  edge('A', 'B', 1000),
  edge('B', 'C', 1000),
  edge('C', 'D', 1000),
  edge('B', 'X', 300),
  edge('B', 'Y', 5000),
  edge('A', 'W', 300),
];
const g = buildGraph(EDGES);
const sp: Sp = (a, b) => shortestPaths(g, a).pathTo(b);
const edgeM = (a: string, b: string) =>
  EDGES.find((e) => (e.nodeAId === a && e.nodeBId === b) || (e.nodeAId === b && e.nodeBId === a))
    ?.distanceM ?? 0;

const offer = (over: object = {}) => ({
  originNodeId: 'A',
  destNodeId: 'D',
  seats: 3,
  maxDetourM: 2000,
  maxDetourS: 600,
  baseDistanceM: 3000,
  baseDurationS: 300,
  ...over,
});
const limits = { maxPickupDelayS: 600, maxRideFactorPercent: 150 };
const rider = (id: string, from: string, to: string) => ({
  bookingId: id,
  pickupNodeId: from,
  dropNodeId: to,
  directM: sp(from, to)?.distanceM ?? 0,
});
const accepted = (id: string, from: string, to: string): Stop[] => [
  { bookingId: id, nodeId: from, type: 'pickup' },
  { bookingId: id, nodeId: to, type: 'drop' },
];

describe('detour, hand-worked', () => {
  it('a passenger on the route adds no detour', () => {
    const fit = plan.insertPassenger(sp, offer(), [], new Map(), rider('p', 'B', 'C'), limits);
    expect(fit).toMatchObject({ ok: true, addedDetourM: 0 });
    expect(fit.ev?.distanceM).toBe(3000);
  });

  it('a passenger slightly off the route is accepted with the exact extra metres', () => {
    // A -> B -> X (pickup) -> B -> C (drop) -> D = 1000 + 300 + 300 + 1000 + 1000.
    const fit = plan.insertPassenger(sp, offer(), [], new Map(), rider('p', 'X', 'C'), limits);
    expect(fit).toMatchObject({ ok: true, addedDetourM: 600 });
    expect(fit.ev?.distanceM).toBe(3600);
  });

  it('a passenger far off the route is rejected with the reason', () => {
    // B -> Y and back is 10 km against a 2 km budget.
    const fit = plan.insertPassenger(sp, offer(), [], new Map(), rider('p', 'Y', 'C'), limits);
    expect(fit).toMatchObject({ ok: false, reason: 'detour', addedDetourM: 10_000 });
  });
});

describe('insertion order', () => {
  it('inserts a second passenger at the cheapest valid position, pickup before drop', () => {
    const first = accepted('p1', 'B', 'C');
    const fit = plan.insertPassenger(
      sp,
      offer(),
      first,
      new Map([['p1', 1000]]),
      rider('p2', 'X', 'D'),
      limits,
    );
    expect(fit.ok).toBe(true);
    expect(fit.addedDetourM).toBe(600);
    // Ties (X before or after B's pickup, both 3600 m) keep the earliest position.
    expect(fit.stops?.map((s) => `${s.type}:${s.bookingId}`)).toEqual([
      'pickup:p2',
      'pickup:p1',
      'drop:p1',
      'drop:p2',
    ]);
    for (const id of ['p1', 'p2']) {
      const at = fit.stops?.map((s) => s.bookingId) ?? [];
      expect(at.indexOf(id)).toBeLessThan(at.lastIndexOf(id));
    }
  });
});

describe('constraints', () => {
  it("a delay limit moves the insertion so a confirmed passenger's pickup stays put", () => {
    const fit = plan.insertPassenger(
      sp,
      offer(),
      accepted('p1', 'B', 'C'),
      new Map([['p1', 1000]]),
      rider('p2', 'X', 'D'),
      // p1's ride becomes B -> X -> B -> C = 1600 m, so allow 2x for this case.
      { maxPickupDelayS: 30, maxRideFactorPercent: 200 },
    );
    // Picking up at X first would make p1 wait 60 s; after p1 it costs the same distance.
    expect(fit.ok).toBe(true);
    expect(fit.stops?.map((s) => `${s.type}:${s.bookingId}`)).toEqual([
      'pickup:p1',
      'pickup:p2',
      'drop:p1',
      'drop:p2',
    ]);
  });

  it('rejects an insertion that would delay a confirmed passenger beyond the limit', () => {
    const fit = plan.insertPassenger(
      sp,
      offer({ maxDetourM: 4000, maxDetourS: 6000 }),
      accepted('p1', 'B', 'C'),
      new Map([['p1', 1000]]),
      rider('p2', 'W', 'D'),
      { ...limits, maxPickupDelayS: 0 },
    );
    expect(fit).toMatchObject({ ok: false, reason: 'delay' });
  });

  it('rejects an insertion that would exceed the seats mid-route', () => {
    const fit = plan.insertPassenger(
      sp,
      offer({ seats: 1, maxDetourM: 1000 }),
      accepted('p1', 'B', 'C'),
      new Map([['p1', 1000]]),
      rider('p2', 'B', 'D'),
      limits,
    );
    expect(fit).toMatchObject({ ok: false, reason: 'seats' });
    // A seat freed before the next pickup is reused: C -> D after p1 got off at C.
    const later = plan.insertPassenger(
      sp,
      offer({ seats: 1 }),
      accepted('p1', 'B', 'C'),
      new Map([['p1', 1000]]),
      rider('p2', 'C', 'D'),
      limits,
    );
    expect(later).toMatchObject({ ok: true, addedDetourM: 0 });
    expect(later.ev?.peakOnboard).toBe(1);
  });

  it("rejects a plan that makes someone's ride longer than 1.5x their direct route", () => {
    // p1 rides B -> C (1000 m); taking Y in between would make it 11 km.
    const fit = plan.insertPassenger(
      sp,
      offer({ maxDetourM: 10_000, maxDetourS: 3600 }),
      accepted('p1', 'B', 'C'),
      new Map([['p1', 1000]]),
      rider('p2', 'Y', 'C'),
      limits,
    );
    expect(fit.ok).toBe(false);
    expect(['ride_length', 'delay']).toContain(fit.reason);
  });
});

describe('ranking', () => {
  const weights = { route: 0.7, time: 0.3 };
  it('the score is the weighted sum of its parts', () => {
    for (const minutesApart of [0, 2.5, 7, 10]) {
      const s = plan.score({
        sharedM: 1000,
        passengerM: 1300,
        routeM: 3000,
        minutesApart,
        bufferMinutes: 10,
        weights,
      });
      expect(Math.abs(s.score - (0.7 * s.routeSimilarity + 0.3 * s.timeFit))).toBeLessThanOrEqual(
        0.0005,
      );
    }
    expect(
      plan.score({
        sharedM: 1000,
        passengerM: 1000,
        routeM: 1000,
        minutesApart: 0,
        bufferMinutes: 10,
        weights,
      }),
    ).toEqual({
      score: 1,
      routeSimilarity: 1,
      overlapRatio: 1,
      timeFit: 1,
    });
  });

  it('identical inputs give identical results', () => {
    const run = () =>
      ['X', 'B', 'W'].map((from) =>
        plan.insertPassenger(sp, offer(), [], new Map(), rider('p', from, 'C'), limits),
      );
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });

  it('measures shared metres in the driving direction only', () => {
    const route = ['A', 'B', 'C', 'D'];
    expect(plan.sharedMetres(['B', 'C'], route, edgeM)).toBe(1000);
    expect(plan.sharedMetres(['X', 'B', 'C'], route, edgeM)).toBe(1000);
    expect(plan.sharedMetres(['C', 'B'], route, edgeM)).toBe(0);
  });
});

describe('cost split, hand-worked', () => {
  it('splits the trip cost per segment among everyone aboard, adding up exactly', () => {
    // A -> D 3000 m at Rs 7/km = Rs 21. A-B: driver alone (700); B-C: driver + p (350 each);
    // C-D: driver alone (700). Driver 1750, passenger 350.
    const fit = plan.insertPassenger(sp, offer(), [], new Map(), rider('p', 'B', 'C'), limits);
    const cost = plan.splitCost(fit.ev as Ev, 700);
    expect(cost.tripCostPaise).toBe(2100);
    expect(cost.driverSharePaise).toBe(1750);
    expect(cost.shares.get('p')).toBe(350);
    expect(cost.driverSharePaise + (cost.shares.get('p') ?? 0)).toBe(cost.tripCostPaise);
    // Savings against a solo auto for the same 1 km: Rs 32.40 - Rs 3.50.
    expect(fareForDistance(1000, tariff) - 350).toBe(2890);
  });

  it('always sums to the trip cost and never charges anyone more than riding alone', () => {
    for (const perKm of [0, 1, 250, 333, 700, 999]) {
      const fit = plan.insertPassenger(
        sp,
        offer(),
        accepted('p1', 'B', 'C'),
        new Map([['p1', 1000]]),
        rider('p2', 'X', 'D'),
        limits,
      );
      const cost = plan.splitCost(fit.ev as Ev, perKm);
      const sum = [...cost.shares.values()].reduce((a, b) => a + b, cost.driverSharePaise);
      expect(sum).toBe(cost.tripCostPaise);
      for (const share of cost.shares.values())
        expect(share).toBeLessThanOrEqual(cost.tripCostPaise);
    }
  });
});
