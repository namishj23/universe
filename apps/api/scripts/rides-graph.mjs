// Builds the rides stop graph once and writes apps/api/src/modules/rides/data/graph.json
// (committed; nothing calls these services at request time):
//
//   node apps/api/scripts/rides-graph.mjs
//
// Same approach as Module B's scripts/buildStopEdges.js: Nominatim for coordinates, OSRM for
// road distances, both public OpenStreetMap services. Usage policies respected: an
// identifying User-Agent, at most one request per second, and results cached in the output
// file (a stop or road edge already there is never fetched again).
//  - Module B's six stops keep their cached coordinates and road distances (stable ids/fares).
//  - Campus points are hand-placed near Gate 2 (OSM has no data for them); their edges are
//    straight line x 1.3 and marked `estimated`. A road edge OSRM can't answer is estimated too.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../src/modules/rides/data/graph.json', import.meta.url));
const LEGACY = fileURLToPath(new URL('../src/modules/rides/data/stopEdges.json', import.meta.url));
const UA = 'UniVerse-campus-hackathon/0.1 (github.com/namishj23/universe)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// area: campus | city. geo: Nominatim query (city stops); lat/lng: fixed (campus, legacy).
const NODES = [
  // Module B's stops (names, so ids, unchanged).
  {
    name: 'SPIT Campus (Gate 2)',
    shortName: 'SPIT',
    area: 'campus',
    aliases: ['spit', 'campus', 'college', 'gate 2', 'sp it', 'spit gate'],
  },
  { name: 'Azad Nagar', shortName: 'AZAD NAGAR', area: 'city', aliases: ['azad'] },
  {
    name: 'Andheri',
    shortName: 'ANDHERI',
    area: 'city',
    aliases: ['andheri east', 'andheri west', 'andheri station'],
  },
  { name: 'Marol Naka', shortName: 'MAROL', area: 'city', aliases: ['marol'] },
  { name: 'Saki Naka', shortName: 'SAKI NAKA', area: 'city', aliases: ['saki', 'sakinaka'] },
  { name: 'Ghatkopar', shortName: 'GHATKOPAR', area: 'city', aliases: ['ghatkopar station'] },
  // The western line from the team's UI design.
  {
    name: 'Dahisar',
    shortName: 'DAHISAR',
    area: 'city',
    aliases: ['dahisar station', 'dahisar east'],
    geo: 'Dahisar railway station, Mumbai',
  },
  {
    name: 'Borivali Station',
    shortName: 'BORIVALI',
    area: 'city',
    aliases: ['borivali', 'borivli', 'borivali west', 'borivali east'],
    geo: 'Borivali railway station, Mumbai',
  },
  {
    name: 'Kandivali',
    shortName: 'KANDIVALI',
    area: 'city',
    aliases: ['kandivli', 'kandivali station', 'kandivali west'],
    geo: 'Kandivali railway station, Mumbai',
  },
  {
    name: 'Malad',
    shortName: 'MALAD',
    area: 'city',
    aliases: ['malad station', 'malad west', 'malad east'],
    geo: 'Malad railway station, Mumbai',
  },
  {
    name: 'Goregaon',
    shortName: 'GOREGAON',
    area: 'city',
    aliases: ['goregaon station', 'goregaon west', 'goregaon east'],
    geo: 'Goregaon railway station, Mumbai',
  },
  {
    name: 'Jogeshwari',
    shortName: 'JOGESHWARI',
    area: 'city',
    aliases: ['jogeshwari station', 'jogeshwari east', 'jogeshwari west'],
    geo: 'Jogeshwari railway station, Mumbai',
  },
  {
    name: 'Lokhandwala',
    shortName: 'LOKHANDWALA',
    area: 'city',
    aliases: ['lokhandwala complex', 'lokhandwala market'],
    geo: 'Lokhandwala Complex, Andheri West, Mumbai',
  },
  {
    name: 'Powai',
    shortName: 'POWAI',
    area: 'city',
    aliases: ['hiranandani', 'powai lake', 'iit powai'],
    geo: 'Hiranandani Gardens, Powai, Mumbai',
  },
  // Campus points: hand-placed around Gate 2 (approximate, for the demo map and routing).
  {
    name: 'SPIT Main Gate',
    shortName: 'MAIN GATE',
    area: 'campus',
    aliases: ['main gate', 'spit main gate', 'gate 1'],
    lat: 19.1227,
    lng: 72.8378,
  },
  {
    name: 'Campus Parking',
    shortName: 'PARKING',
    area: 'campus',
    aliases: ['parking', 'car park', 'bike parking'],
    lat: 19.1229,
    lng: 72.8368,
  },
  {
    name: 'Main Building',
    shortName: 'MAIN BLDG',
    area: 'campus',
    aliases: ['main building', 'admin block', 'classrooms'],
    lat: 19.1236,
    lng: 72.8372,
  },
  {
    name: 'Library',
    shortName: 'LIBRARY',
    area: 'campus',
    aliases: ['central library', 'reading room'],
    lat: 19.1241,
    lng: 72.8368,
  },
  {
    name: 'Canteen',
    shortName: 'CANTEEN',
    area: 'campus',
    aliases: ['cafeteria', 'mess', 'food court'],
    lat: 19.1238,
    lng: 72.8362,
  },
  {
    name: 'Boys Hostel',
    shortName: 'BOYS HOSTEL',
    area: 'campus',
    aliases: ['boys hostel', 'hostel b'],
    lat: 19.1246,
    lng: 72.8358,
  },
  {
    name: 'Girls Hostel',
    shortName: 'GIRLS HOSTEL',
    area: 'campus',
    aliases: ['girls hostel', 'hostel g', 'ladies hostel'],
    lat: 19.1244,
    lng: 72.8376,
  },
  {
    name: 'Sports Ground',
    shortName: 'GROUND',
    area: 'campus',
    aliases: ['ground', 'sports complex', 'playground'],
    lat: 19.125,
    lng: 72.8365,
  },
];

// [a, b, mode]. road = public road (OSRM), campus_road = slow lane inside campus, walk = foot only.
const EDGES = [
  // Module B's corridor (distances from its cache).
  ['SPIT Campus (Gate 2)', 'Azad Nagar', 'road'],
  ['Azad Nagar', 'Andheri', 'road'],
  ['Andheri', 'Marol Naka', 'road'],
  ['Marol Naka', 'Saki Naka', 'road'],
  ['Saki Naka', 'Ghatkopar', 'road'],
  // The design's main corridor: Borivali -> ... -> Jogeshwari -> Andheri -> SPIT.
  ['Dahisar', 'Borivali Station', 'road'],
  ['Borivali Station', 'Kandivali', 'road'],
  ['Kandivali', 'Malad', 'road'],
  ['Malad', 'Goregaon', 'road'],
  ['Goregaon', 'Jogeshwari', 'road'],
  ['Jogeshwari', 'Andheri', 'road'],
  // Branches: two ways from Jogeshwari to Azad Nagar (via Andheri or Lokhandwala) and to
  // Saki Naka (via Andheri/Marol or Powai over JVLR).
  ['Jogeshwari', 'Lokhandwala', 'road'],
  ['Lokhandwala', 'Azad Nagar', 'road'],
  ['Jogeshwari', 'Powai', 'road'],
  ['Powai', 'Saki Naka', 'road'],
  ['SPIT Main Gate', 'Azad Nagar', 'road'],
  // Inside campus.
  ['SPIT Campus (Gate 2)', 'Campus Parking', 'campus_road'],
  ['SPIT Main Gate', 'Campus Parking', 'campus_road'],
  ['SPIT Main Gate', 'Main Building', 'walk'],
  ['Campus Parking', 'Main Building', 'walk'],
  ['Main Building', 'Library', 'walk'],
  ['Main Building', 'Canteen', 'walk'],
  ['Canteen', 'SPIT Campus (Gate 2)', 'walk'],
  ['Canteen', 'Boys Hostel', 'walk'],
  ['Library', 'Girls Hostel', 'walk'],
  ['Library', 'Sports Ground', 'walk'],
  ['Sports Ground', 'Boys Hostel', 'walk'],
];

const ESTIMATE_FACTOR = 1.3;
function haversineM(p, q) {
  const r = (d) => (d * Math.PI) / 180;
  const h =
    Math.sin(r(q.lat - p.lat) / 2) ** 2 +
    Math.cos(r(p.lat)) * Math.cos(r(q.lat)) * Math.sin(r(q.lng - p.lng) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

async function geocode(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Nominatim ${res.status} for "${query}"`);
  const [hit] = await res.json();
  if (!hit) throw new Error(`Nominatim found nothing for "${query}"`);
  return { lat: +hit.lat, lng: +hit.lon };
}

async function osrmMetres(p, q) {
  const url = `https://router.project-osrm.org/route/v1/driving/${p.lng},${p.lat};${q.lng},${q.lat}?overview=false`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  const body = await res.json();
  if (!res.ok || body.code !== 'Ok') throw new Error(`OSRM: ${body.message || res.status}`);
  return body.routes[0].distance;
}

const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { nodes: [], edges: [] };
const legacy = JSON.parse(readFileSync(LEGACY, 'utf8'));
const prevNode = new Map(previous.nodes.map((n) => [n.name, n]));
const prevEdge = new Map(previous.edges.map((e) => [`${e.a}|${e.b}`, e]));

const nodes = [];
for (const n of NODES) {
  const { geo, lat, lng, ...rest } = n;
  let at;
  let source;
  if (legacy.coordinates[n.name])
    [at, source] = [legacy.coordinates[n.name], 'nominatim (Module B cache)'];
  else if (lat !== undefined) [at, source] = [{ lat, lng }, 'hand-placed (approximate)'];
  else if (prevNode.has(n.name)) [at, source] = [prevNode.get(n.name), prevNode.get(n.name).source];
  else {
    at = await geocode(geo);
    source = 'nominatim';
    console.log(`  geocoded ${n.name}: ${at.lat}, ${at.lng}`);
    await sleep(1100);
  }
  nodes.push({ ...rest, lat: at.lat, lng: at.lng, source });
}
const byName = new Map(nodes.map((n) => [n.name, n]));

const edges = [];
for (const [a, b, mode] of EDGES) {
  const key = `${a}|${b}`;
  const legacyKm = legacy.distances[key];
  let distanceM;
  let source;
  if (legacyKm !== undefined)
    [distanceM, source] = [Math.round(legacyKm * 1000), 'osrm (Module B cache)'];
  else if (prevEdge.has(key) && prevEdge.get(key).source !== 'estimated') {
    [distanceM, source] = [prevEdge.get(key).distanceM, prevEdge.get(key).source];
  } else if (mode === 'road') {
    try {
      // Average both directions (one-ways make them differ; the graph is undirected).
      const there = await osrmMetres(byName.get(a), byName.get(b));
      await sleep(1100);
      const back = await osrmMetres(byName.get(b), byName.get(a));
      await sleep(1100);
      [distanceM, source] = [Math.round((there + back) / 2), 'osrm'];
      console.log(`  routed ${a} - ${b}: ${distanceM} m`);
    } catch (err) {
      console.warn(`  OSRM failed for ${a} - ${b} (${err.message}); using an estimate`);
    }
  }
  if (distanceM === undefined) {
    distanceM = Math.max(1, Math.round(haversineM(byName.get(a), byName.get(b)) * ESTIMATE_FACTOR));
    source = 'estimated';
  }
  edges.push({ a, b, mode, distanceM, estimated: source === 'estimated', source });
}

writeFileSync(
  OUT,
  `${JSON.stringify({ generatedAt: new Date().toISOString(), estimateFactor: ESTIMATE_FACTOR, nodes, edges }, null, 2)}\n`,
);
console.log(`Wrote ${OUT}: ${nodes.length} nodes, ${edges.length} edges`);
