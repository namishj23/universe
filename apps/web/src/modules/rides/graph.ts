import type { Graph } from './api';

/**
 * Drawing only: the stop ids a route passes through, for the stop graph. Scores, overlap and
 * detours always come from the API. The API returns a match's route as stop names in driving
 * order (origin, pickups, drops, destination); the legs between them are drawn along the
 * shortest road path (vehicles never use walking paths, as on the server).
 * ponytail: O(V²) Dijkstra per leg, fine for the 22-stop graph; a heap if the graph grows.
 */
export function shortestPath(graph: Graph, from: string, to: string): string[] {
  const adj = new Map<string, { to: string; w: number }[]>();
  for (const e of graph.edges) {
    if (e.mode === 'walk') continue;
    adj.set(e.nodeAId, [...(adj.get(e.nodeAId) ?? []), { to: e.nodeBId, w: e.distanceM }]);
    adj.set(e.nodeBId, [...(adj.get(e.nodeBId) ?? []), { to: e.nodeAId, w: e.distanceM }]);
  }
  const dist = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, string>();
  const done = new Set<string>();
  for (;;) {
    let u: string | undefined;
    for (const [id, d] of dist) if (!done.has(id) && (u === undefined || d < dist.get(u)!)) u = id;
    if (u === undefined || u === to) break;
    done.add(u);
    for (const { to: v, w } of adj.get(u) ?? []) {
      const nd = dist.get(u)! + w;
      if (nd < (dist.get(v) ?? Infinity)) {
        dist.set(v, nd);
        prev.set(v, u);
      }
    }
  }
  if (!dist.has(to)) return from === to ? [from] : [];
  const path = [to];
  while (path[0] !== from) path.unshift(prev.get(path[0]!)!);
  return path;
}

/** Stop names (as the API returns a route) → the stop ids along every leg. */
export function routeThrough(graph: Graph, names: readonly string[]): string[] {
  const byName = new Map(graph.nodes.map((n) => [n.name, n.id]));
  const ids = names.map((n) => byName.get(n)).filter((id): id is string => Boolean(id));
  const out: string[] = [];
  for (let i = 0; i < ids.length - 1; i++) {
    const leg = shortestPath(graph, ids[i]!, ids[i + 1]!);
    out.push(...(out.length ? leg.slice(1) : leg));
  }
  return out.length ? out : ids;
}
