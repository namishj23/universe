import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// The rides module is CommonJS JavaScript; its pure parts are loaded as such.
const require = createRequire(import.meta.url);
interface Path {
  distanceM: number;
  nodeIds: string[];
}
interface Edge {
  nodeAId: string;
  nodeBId: string;
  distanceM: number;
}
interface Tariff {
  baseFarePaise: number;
  baseMetres: number;
  perKmPaise: number;
  surgePercent: number;
}
const { dijkstra } = require('../../src/modules/rides/lib/dijkstra.js') as {
  dijkstra: (edges: Edge[], source: string) => { pathTo: (id: string) => Path | null };
};
const fare = require('../../src/modules/rides/lib/fare.js') as {
  fareForDistance: (m: number, t: Tariff) => number;
  buildCumulativePath: (e: Edge[], ids: string[]) => { nodeId: string; cumulativeM: number }[];
  largestRemainder: (total: number, weights: number[]) => number[];
  splitFareBySegments: (
    stops: { nodeId: string; cumulativeM: number }[],
    members: { userId: string; dropM: number }[],
    t: Tariff,
  ) => { totalFarePaise: number; shares: Map<string, number> };
  payoutSplit: (total: number, pct: number) => { payoutPaise: number; platformFeePaise: number };
};
const matching = require('../../src/modules/rides/lib/matching.js') as {
  evaluate: (
    target: Path,
    members: Path[],
    gap: number,
    pathTo: (id: string) => Path | null,
  ) => { overlap: number; similarity: number; score: number } | null;
};
const { STOP_NODES, STOP_EDGES } = require('../../src/modules/rides/data/stops.js') as {
  STOP_NODES: { id: string; name: string }[];
  STOP_EDGES: Edge[];
};
const { tariff } = require('../../src/modules/rides/config.js') as { tariff: Tariff };

const id = (name: string) => STOP_NODES.find((n) => n.name === name)?.id ?? '';
const [SPIT, AZAD, ANDHERI, MAROL, , GHATKOPAR] = STOP_NODES.map((n) => n.id) as string[];

describe('stop graph and Dijkstra', () => {
  it('has the six OSRM stops in a line, in metres', () => {
    expect(STOP_NODES.map((n) => n.name)).toEqual([
      'SPIT Campus (Gate 2)',
      'Azad Nagar',
      'Andheri',
      'Marol Naka',
      'Saki Naka',
      'Ghatkopar',
    ]);
    expect(STOP_EDGES.map((e) => e.distanceM)).toEqual([1040, 2080, 4680, 680, 4050]);
  });

  it('finds the shortest path in either direction', () => {
    const { pathTo } = dijkstra(STOP_EDGES, AZAD ?? '');
    expect(pathTo(GHATKOPAR ?? '')).toEqual({
      distanceM: 2080 + 4680 + 680 + 4050,
      nodeIds: [AZAD, ANDHERI, MAROL, id('Saki Naka'), GHATKOPAR],
    });
    expect(pathTo(SPIT ?? '')).toEqual({ distanceM: 1040, nodeIds: [AZAD, SPIT] });
    expect(pathTo('nowhere')).toBeNull();
  });
});

describe('fares in paise', () => {
  it('applies the meter tariff with one half-up rounding', () => {
    expect(fare.fareForDistance(0, tariff)).toBe(0);
    // Inside the first 1.5 km: Rs 27 x 1.2 = Rs 32.40.
    expect(fare.fareForDistance(1040, tariff)).toBe(3240);
    // 2.08 km: (27 + 0.58 x 18) x 1.2 = 44.928 -> Rs 44.93.
    expect(fare.fareForDistance(2080, tariff)).toBe(4493);
  });

  it('splits by segment, sums exactly to the full-route fare, and telescopes', () => {
    const { pathTo } = dijkstra(STOP_EDGES, AZAD ?? '');
    const backbone = pathTo(GHATKOPAR ?? '');
    const stops = fare.buildCumulativePath(STOP_EDGES, backbone?.nodeIds ?? []);
    const members = [
      { userId: 'far', dropM: backbone?.distanceM ?? 0 },
      { userId: 'andheri', dropM: 2080 },
      { userId: 'marol', dropM: 2080 + 4680 },
    ];
    const { totalFarePaise, shares } = fare.splitFareBySegments(stops, members, tariff);
    expect(totalFarePaise).toBe(fare.fareForDistance(backbone?.distanceM ?? 0, tariff));
    expect([...shares.values()].reduce((a, b) => a + b, 0)).toBe(totalFarePaise);
    // Hand-worked: first segment 4493 / 3 = 1497.67 each; the Andheri rider pays only that.
    expect(shares.get('andheri')).toBe(1498);
    // Riding alone the whole way costs the full fare.
    const solo = fare.splitFareBySegments(stops, [members[0] ?? { userId: '', dropM: 0 }], tariff);
    expect(solo.shares.get('far')).toBe(totalFarePaise);
  });

  it('largest remainder always adds up, ties go to the earlier member', () => {
    expect(fare.largestRemainder(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(fare.largestRemainder(10, [0, 0])).toEqual([0, 0]);
    for (let total = 0; total < 500; total += 7) {
      const parts = fare.largestRemainder(total, [3, 5, 11]);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
    }
  });

  it('payout plus platform fee equals the fare', () => {
    for (const total of [0, 1, 99, 3240, 15791]) {
      const { payoutPaise, platformFeePaise } = fare.payoutSplit(total, 90);
      expect(payoutPaise + platformFeePaise).toBe(total);
    }
    expect(fare.payoutSplit(15791, 90)).toEqual({ payoutPaise: 14212, platformFeePaise: 1579 });
  });
});

describe('matching eligibility and ranking', () => {
  const { pathTo } = dijkstra(STOP_EDGES, AZAD ?? '');
  const to = (stop: string | undefined) => pathTo(stop ?? '') as Path;

  it('offers a trip lying inside the group route at 100% overlap', () => {
    const r = matching.evaluate(to(ANDHERI), [to(GHATKOPAR)], 2, pathTo);
    expect(r?.overlap).toBe(1);
  });

  it('refuses the opposite direction and pickup times too far apart', () => {
    expect(matching.evaluate(to(SPIT), [to(GHATKOPAR)], 0, pathTo)).toBeNull();
    expect(matching.evaluate(to(GHATKOPAR), [to(GHATKOPAR)], 11, pathTo)).toBeNull();
  });

  it('ranks an identical route above a contained one (0.7 route + 0.3 time)', () => {
    const same = matching.evaluate(to(ANDHERI), [to(ANDHERI)], 0, pathTo);
    const contained = matching.evaluate(to(ANDHERI), [to(GHATKOPAR)], 0, pathTo);
    expect(same?.score).toBe(1);
    expect(contained?.score).toBeLessThan(same?.score ?? 0);
    // Time closeness: 5 of 10 minutes apart on an identical route = 0.7 + 0.15.
    expect(matching.evaluate(to(ANDHERI), [to(ANDHERI)], 5, pathTo)?.score).toBeCloseTo(0.85);
  });
});
