// The stop graph, ported from Module B (config/stopGraph.js + stopEdges.json, written by its
// scripts/buildStopEdges.js from OpenStreetMap). Six stops in road order; each consecutive
// pair is one edge with its OSRM road distance. The seed writes these to rides_nodes and
// rides_route_edges; routing reads the tables.
const { createHash } = require('node:crypto');
const cached = require('./stopEdges.json');

const STOPS = [
  {
    name: 'SPIT Campus (Gate 2)',
    shortName: 'SPIT',
    kmFromCampus: 0,
    aliases: ['spit', 'campus', 'college', 'gate 2', 'sp it'],
  },
  { name: 'Azad Nagar', shortName: 'AZAD NAGAR', kmFromCampus: 1.2, aliases: ['azad'] },
  {
    name: 'Andheri',
    shortName: 'ANDHERI',
    kmFromCampus: 2.5,
    aliases: ['andheri east', 'andheri west', 'andheri station'],
  },
  { name: 'Marol Naka', shortName: 'MAROL', kmFromCampus: 4.0, aliases: ['marol'] },
  { name: 'Saki Naka', shortName: 'SAKI NAKA', kmFromCampus: 6.0, aliases: ['saki', 'sakinaka'] },
  { name: 'Ghatkopar', shortName: 'GHATKOPAR', kmFromCampus: 9.5, aliases: ['ghatkopar station'] },
];

// Stable UUID per stop name (same ids as Module B), so reordering stops doesn't change ids.
// md5 here only derives an identifier; it protects nothing.
function stopId(name) {
  const h = createHash('md5').update(`routepool-stop:${name}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

const STOP_NODES = STOPS.map((s) => ({
  id: stopId(s.name),
  name: s.name,
  shortName: s.shortName,
  area: s.kmFromCampus === 0 ? 'campus' : 'city',
  aliases: s.aliases,
  lat: cached.coordinates[s.name].lat,
  lng: cached.coordinates[s.name].lng,
}));

// Road distances in whole metres (the JSON has km to 2 decimals, i.e. 10 m steps).
const STOP_EDGES = STOP_NODES.slice(1).map((n, i) => ({
  nodeAId: STOP_NODES[i].id,
  nodeBId: n.id,
  distanceM: Math.round(cached.distances[`${STOP_NODES[i].name}|${n.name}`] * 1000),
}));

module.exports = { STOP_NODES, STOP_EDGES };
