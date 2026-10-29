import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import { setupRides, stop, user, type Rides } from './helpers.js';

const require = createRequire(import.meta.url);
interface Edge {
  nodeAId: string;
  nodeBId: string;
  distanceM: number;
  durationS?: number;
  mode?: string;
}
interface Path {
  distanceM: number;
  nodeIds: string[];
}
const { dijkstra } = require('../../src/modules/rides/lib/dijkstra.js') as {
  dijkstra: (
    edges: Edge[],
    source: string,
    allow?: (e: Edge) => boolean,
  ) => { pathTo: (id: string) => Path | null };
};
const { validateGraph, drivable } = require('../../src/modules/rides/lib/graph.js') as {
  validateGraph: (nodes: { id: string; name: string }[], edges: Edge[]) => string[];
  drivable: (e: Edge) => boolean;
};
const { STOP_NODES, STOP_EDGES } = require('../../src/modules/rides/data/stops.js') as {
  STOP_NODES: { id: string; name: string; area: string }[];
  STOP_EDGES: Edge[];
};

const node = (id: string) => ({ id, name: id });

describe('graph validation', () => {
  it('accepts the committed graph: 20+ stops, branching, campus walking paths', () => {
    expect(validateGraph(STOP_NODES, STOP_EDGES)).toEqual([]);
    expect(STOP_NODES.length).toBeGreaterThanOrEqual(20);
    const degree = new Map<string, number>();
    for (const e of STOP_EDGES)
      for (const id of [e.nodeAId, e.nodeBId]) degree.set(id, (degree.get(id) ?? 0) + 1);
    expect([...degree.values()].some((d) => d >= 3)).toBe(true); // a junction
    expect(STOP_EDGES.some((e) => e.mode === 'walk')).toBe(true);
  });

  it('catches a disconnected graph', () => {
    const problems = validateGraph(['a', 'b', 'c', 'd'].map(node), [
      { nodeAId: 'a', nodeBId: 'b', distanceM: 10 },
      { nodeAId: 'c', nodeBId: 'd', distanceM: 10 },
    ]);
    expect(problems.join('\n')).toMatch(/not connected: c, d unreachable/);
  });

  it('catches zero and negative weights, duplicates and self loops', () => {
    const problems = validateGraph(['a', 'b'].map(node), [
      { nodeAId: 'a', nodeBId: 'b', distanceM: 0 },
      { nodeAId: 'b', nodeBId: 'a', distanceM: -5 },
      { nodeAId: 'a', nodeBId: 'a', distanceM: 5 },
    ]).join('\n');
    expect(problems).toMatch(/a - b: distance must be a positive/);
    expect(problems).toMatch(/b - a: duplicate/);
    expect(problems).toMatch(/connects a stop to itself/);
  });

  it('catches a road network split by a walking-only link', () => {
    const problems = validateGraph(['a', 'b', 'c', 'd'].map(node), [
      { nodeAId: 'a', nodeBId: 'b', distanceM: 10, mode: 'road' },
      { nodeAId: 'b', nodeBId: 'c', distanceM: 10, mode: 'walk' },
      { nodeAId: 'c', nodeBId: 'd', distanceM: 10, mode: 'road' },
    ]);
    expect(problems.join('\n')).toMatch(/road network is not connected/);
  });
});

describe('Dijkstra with a binary heap', () => {
  // Brute force: Bellman-Ford style relaxation until nothing changes (V-1 rounds).
  function bruteForce(n: number, edges: Edge[], source: string) {
    const dist = new Map<string, number>([[source, 0]]);
    for (let round = 0; round < n; round++) {
      for (const e of edges) {
        for (const [a, b] of [
          [e.nodeAId, e.nodeBId],
          [e.nodeBId, e.nodeAId],
        ] as const) {
          const da = dist.get(a);
          if (da !== undefined && da + e.distanceM < (dist.get(b) ?? Infinity))
            dist.set(b, da + e.distanceM);
        }
      }
    }
    return dist;
  }

  it('equals brute force on random graphs', () => {
    let seed = 42;
    const rand = (k: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed % k;
    };
    for (let trial = 0; trial < 60; trial++) {
      const n = 2 + rand(12);
      const edges: Edge[] = [];
      for (let i = 0; i < n * 2; i++) {
        const a = rand(n);
        const b = rand(n);
        if (a !== b) edges.push({ nodeAId: `n${a}`, nodeBId: `n${b}`, distanceM: 1 + rand(50) });
      }
      const expected = bruteForce(n, edges, 'n0');
      const { pathTo } = dijkstra(edges, 'n0');
      for (let i = 0; i < n; i++) {
        const path = pathTo(`n${i}`);
        expect(path?.distanceM ?? null).toBe(expected.get(`n${i}`) ?? null);
        if (path) {
          // The returned path really has that length.
          let sum = 0;
          for (let k = 1; k < path.nodeIds.length; k++) {
            const [a, b] = [path.nodeIds[k - 1], path.nodeIds[k]];
            sum += Math.min(
              ...edges
                .filter(
                  (e) =>
                    (e.nodeAId === a && e.nodeBId === b) || (e.nodeAId === b && e.nodeBId === a),
                )
                .map((e) => e.distanceM),
            );
          }
          expect(sum).toBe(path.distanceM);
        }
      }
    }
  });

  it('has two different paths between Jogeshwari and Azad Nagar (via Andheri or Lokhandwala)', () => {
    const viaAndheri = dijkstra(STOP_EDGES, stop('Jogeshwari')).pathTo(stop('Azad Nagar'));
    expect(viaAndheri?.nodeIds).toEqual([stop('Jogeshwari'), stop('Andheri'), stop('Azad Nagar')]);
    const noAndheri = STOP_EDGES.filter(
      (e) => e.nodeAId !== stop('Andheri') && e.nodeBId !== stop('Andheri'),
    );
    const viaLokhandwala = dijkstra(noAndheri, stop('Jogeshwari')).pathTo(stop('Azad Nagar'));
    expect(viaLokhandwala?.nodeIds).toEqual([
      stop('Jogeshwari'),
      stop('Lokhandwala'),
      stop('Azad Nagar'),
    ]);
    expect(viaLokhandwala?.distanceM).toBeGreaterThan(viaAndheri?.distanceM ?? 0);
  });

  it('never routes vehicles through walking paths', () => {
    const library = stop('Library');
    expect(dijkstra(STOP_EDGES, stop('SPIT Campus (Gate 2)')).pathTo(library)).not.toBeNull();
    expect(dijkstra(STOP_EDGES, stop('SPIT Campus (Gate 2)'), drivable).pathTo(library)).toBeNull();
  });
});

describe('graph routes', () => {
  let rides: Rides;
  beforeAll(async () => {
    rides = await setupRides();
  });

  it('GET /graph lists every stop and edge; GET /route gives the road path', async () => {
    const s = await user(rides);
    const graph = (await s.http.get('/api/rides/graph').expect(200)).body as {
      nodes: { name: string; walkOnly: boolean }[];
      edges: { mode: string; estimated: boolean; durationS: number }[];
    };
    expect(graph.nodes).toHaveLength(STOP_NODES.length);
    expect(graph.edges).toHaveLength(STOP_EDGES.length);
    expect(graph.nodes.find((n) => n.name === 'Library')?.walkOnly).toBe(true);
    expect(graph.edges.every((e) => e.durationS > 0)).toBe(true);

    const route = (
      await s.http
        .get(`/api/rides/route?from=${stop('Borivali Station')}&to=${stop('SPIT Campus (Gate 2)')}`)
        .expect(200)
    ).body as { distanceM: number; stops: { name: string }[] };
    expect(route.stops.map((x) => x.name)).toEqual([
      'Borivali Station',
      'Kandivali',
      'Malad',
      'Goregaon',
      'Jogeshwari',
      'Andheri',
      'Azad Nagar',
      'SPIT Campus (Gate 2)',
    ]);
    expect(route.distanceM).toBe(4103 + 4763 + 3808 + 5478 + 2489 + 2080 + 1040);
    await s.http.get(`/api/rides/route?from=${stop('Library')}&to=${stop('Andheri')}`).expect(400);
  });
});
