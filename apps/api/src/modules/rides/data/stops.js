// The stop graph: Module B's six stops plus the western line and campus points, written once
// by apps/api/scripts/rides-graph.mjs (OSRM road distances, Nominatim coordinates; campus
// points hand-placed, their edges estimated). The seed writes it to rides_nodes and
// rides_route_edges; routing reads the tables. Validated when this file loads.
const { createHash } = require('node:crypto');
const { graph: graphCfg } = require('../config');
const { assertValidGraph } = require('../lib/graph');
const data = require('./graph.json');

// Stable UUID per stop name (same ids as Module B), so reordering stops doesn't change ids.
// md5 here only derives an identifier; it protects nothing.
function stopId(name) {
  const h = createHash('md5').update(`routepool-stop:${name}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

const STOP_NODES = data.nodes.map((n) => ({
  id: stopId(n.name),
  name: n.name,
  shortName: n.shortName,
  area: n.area,
  aliases: n.aliases,
  lat: n.lat,
  lng: n.lng,
}));

// Seconds to cover `metres` at the documented average speed for the edge's kind of path.
const durationOf = (metres, mode) =>
  Math.max(1, Math.round((metres * 3.6) / graphCfg.speedKmh[mode]));

const STOP_EDGES = data.edges.map((e) => ({
  nodeAId: stopId(e.a),
  nodeBId: stopId(e.b),
  distanceM: e.distanceM,
  durationS: durationOf(e.distanceM, e.mode),
  mode: e.mode,
  estimated: e.estimated,
}));

assertValidGraph(STOP_NODES, STOP_EDGES, 'data/graph.json');

module.exports = { STOP_NODES, STOP_EDGES, stopId, durationOf };
