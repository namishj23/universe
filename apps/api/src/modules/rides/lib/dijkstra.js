// Shortest paths on the stop graph. Replaces Module B's O(V^2) scan with a binary-heap
// Dijkstra: O((V + E) log V) per source. Distances are integer metres; each edge may carry
// durationS (seconds), summed along the chosen (shortest-distance) path.

// Undirected adjacency list. `allow(edge)` filters edges (vehicles skip walking paths).
function buildGraph(edges, allow = () => true) {
  const graph = new Map();
  const add = (from, to, e) => {
    if (!graph.has(from)) graph.set(from, []);
    graph.get(from).push({ to, weight: e.distanceM, durationS: e.durationS ?? 0 });
  };
  for (const e of edges) {
    if (!allow(e)) continue;
    add(e.nodeAId, e.nodeBId, e);
    add(e.nodeBId, e.nodeAId, e);
  }
  return graph;
}

// Min-heap of [distance, nodeId]; ties broken by node id so results are deterministic.
const less = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
function push(heap, item) {
  heap.push(item);
  let i = heap.length - 1;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (!less(heap[i], heap[parent])) break;
    [heap[i], heap[parent]] = [heap[parent], heap[i]];
    i = parent;
  }
}
function pop(heap) {
  const top = heap[0];
  const last = heap.pop();
  if (heap.length > 0) {
    heap[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < heap.length && less(heap[l], heap[m])) m = l;
      if (r < heap.length && less(heap[r], heap[m])) m = r;
      if (m === i) break;
      [heap[i], heap[m]] = [heap[m], heap[i]];
      i = m;
    }
  }
  return top;
}

/** Single-source shortest paths over a graph from buildGraph(). */
function shortestPaths(graph, sourceId) {
  const dist = new Map([[sourceId, 0]]);
  const time = new Map([[sourceId, 0]]);
  const prev = new Map();
  const done = new Set();
  const heap = [[0, sourceId]];
  // Lazy deletion: stale heap entries are skipped when popped.
  while (heap.length) {
    const [d, node] = pop(heap);
    if (done.has(node)) continue;
    done.add(node);
    for (const { to, weight, durationS } of graph.get(node) || []) {
      const alt = d + weight;
      if (!done.has(to) && alt < (dist.get(to) ?? Infinity)) {
        dist.set(to, alt);
        time.set(to, time.get(node) + durationS);
        prev.set(to, node);
        push(heap, [alt, to]);
      }
    }
  }

  function pathTo(targetId) {
    if (!dist.has(targetId)) return null;
    const nodeIds = [targetId];
    let cur = targetId;
    while (prev.has(cur)) {
      cur = prev.get(cur);
      nodeIds.unshift(cur);
    }
    return { distanceM: dist.get(targetId), durationS: time.get(targetId), nodeIds };
  }

  return { dist, prev, pathTo };
}

/** One-off: shortest paths from `sourceId` over `edges` (all edges allowed). */
const dijkstra = (edges, sourceId, allow) => shortestPaths(buildGraph(edges, allow), sourceId);

module.exports = { buildGraph, shortestPaths, dijkstra };
