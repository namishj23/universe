// Checks on the stop graph, run on the committed data when the module loads and on the
// database graph after the seed, so a bad edit fails loudly instead of routing badly.

// Vehicles never use pedestrian-only paths.
const drivable = (e) => e.mode !== 'walk';

// Node ids reachable from `start` over the given edges (undirected).
function reachable(start, edges) {
  const adj = new Map();
  for (const e of edges) {
    for (const [a, b] of [
      [e.nodeAId, e.nodeBId],
      [e.nodeBId, e.nodeAId],
    ]) {
      if (!adj.has(a)) adj.set(a, []);
      adj.get(a).push(b);
    }
  }
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length) {
    for (const next of adj.get(stack.pop()) || []) {
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return seen;
}

/**
 * nodes: [{ id, name }], edges: [{ nodeAId, nodeBId, distanceM, durationS?, mode? }].
 * Returns a list of problems (empty = valid): unknown nodes, self loops, zero or negative
 * weights, duplicate edges (either direction), a disconnected graph, or stops a vehicle can
 * reach that are not all connected by drivable edges.
 */
function validateGraph(nodes, edges) {
  const problems = [];
  const name = new Map(nodes.map((n) => [n.id, n.name]));
  const label = (e) => `${name.get(e.nodeAId) ?? e.nodeAId} - ${name.get(e.nodeBId) ?? e.nodeBId}`;
  const seen = new Set();
  for (const e of edges) {
    if (!name.has(e.nodeAId) || !name.has(e.nodeBId)) problems.push(`edge ${label(e)}: unknown node`);
    if (e.nodeAId === e.nodeBId) problems.push(`edge ${label(e)}: connects a stop to itself`);
    if (!Number.isSafeInteger(e.distanceM) || e.distanceM <= 0)
      problems.push(`edge ${label(e)}: distance must be a positive whole number of metres`);
    if (e.durationS !== undefined && (!Number.isSafeInteger(e.durationS) || e.durationS <= 0))
      problems.push(`edge ${label(e)}: duration must be a positive whole number of seconds`);
    const key = [e.nodeAId, e.nodeBId].sort().join('|');
    if (seen.has(key)) problems.push(`edge ${label(e)}: duplicate`);
    seen.add(key);
  }
  if (nodes.length > 0) {
    const all = reachable(nodes[0].id, edges);
    const cut = nodes.filter((n) => !all.has(n.id));
    if (cut.length) problems.push(`graph is not connected: ${cut.map((n) => n.name).join(', ')} unreachable`);
    const roads = edges.filter(drivable);
    const onRoad = [...new Set(roads.flatMap((e) => [e.nodeAId, e.nodeBId]))];
    if (onRoad.length > 0) {
      const byCar = reachable(onRoad[0], roads);
      const off = onRoad.filter((id) => !byCar.has(id));
      if (off.length)
        problems.push(`road network is not connected: ${off.map((id) => name.get(id)).join(', ')}`);
    }
  }
  return problems;
}

function assertValidGraph(nodes, edges, where) {
  const problems = validateGraph(nodes, edges);
  if (problems.length)
    throw new Error(`Invalid rides stop graph (${where}):\n${problems.map((p) => `  - ${p}`).join('\n')}`);
}

module.exports = { drivable, validateGraph, assertValidGraph };
