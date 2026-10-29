// Ported from Module B (utils/dijkstra.js); distances are integer metres instead of km.

function buildGraph(edges) {
  const graph = new Map();
  for (const { nodeAId, nodeBId, distanceM } of edges) {
    if (!graph.has(nodeAId)) graph.set(nodeAId, []);
    if (!graph.has(nodeBId)) graph.set(nodeBId, []);
    graph.get(nodeAId).push({ to: nodeBId, weight: distanceM });
    graph.get(nodeBId).push({ to: nodeAId, weight: distanceM });
  }
  return graph;
}

// Simple O(V^2) Dijkstra - the campus route graph is small enough that a
// binary-heap priority queue would be premature optimization.
function dijkstra(edges, sourceId) {
  const graph = buildGraph(edges);
  const dist = new Map([[sourceId, 0]]);
  const prev = new Map();
  const visited = new Set();
  const queue = new Set(graph.keys());
  queue.add(sourceId);

  while (queue.size) {
    let current = null;
    let currentDist = Infinity;
    for (const nodeId of queue) {
      const d = dist.has(nodeId) ? dist.get(nodeId) : Infinity;
      if (d < currentDist) {
        currentDist = d;
        current = nodeId;
      }
    }
    if (current === null) break;
    queue.delete(current);
    visited.add(current);

    for (const { to, weight } of graph.get(current) || []) {
      if (visited.has(to)) continue;
      const alt = currentDist + weight;
      if (alt < (dist.has(to) ? dist.get(to) : Infinity)) {
        dist.set(to, alt);
        prev.set(to, current);
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
    return { distanceM: dist.get(targetId), nodeIds };
  }

  return { dist, prev, pathTo };
}

module.exports = { dijkstra };
