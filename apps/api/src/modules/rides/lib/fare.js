// Fares in integer paise. Rewritten from Module B (utils/fare.js), which split rupee floats and
// rounded with toFixed in several places, so screens could disagree by a paisa. Here:
//  - one rounding rule (half up, on an exact integer fraction), applied once per stop;
//  - segment costs are differences of those integers, so they add up to the full-route fare;
//  - a total is split by the largest-remainder method, so shares add up to it exactly.

// Half-up division of non-negative integers, exact (no floating point in between).
const divRound = (num, den) => Math.floor((2 * num + den) / (2 * den));

const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
const lcm = (a, b) => (a / gcd(a, b)) * b;

// Meter fare for `metres` from the pickup, before surge: a flat minimum for the first
// `baseMetres`, then per-km beyond it. Distance 0 costs nothing (the minimum applies once
// someone actually rides), which is what lets the segment split telescope to the full fare.
function meterBreakdown(metres, t) {
  if (metres <= 0) return { extraMetres: 0, distanceChargePaise: 0, meterFarePaise: 0 };
  const extraMetres = Math.max(0, metres - t.baseMetres);
  const distanceChargePaise = divRound(t.perKmPaise * extraMetres, 1000);
  return {
    extraMetres,
    distanceChargePaise,
    meterFarePaise: t.baseFarePaise + distanceChargePaise,
  };
}

// The fare (with surge) for riding `metres` from the pickup: one rounding of the exact value.
function fareForDistance(metres, t) {
  if (metres <= 0) return 0;
  const extraMetres = Math.max(0, metres - t.baseMetres);
  return divRound(
    (t.baseFarePaise * 1000 + t.perKmPaise * extraMetres) * t.surgePercent,
    1000 * 100,
  );
}

// Ordered node path -> each stop's cumulative metres from the pickup (stop 0).
function buildCumulativePath(edges, pathNodeIds) {
  const weightByPair = new Map();
  for (const e of edges) {
    weightByPair.set(`${e.nodeAId}:${e.nodeBId}`, e.distanceM);
    weightByPair.set(`${e.nodeBId}:${e.nodeAId}`, e.distanceM);
  }
  let cumulative = 0;
  const stops = [{ nodeId: pathNodeIds[0], cumulativeM: 0 }];
  for (let i = 1; i < pathNodeIds.length; i++) {
    cumulative += weightByPair.get(`${pathNodeIds[i - 1]}:${pathNodeIds[i]}`) || 0;
    stops.push({ nodeId: pathNodeIds[i], cumulativeM: cumulative });
  }
  return stops;
}

/**
 * Splits `total` into integer parts proportional to `weights` (non-negative integers) with
 * the largest-remainder method: everyone gets the floor, and the paise left over go one each
 * to the largest remainders (ties: earlier in the list first). The parts sum to `total`.
 */
function largestRemainder(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) return weights.map(() => 0);
  const parts = weights.map((w) => Math.floor((total * w) / sum));
  const order = weights
    .map((w, i) => ({ i, rem: (total * w) % sum }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  let left = total - parts.reduce((a, b) => a + b, 0);
  for (const { i } of order) {
    if (left === 0) break;
    parts[i] += 1;
    left -= 1;
  }
  return parts;
}

/**
 * Each road segment's cost is shared only by the riders still on board for it (drop at or
 * beyond its end). members: [{ userId, dropM }] in join order. Returns integer paise:
 * { totalFarePaise, shares: Map(userId -> paise) } with the shares summing to the total.
 */
function splitFareBySegments(routeStops, members, t) {
  const segments = [];
  for (let i = 1; i < routeStops.length; i++) {
    const cost =
      fareForDistance(routeStops[i].cumulativeM, t) -
      fareForDistance(routeStops[i - 1].cumulativeM, t);
    const aboard = members.filter((m) => m.dropM >= routeStops[i].cumulativeM);
    segments.push({ cost, aboard });
  }
  const totalFarePaise = fareForDistance(routeStops[routeStops.length - 1].cumulativeM, t);
  // Exact shares as integers over a common denominator: each segment adds cost * (L / riders).
  const L = segments.reduce((acc, s) => (s.aboard.length ? lcm(acc, s.aboard.length) : acc), 1);
  const weight = new Map(members.map((m) => [m.userId, 0]));
  for (const s of segments) {
    for (const m of s.aboard)
      weight.set(m.userId, weight.get(m.userId) + s.cost * (L / s.aboard.length));
  }
  const parts = largestRemainder(
    totalFarePaise,
    members.map((m) => weight.get(m.userId)),
  );
  return { totalFarePaise, shares: new Map(members.map((m, i) => [m.userId, parts[i]])) };
}

// The driver's payout and the platform fee always add up to the fare.
function payoutSplit(totalFarePaise, payoutPercent) {
  const payoutPaise = divRound(totalFarePaise * payoutPercent, 100);
  return { payoutPaise, platformFeePaise: totalFarePaise - payoutPaise };
}

module.exports = {
  divRound,
  meterBreakdown,
  fareForDistance,
  buildCumulativePath,
  largestRemainder,
  splitFareBySegments,
  payoutSplit,
};
