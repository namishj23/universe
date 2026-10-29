// Route comparison for matching. Ported from Module B (modules/rides/matching.service.js);
// distances are metres and the score is computed in integer percent, never floats rounded midway.
const { matching } = require('../config');

// True if `shorter`'s stops are a leading prefix of `longer`'s - i.e. both ride
// the same road in the same direction until `shorter` gets off.
function pathContains(longer, shorter) {
  if (shorter.nodeIds.length > longer.nodeIds.length) return false;
  return shorter.nodeIds.every((id, i) => id === longer.nodeIds[i]);
}

// Metres two routes from the same pickup share before they split (common leading stops).
function sharedM(a, b, pathTo) {
  let i = 0;
  while (i < a.nodeIds.length && i < b.nodeIds.length && a.nodeIds[i] === b.nodeIds[i]) i++;
  return i > 1 ? pathTo(a.nodeIds[i - 1]).distanceM : 0;
}

// ELIGIBILITY: shared / the SHORTER route, as a fraction. A trip lying entirely inside the
// other one is 1 (Andheri -> Marol inside Andheri -> Ghatkopar).
function routeOverlap(a, b, pathTo) {
  const shorter = Math.min(a.distanceM, b.distanceM);
  return shorter > 0 ? sharedM(a, b, pathTo) / shorter : 1;
}

// RANKING: shared / the LONGER route. 1 only for identical routes.
function routeSimilarity(a, b, pathTo) {
  const longer = Math.max(a.distanceM, b.distanceM);
  return longer > 0 ? sharedM(a, b, pathTo) / longer : 1;
}

/**
 * Can `target` (a rider's path) join a group whose members ride `memberPaths`, with pickup
 * times at most `maxGapMinutes` apart? Same rules as Module B: one auto on one line, overlap
 * at least minRouteOverlapPercent of the shorter route, and the rider's trip inside the
 * group's route or extending it. Returns null or { overlap, similarity, score } (0..1).
 */
function evaluate(target, memberPaths, maxGapMinutes, pathTo) {
  if (maxGapMinutes > matching.bufferMinutes) return null;
  const backbone = memberPaths.reduce((a, b) => (b.distanceM > a.distanceM ? b : a));
  if (!memberPaths.every((p) => pathContains(backbone, p))) return null;
  const overlap = routeOverlap(target, backbone, pathTo);
  if (overlap * 100 < matching.minRouteOverlapPercent) return null;
  if (!pathContains(backbone, target) && !pathContains(target, backbone)) return null;
  const similarity =
    memberPaths.reduce((t, p) => t + routeSimilarity(target, p, pathTo), 0) / memberPaths.length;
  const timeScore = 1 - maxGapMinutes / matching.bufferMinutes;
  const score =
    (matching.similarityWeightPercent * similarity + matching.timeWeightPercent * timeScore) / 100;
  return { overlap, similarity, score };
}

module.exports = { pathContains, sharedM, routeOverlap, routeSimilarity, evaluate };
