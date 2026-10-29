// Detour-based matching for ride offers (pure: no database, no clock). See docs/ALGORITHMS.md.
//
// An offer's plan is origin -> ordered stops -> destination, where the stops are the accepted
// passengers' pickups and drops. Adding a passenger tries every pickup position i and drop
// position j >= i (pickup always before drop): O(k^2) candidates for k planned stops, each
// checked in O(k) with shortest paths from the in-memory cache.
const { splitBySegments, costForDistance } = require('./fare');

/**
 * sp(a, b) -> { distanceM, durationS, nodeIds } | null: shortest road path (a === b allowed).
 * offer: { originNodeId, destNodeId }. stops: [{ bookingId, nodeId, type: 'pickup'|'drop' }].
 * Returns null when some leg has no road, else the route through every point with each
 * point's distance and time from the origin, the people aboard on each leg and the peak.
 */
function evaluatePlan(sp, offer, stops) {
  const points = [
    { type: 'origin', nodeId: offer.originNodeId, bookingId: null },
    ...stops,
    { type: 'destination', nodeId: offer.destNodeId, bookingId: null },
  ];
  const nodePath = [offer.originNodeId];
  let atM = 0;
  let atS = 0;
  let onboard = 0;
  let peakOnboard = 0;
  const out = [];
  const byBooking = new Map();
  for (const [i, p] of points.entries()) {
    if (i > 0) {
      const leg = sp(points[i - 1].nodeId, p.nodeId);
      if (!leg) return null;
      atM += leg.distanceM;
      atS += leg.durationS;
      nodePath.push(...leg.nodeIds.slice(1));
    }
    out.push({ ...p, atM, atS, onboardBefore: onboard });
    if (p.type === 'pickup') {
      onboard += 1;
      byBooking.set(p.bookingId, { pickupM: atM, pickupS: atS });
    } else if (p.type === 'drop') {
      onboard -= 1;
      Object.assign(byBooking.get(p.bookingId), { dropM: atM, dropS: atS });
    }
    peakOnboard = Math.max(peakOnboard, onboard);
  }
  // Metres with at least one passenger aboard (the driver's shared distance).
  let sharedM = 0;
  for (let i = 1; i < out.length; i++) {
    if (out[i].onboardBefore > 0) sharedM += out[i].atM - out[i - 1].atM;
  }
  return { distanceM: atM, durationS: atS, points: out, nodePath, byBooking, peakOnboard, sharedM };
}

/** Why a candidate plan breaks a hard rule, or null. */
function violation(offer, ev, current, directM, limits) {
  if (ev.peakOnboard > offer.seats) return { reason: 'seats' };
  const detourM = ev.distanceM - offer.baseDistanceM;
  if (detourM > offer.maxDetourM) return { reason: 'detour', detourM };
  if (ev.durationS - offer.baseDurationS > offer.maxDetourS) return { reason: 'detour_time' };
  if (current) {
    for (const [id, before] of current.byBooking) {
      const after = ev.byBooking.get(id);
      if (Math.abs(after.pickupS - before.pickupS) > limits.maxPickupDelayS)
        return { reason: 'delay' };
    }
  }
  for (const [id, b] of ev.byBooking) {
    if ((b.dropM - b.pickupM) * 100 > directM.get(id) * limits.maxRideFactorPercent)
      return { reason: 'ride_length' };
  }
  return null;
}

/**
 * Cheapest feasible insertion of a new passenger { bookingId, pickupNodeId, dropNodeId,
 * directM } into the offer's plan. `directM`: Map bookingId -> direct metres for the
 * passengers already planned. limits: { maxPickupDelayS, maxRideFactorPercent }.
 * offer: { originNodeId, destNodeId, seats, maxDetourM, maxDetourS, baseDistanceM,
 * baseDurationS }.
 * Returns { ok, stops, ev, current, addedDetourM, reason }: ok with the cheapest feasible
 * plan, or not ok with the reason (and plan) of the shortest candidate, the one the passenger
 * would have got. `current` is the plan before the passenger; ev/stops are null on no_route.
 */
function insertPassenger(sp, offer, stops, directM, passenger, limits) {
  const current = evaluatePlan(sp, offer, stops);
  const none = { ok: false, reason: 'no_route', stops: null, ev: null, current, addedDetourM: 0 };
  if (!current) return none;
  const directs = new Map(directM).set(passenger.bookingId, passenger.directM);
  const P = { bookingId: passenger.bookingId, nodeId: passenger.pickupNodeId, type: 'pickup' };
  const Q = { bookingId: passenger.bookingId, nodeId: passenger.dropNodeId, type: 'drop' };
  let best = null;
  let cheapestFailure = null;
  for (let i = 0; i <= stops.length; i++) {
    for (let j = i; j <= stops.length; j++) {
      const cand = [...stops.slice(0, i), P, ...stops.slice(i, j), Q, ...stops.slice(j)];
      const ev = evaluatePlan(sp, offer, cand);
      if (!ev) continue;
      const bad = violation(offer, ev, current, directs, limits);
      // Strictly shorter wins, so ties keep the earliest position (deterministic).
      if (bad) {
        if (!cheapestFailure || ev.distanceM < cheapestFailure.ev.distanceM)
          cheapestFailure = { stops: cand, ev, bad };
      } else if (!best || ev.distanceM < best.ev.distanceM) {
        best = { stops: cand, ev };
      }
    }
  }
  const chosen = best ?? cheapestFailure;
  if (!chosen) return none;
  return {
    ok: Boolean(best),
    reason: best ? null : cheapestFailure.bad.reason,
    stops: chosen.stops,
    ev: chosen.ev,
    current,
    addedDetourM: chosen.ev.distanceM - current.distanceM,
  };
}

/**
 * Trip cost (route metres x cost per km) split by segment among everyone aboard, the driver
 * counted as one person for the whole route. Shares sum exactly to the trip cost.
 * Returns { tripCostPaise, driverSharePaise, shares: Map(bookingId -> paise) }.
 */
function splitCost(ev, perKmPaise) {
  const people = [{ userId: '__driver', boardM: 0, dropM: ev.distanceM }];
  for (const [id, b] of ev.byBooking) people.push({ userId: id, boardM: b.pickupM, dropM: b.dropM });
  const routeStops = ev.points.map((p) => ({ cumulativeM: p.atM }));
  const { totalPaise, shares } = splitBySegments(routeStops, people, (m) =>
    costForDistance(m, perKmPaise),
  );
  const driverSharePaise = shares.get('__driver');
  shares.delete('__driver');
  return { tripCostPaise: totalPaise, driverSharePaise, shares };
}

/**
 * Metres of `pathNodeIds` (the passenger's shortest path) driven along `routeNodeIds` in the
 * same direction. edgeM(a, b) = the edge's length.
 */
function sharedMetres(pathNodeIds, routeNodeIds, edgeM) {
  const onRoute = new Set();
  for (let i = 1; i < routeNodeIds.length; i++)
    onRoute.add(`${routeNodeIds[i - 1]}>${routeNodeIds[i]}`);
  let shared = 0;
  for (let i = 1; i < pathNodeIds.length; i++) {
    if (onRoute.has(`${pathNodeIds[i - 1]}>${pathNodeIds[i]}`))
      shared += edgeM(pathNodeIds[i - 1], pathNodeIds[i]);
  }
  return shared;
}

const round3 = (x) => Math.round(x * 1000) / 1000;

/**
 * The ranking used for both ride types: score = w_route x routeSimilarity + w_time x timeFit,
 * from components rounded to 3 decimals so the breakdown adds up as shown.
 */
function score({ sharedM, passengerM, routeM, minutesApart, bufferMinutes, weights }) {
  const routeSimilarity = round3(Math.max(passengerM, routeM) > 0 ? sharedM / Math.max(passengerM, routeM) : 1);
  const overlapRatio = round3(passengerM > 0 ? sharedM / passengerM : 1);
  const timeFit = round3(Math.max(0, 1 - minutesApart / bufferMinutes));
  return {
    score: round3(weights.route * routeSimilarity + weights.time * timeFit),
    routeSimilarity,
    overlapRatio,
    timeFit,
  };
}

module.exports = { evaluatePlan, insertPassenger, splitCost, sharedMetres, score };
