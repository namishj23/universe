// Carpool (P3b): students and mentors drive their own car or bike and offer seats; passengers
// book with their ride request. New code: RoutePool had only pooled autos. Reuses the
// driver-document flow (verification.js), the gender rules, the fare/split helpers and the
// matching weights. Every multi-step write is one transaction that locks the offer row first,
// then the request row, so seats can't be oversold (see docs/ALGORITHMS.md).
const { randomInt, randomUUID } = require('node:crypto');
const { verificationOf } = require('../lib/verification');
const { isFemale, wantsWomenOnly, wantsFemaleDriver } = require('../lib/genderRules');
const { costForDistance } = require('../lib/fare');
const {
  evaluatePlan,
  insertPassenger,
  splitCost,
  sharedMetres,
  score,
} = require('../lib/offerPlan');

const MIN = 60_000;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newDriverCode = () =>
  'RP-DRV-' + Array.from({ length: 6 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('');
const km = (m) => (m / 1000).toFixed(1);

module.exports = function offers(c, services) {
  const { p, cfg, prisma } = c;
  const R = p.contracts.rides;
  const O = cfg.offers;
  const limits = {
    maxPickupDelayS: O.maxPickupDelayMinutes * 60,
    maxRideFactorPercent: O.maxRideFactorPercent,
  };
  const weights = {
    route: cfg.matching.similarityWeightPercent / 100,
    time: cfg.matching.timeWeightPercent / 100,
  };
  const audit = (tx, actorId, action, targetType, targetId, metadata, requestId) =>
    p.audit.record(tx, { actorId, action, targetType, targetId, metadata, requestId });

  // ── Carpool drivers ───────────────────────────────────────────────────────────────────
  const carpoolInclude = { vehicle: true };

  async function documentsOf(userId, db = prisma) {
    return db.ridesDriverDocument.findMany({
      where: { driverId: userId },
      orderBy: [{ uploadedAt: 'desc' }, { id: 'desc' }],
    });
  }

  // Insurance and PUC are what a private car or bike legally needs on the road that day.
  const vehicleValidAt = (v, at) =>
    v.insuranceExpiresAt.getTime() > at && v.pucExpiresAt.getTime() > at;

  function carpoolView(d, docs, now = Date.now()) {
    const verification = verificationOf(docs, now);
    const v = d.vehicle;
    return {
      id: d.userId,
      driverCode: d.driverCode,
      status: d.status,
      reviewNote: d.reviewNote,
      vehicle: {
        id: v.id,
        vehicleType: v.vehicleType,
        plateNumber: v.plateNumber,
        model: v.model,
        colour: v.colour,
        seats: v.seats,
        insuranceExpiresAt: v.insuranceExpiresAt.toISOString(),
        pucExpiresAt: v.pucExpiresAt.toISOString(),
      },
      documentsVerified: verification.verified,
      documentsMessage: verification.message,
      canOffer: d.status === 'approved' && verification.verified && vehicleValidAt(v, now),
    };
  }

  async function carpoolRecord(userId, db = prisma) {
    const d = await db.ridesDriver.findUnique({ where: { userId }, include: carpoolInclude });
    return d && d.kind === 'carpool' ? d : null;
  }

  async function carpoolMe(userId) {
    const d = await carpoolRecord(userId);
    if (!d) throw c.notFound('You have not applied to drive yet.');
    return carpoolView(d, await documentsOf(userId));
  }

  const plateTaken = (err) =>
    err?.code === 'P2002'
      ? c.fail(409, 'PLATE_TAKEN', 'This registration number is already registered.')
      : err;

  async function apply(userId, body) {
    const input = R.CarpoolApplyRequest.parse(body);
    const profile = await c.ensureProfile(userId);
    c.assertNotSuspended(profile);
    const now = Date.now();
    if (Date.parse(input.insuranceExpiresAt) <= now || Date.parse(input.pucExpiresAt) <= now)
      throw c.badRequest('Insurance and PUC must be valid (expiry dates in the future).');
    const vehicle = {
      vehicleType: input.vehicleType,
      plateNumber: input.plateNumber,
      registrationNumber: input.plateNumber,
      model: input.model,
      colour: input.colour ?? null,
      seats: input.seats,
      insuranceExpiresAt: new Date(input.insuranceExpiresAt),
      pucExpiresAt: new Date(input.pucExpiresAt),
    };
    try {
      await prisma.$transaction(async (tx) => {
        const existing = await tx.ridesDriver.findUnique({ where: { userId } });
        if (existing && existing.kind !== 'carpool')
          throw c.conflict('Auto drivers use the driver portal.');
        if (existing && existing.status !== 'rejected') {
          throw c.conflict(
            existing.status === 'suspended'
              ? 'Your carpool driving is suspended. Contact the transport office.'
              : 'You have already applied to drive.',
          );
        }
        if (existing) {
          // Re-applying after a rejection: new vehicle details, back to review.
          await tx.ridesVehicle.update({ where: { id: existing.vehicleId }, data: vehicle });
          await tx.ridesDriver.update({
            where: { userId },
            data: { status: 'pending', reviewedById: null, reviewedAt: null, reviewNote: null },
          });
          return;
        }
        const v = await tx.ridesVehicle.create({ data: vehicle });
        await tx.ridesDriver.create({
          data: {
            userId,
            kind: 'carpool',
            status: 'pending',
            vehicleId: v.id,
            driverCode: newDriverCode(),
            gender: profile.gender,
          },
        });
      });
    } catch (err) {
      throw plateTaken(err);
    }
    return carpoolMe(userId);
  }

  // Same upload flow as auto drivers (POST /api/files/rides.driver_document first).
  async function addDocument(userId, body) {
    if (!(await carpoolRecord(userId))) throw c.notFound('You have not applied to drive yet.');
    await services.drivers.addDocument(userId, body);
    return carpoolMe(userId);
  }

  const offerInfo = (g, o) => ({
    offerId: o.id,
    originName: g.stop(o.originNodeId).name,
    destinationName: g.stop(o.destNodeId).name,
    departAt: o.departAt.toISOString(),
  });

  // Admin: approve, reject or suspend a carpool driver. Suspension cancels their upcoming
  // offers (passengers are told). Audited, and the driver gets an activity event.
  async function review(admin, driverId, body, requestId) {
    const { decision, note = null } = R.CarpoolReviewRequest.parse(body);
    await c.ensureProfile(admin.id);
    const g = await c.loadGraph();
    await p.transaction(async (tx, emit) => {
      const [row] =
        await tx.$queryRaw`SELECT user_id FROM rides_drivers WHERE user_id = ${driverId}::uuid AND kind = 'carpool' FOR UPDATE`;
      if (!row) throw c.notFound('Carpool driver not found');
      const d = await tx.ridesDriver.findUniqueOrThrow({ where: { userId: driverId } });
      const allowed = {
        approve: ['pending', 'suspended'],
        reject: ['pending'],
        suspend: ['approved'],
      }[decision];
      if (!allowed.includes(d.status))
        throw c.conflict(`Can't ${decision} a driver whose status is ${d.status}.`);
      if (decision === 'approve' && !verificationOf(await documentsOf(driverId, tx)).verified)
        throw c.conflict("Verify the driver's licence and inspection certificate first.");
      const status = { approve: 'approved', reject: 'rejected', suspend: 'suspended' }[decision];
      await tx.ridesDriver.update({
        where: { userId: driverId },
        data: { status, reviewedById: admin.id, reviewedAt: new Date(), reviewNote: note },
      });
      if (status === 'suspended') {
        const live = await tx.$queryRaw`
          SELECT id FROM rides_offers WHERE driver_id = ${driverId}::uuid AND status IN ('open', 'full')
          ORDER BY id FOR UPDATE`;
        for (const { id } of live) {
          const o = await tx.ridesOffer.findUniqueOrThrow({ where: { id } });
          await cancelInTx(tx, emit, g, o, admin.id, requestId);
        }
      }
      await audit(
        tx,
        admin.id,
        'rides.carpool_driver_reviewed',
        'rides_driver',
        driverId,
        { status, note },
        requestId,
      );
      await emit({
        recipients: driverId,
        actorId: admin.id,
        module: 'rides',
        type: 'rides.carpool_reviewed',
        payload: { status, note },
      });
    });
    const d = await carpoolRecord(driverId);
    return carpoolView(d, await documentsOf(driverId));
  }

  // Offer routes are authorised by an approved carpool record with cleared documents.
  async function assertCanOffer(userId, db = prisma) {
    const profile = await c.ensureProfile(userId, db);
    c.assertNotSuspended(profile);
    const d = await carpoolRecord(userId, db);
    if (!d)
      throw c.fail(
        403,
        'NOT_A_CARPOOL_DRIVER',
        'Apply to drive (and get approved) before offering rides.',
      );
    if (d.status !== 'approved')
      throw c.fail(403, 'CARPOOL_NOT_APPROVED', `Your driver application is ${d.status}.`);
    const v = verificationOf(await documentsOf(userId, db));
    if (!v.verified)
      throw c.fail(403, 'CARPOOL_NOT_APPROVED', v.message || 'Your documents need to be verified.');
    return { d, profile };
  }

  // ── Plans and money ───────────────────────────────────────────────────────────────────
  const stopsOf = (o) => (Array.isArray(o.plan) ? o.plan : []);
  const directMap = (bookings) => new Map(bookings.map((b) => [b.id, b.directM]));

  function road(g, a, b) {
    if (g.walkOnly(a) || g.walkOnly(b))
      throw c.badRequest(
        'That stop is reachable on foot only: pick a gate, parking or a city stop.',
      );
    const path = g.sp(a, b);
    if (!path) throw c.badRequest('No road route between these stops.');
    return path;
  }

  /** Writes a plan: the offer's route, totals, open/full, and each accepted booking's figures. */
  async function savePlan(tx, o, stops, acceptedIds, g) {
    const ev = evaluatePlan(g.sp, o, stops);
    if (!ev) throw c.conflict('This ride no longer has a road route.');
    const cost = splitCost(ev, o.costPerKmPaise);
    const updated = await tx.ridesOffer.update({
      where: { id: o.id },
      data: {
        plan: stops,
        planDistanceM: ev.distanceM,
        planDurationS: ev.durationS,
        peakOnboard: ev.peakOnboard,
        tripCostPaise: cost.tripCostPaise,
        driverSharePaise: cost.driverSharePaise,
        ...(['open', 'full'].includes(o.status) && {
          status: ev.peakOnboard >= o.seats ? 'full' : 'open',
        }),
      },
    });
    for (const id of acceptedIds) {
      const b = ev.byBooking.get(id);
      await tx.ridesOfferBooking.update({
        where: { id },
        data: {
          plannedPickupAt: new Date(o.departAt.getTime() + b.pickupS * 1000),
          inVehicleM: b.dropM - b.pickupM,
          costSharePaise: cost.shares.get(id),
        },
      });
    }
    return updated;
  }

  const acceptedOf = (tx, offerId) =>
    tx.ridesOfferBooking.findMany({
      where: { offerId, status: 'accepted' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

  async function lockOffer(tx, offerId) {
    const [row] =
      await tx.$queryRaw`SELECT id FROM rides_offers WHERE id = ${offerId}::uuid FOR UPDATE`;
    return row ? tx.ridesOffer.findUniqueOrThrow({ where: { id: offerId } }) : null;
  }

  const defaultDetourS = (m) => Math.round((m * 3.6) / cfg.graph.speedKmh.road);
  const minutesTo = (o, now = Date.now()) => Math.round((o.departAt.getTime() - now) / MIN);

  // ── Offers ────────────────────────────────────────────────────────────────────────────
  function checkBasics(g, input, v, profile) {
    if (input.originNodeId === input.destNodeId)
      throw c.badRequest('Origin and destination must be different stops.');
    if (!g.byId.has(input.originNodeId) || !g.byId.has(input.destNodeId))
      throw c.notFound('Stop not found');
    if (input.seats > v.seats) throw c.badRequest(`Your ${v.vehicleType} has ${v.seats} seat(s).`);
    if (input.womenOnly && !isFemale(profile))
      throw c.badRequest(
        'Women-only rides can be offered by drivers who set their gender as female.',
      );
    const departMs = input.departAt.getTime();
    if (departMs < Date.now() - MIN) throw c.badRequest('Departure must be in the future.');
    if (!vehicleValidAt(v, departMs))
      throw c.conflict("Your vehicle's insurance or PUC expires before this departure.");
    const base = road(g, input.originNodeId, input.destNodeId);
    if (base.durationS > O.maxTripMinutes * 60)
      throw c.badRequest(`Offers are limited to trips of ${O.maxTripMinutes} minutes.`);
    return base;
  }

  async function create(userId, body) {
    const input = R.CreateOfferRequest.parse(body);
    const { d, profile } = await assertCanOffer(userId);
    const g = await c.loadGraph();
    const maxDetourM = input.maxDetourM ?? O.defaultMaxDetourM;
    const offer = {
      originNodeId: input.originNodeId,
      destNodeId: input.destNodeId,
      departAt: new Date(input.departAt),
      seats: input.seats,
      womenOnly: input.womenOnly ?? false,
    };
    const base = checkBasics(g, offer, d.vehicle, profile);
    const costPerKmPaise = input.costPerKmPaise ?? O.costPerKmPaise[d.vehicle.vehicleType];
    const cost = costForDistance(base.distanceM, costPerKmPaise);
    const created = await prisma.ridesOffer.create({
      data: {
        ...offer,
        driverId: userId,
        vehicleId: d.vehicle.id,
        maxDetourM,
        maxDetourS: input.maxDetourS ?? Math.min(O.maxDetourS, defaultDetourS(maxDetourM)),
        costPerKmPaise,
        autoAccept: input.autoAccept ?? false,
        basePath: base.nodeIds,
        baseDistanceM: base.distanceM,
        baseDurationS: base.durationS,
        planDistanceM: base.distanceM,
        planDurationS: base.durationS,
        tripCostPaise: cost,
        driverSharePaise: cost,
      },
    });
    return view(userId, created.id);
  }

  // With accepted passengers, only changes that can't hurt them.
  const SAFE_WITH_PASSENGERS = [
    'seats',
    'maxDetourM',
    'maxDetourS',
    'costPerKmPaise',
    'autoAccept',
  ];

  async function update(userId, offerId, body) {
    const input = R.UpdateOfferRequest.parse(body);
    const g = await c.loadGraph();
    await p.transaction(async (tx, emit) => {
      const o = await lockOffer(tx, offerId);
      if (!o || o.driverId !== userId) throw c.notFound('Offer not found');
      if (!['open', 'full'].includes(o.status)) throw c.conflict(`This ride is ${o.status}.`);
      const { d, profile } = await assertCanOffer(userId, tx);
      const accepted = await acceptedOf(tx, o.id);
      if (accepted.length > 0) {
        const unsafe = Object.keys(input).filter((k) => !SAFE_WITH_PASSENGERS.includes(k));
        const hurts =
          (input.seats !== undefined && input.seats < o.peakOnboard) ||
          (input.maxDetourM !== undefined && input.maxDetourM < o.maxDetourM) ||
          (input.maxDetourS !== undefined && input.maxDetourS < o.maxDetourS) ||
          (input.costPerKmPaise !== undefined && input.costPerKmPaise > o.costPerKmPaise);
        if (unsafe.length || hurts)
          throw c.fail(
            409,
            'OFFER_HAS_PASSENGERS',
            'Passengers are confirmed: you can only add seats, allow more detour, lower the cost per km or change auto-accept.',
          );
      }
      const next = {
        originNodeId: input.originNodeId ?? o.originNodeId,
        destNodeId: input.destNodeId ?? o.destNodeId,
        departAt: input.departAt ? new Date(input.departAt) : o.departAt,
        seats: input.seats ?? o.seats,
        womenOnly: input.womenOnly ?? o.womenOnly,
      };
      const base = checkBasics(g, next, d.vehicle, profile);
      const merged = await tx.ridesOffer.update({
        where: { id: o.id },
        data: {
          ...next,
          maxDetourM: input.maxDetourM ?? o.maxDetourM,
          maxDetourS: input.maxDetourS ?? o.maxDetourS,
          costPerKmPaise: input.costPerKmPaise ?? o.costPerKmPaise,
          autoAccept: input.autoAccept ?? o.autoAccept,
          basePath: base.nodeIds,
          baseDistanceM: base.distanceM,
          baseDurationS: base.durationS,
        },
      });
      await savePlan(
        tx,
        merged,
        stopsOf(o),
        accepted.map((b) => b.id),
        g,
      );
      // A new time or women-only rule: requested seats that no longer fit are cancelled now
      // and the passenger told, so an accept can never confirm them (P7-005). Accepted
      // passengers block both changes above (OFFER_HAS_PASSENGERS).
      if (input.departAt !== undefined || input.womenOnly !== undefined)
        await dropUnfitRequests(tx, emit, g, o.id);
    });
    return view(userId, offerId);
  }

  async function dropUnfitRequests(tx, emit, g, offerId) {
    const o = await tx.ridesOffer.findUniqueOrThrow({ where: { id: offerId } });
    const requested = await tx.ridesOfferBooking.findMany({
      where: { offerId, status: 'requested' },
    });
    if (requested.length === 0) return;
    const ids = (k) => requested.map((b) => b[k]);
    const [accepted, requests, profiles] = await Promise.all([
      acceptedOf(tx, offerId),
      tx.ridesRequest.findMany({ where: { id: { in: ids('requestId') } } }),
      tx.ridesProfile.findMany({ where: { userId: { in: ids('passengerId') } } }),
    ]);
    const requestBy = new Map(requests.map((r) => [r.id, r]));
    const profileBy = new Map(profiles.map((r) => [r.userId, r]));
    const unfit = requested.filter((b) => {
      try {
        checkSeat(g, o, accepted, b.id, requestBy.get(b.requestId), profileBy.get(b.passengerId));
        return false;
      } catch (err) {
        if (err instanceof p.http.ApiError) return true;
        throw err;
      }
    });
    if (unfit.length === 0) return;
    await tx.ridesOfferBooking.updateMany({
      where: { id: { in: unfit.map((b) => b.id) } },
      data: { status: 'cancelled', decidedAt: new Date() },
    });
    await emit({
      recipients: unfit.map((b) => b.passengerId),
      actorId: o.driverId,
      module: 'rides',
      type: 'rides.seat_declined',
      payload: offerInfo(g, o),
    });
  }

  // Cancels an offer inside the caller's transaction (offer row already locked): every live
  // booking is cancelled, accepted passengers get their request back, everyone is told.
  async function cancelInTx(tx, emit, g, o, actorId, requestId) {
    const live = await tx.ridesOfferBooking.findMany({
      where: { offerId: o.id, status: { in: ['requested', 'accepted'] } },
    });
    await tx.ridesOffer.update({
      where: { id: o.id },
      data: { status: 'cancelled', cancelledAt: new Date() },
    });
    await tx.ridesOfferBooking.updateMany({
      where: { id: { in: live.map((b) => b.id) } },
      data: { status: 'cancelled', decidedAt: new Date() },
    });
    const reopen = live.filter((b) => b.status === 'accepted').map((b) => b.requestId);
    await tx.ridesRequest.updateMany({
      where: { id: { in: reopen }, status: 'matched' },
      data: { status: 'open' },
    });
    const minutes = minutesTo(o);
    if (minutes < O.lateCancelMinutes) {
      await audit(
        tx,
        actorId,
        'rides.offer_cancelled_late',
        'rides_offer',
        o.id,
        {
          minutesToDeparture: minutes,
          passengers: reopen.length,
        },
        requestId,
      );
    }
    if (live.length) {
      await emit({
        recipients: live.map((b) => b.passengerId),
        actorId,
        module: 'rides',
        type: 'rides.offer_cancelled',
        payload: offerInfo(g, o),
      });
    }
  }

  async function cancel(userId, offerId, requestId) {
    const g = await c.loadGraph();
    await p.transaction(async (tx, emit) => {
      const o = await lockOffer(tx, offerId);
      if (!o || o.driverId !== userId) throw c.notFound('Offer not found');
      if (!['open', 'full'].includes(o.status)) throw c.conflict(`This ride is ${o.status}.`);
      await cancelInTx(tx, emit, g, o, userId, requestId);
    });
    return view(userId, offerId);
  }

  async function depart(userId, offerId, requestId) {
    const g = await c.loadGraph();
    await p.transaction(async (tx, emit) => {
      const o = await lockOffer(tx, offerId);
      if (!o || o.driverId !== userId) throw c.notFound('Offer not found');
      if (!['open', 'full'].includes(o.status)) throw c.conflict(`This ride is ${o.status}.`);
      if (minutesTo(o) > O.departEarlyMinutes)
        throw c.conflict(
          `You can start the ride from ${O.departEarlyMinutes} minutes before departure.`,
        );
      const accepted = await acceptedOf(tx, o.id);
      await tx.ridesOffer.update({
        where: { id: o.id },
        data: { status: 'departed', departedAt: new Date() },
      });
      // Seat requests nobody answered can no longer be met.
      await tx.ridesOfferBooking.updateMany({
        where: { offerId: o.id, status: 'requested' },
        data: { status: 'declined', decidedAt: new Date() },
      });
      await audit(
        tx,
        userId,
        'rides.offer_departed',
        'rides_offer',
        o.id,
        { passengers: accepted.length },
        requestId,
      );
      if (accepted.length) {
        await emit({
          recipients: accepted.map((b) => b.passengerId),
          actorId: userId,
          module: 'rides',
          type: 'rides.offer_departing',
          payload: offerInfo(g, o),
        });
      }
    });
    return view(userId, offerId);
  }

  async function complete(userId, offerId, requestId) {
    await prisma.$transaction(async (tx) => {
      const o = await lockOffer(tx, offerId);
      if (!o || o.driverId !== userId) throw c.notFound('Offer not found');
      if (o.status !== 'departed') throw c.conflict('Start the ride before completing it.');
      const accepted = await acceptedOf(tx, o.id);
      await tx.ridesOffer.update({
        where: { id: o.id },
        data: { status: 'completed', completedAt: new Date() },
      });
      await tx.ridesRequest.updateMany({
        where: { id: { in: accepted.map((b) => b.requestId) } },
        data: { status: 'completed' },
      });
      await audit(
        tx,
        userId,
        'rides.offer_completed',
        'rides_offer',
        o.id,
        { passengers: accepted.length },
        requestId,
      );
    });
    return view(userId, offerId);
  }

  // ── Bookings ──────────────────────────────────────────────────────────────────────────
  const REASONS = {
    detour: (r, o) =>
      `Detour ${km(r.addedDetourM)} km is over this driver's ${km(o.maxDetourM)} km limit`,
    detour_time: () => 'The detour would take longer than this driver allows',
    delay: () =>
      `It would move a confirmed passenger's pickup by more than ${O.maxPickupDelayMinutes} minutes`,
    ride_length: () =>
      `Someone's ride would become more than ${O.maxRideFactorPercent / 100}× their direct route`,
    seats: () => 'No seat is free for your whole stretch',
    no_route: () => 'No road route to your pickup or drop',
  };
  const reasonText = (r, o) => REASONS[r.reason](r, o);

  // Pickup and drop for a new passenger, as insertPassenger needs them.
  const passengerOf = (bookingId, request, g) => ({
    bookingId,
    pickupNodeId: request.pickupNodeId,
    dropNodeId: request.dropNodeId,
    directM: g.sp(request.pickupNodeId, request.dropNodeId)?.distanceM ?? request.distanceM,
  });

  async function emitToDriver(emit, o, g, passengerId, type) {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: passengerId },
      select: { name: true },
    });
    await emit({
      recipients: o.driverId,
      actorId: passengerId,
      module: 'rides',
      type,
      payload: { ...offerInfo(g, o), passengerFirstName: c.firstNameOf(user.name) },
    });
  }

  // Accepts `booking` (status requested, or new) inside the transaction: re-plans with the
  // passenger inserted at the cheapest feasible position, marks their request matched and
  // withdraws their other seat requests. The offer and request rows are already locked.
  /**
   * Whether this passenger (current profile) and request fit the offer as it is now: the
   * women-only rule, a seat and detour insertion, and the pickup within the time buffer.
   * One check for a seat request, a driver's accept and an offer edit (P7-005). Throws.
   */
  function checkSeat(g, o, accepted, bookingId, request, profile, noSeatPrefix = '') {
    if (o.womenOnly && !isFemale(profile))
      throw c.fail(403, 'GROUP_ACCESS', 'This is a women-only ride.');
    const fit = insertPassenger(
      g.sp,
      o,
      stopsOf(o),
      directMap(accepted),
      passengerOf(bookingId, request, g),
      limits,
    );
    if (!fit.ok) throw c.fail(409, 'NO_SEAT', `${noSeatPrefix}${reasonText(fit, o)}.`);
    const planned = fit.ev.byBooking.get(bookingId);
    const pickupAt = new Date(o.departAt.getTime() + planned.pickupS * 1000);
    if (Math.abs(pickupAt.getTime() - request.pickupAt.getTime()) > c.bufferMs)
      throw c.fail(
        409,
        'TIME_WINDOW_MISMATCH',
        `This ride would pick you up more than ${cfg.matching.bufferMinutes} minutes from your time.`,
      );
    return { fit, planned, pickupAt };
  }

  async function acceptInTx(tx, emit, g, o, booking, request) {
    const accepted = await acceptedOf(tx, o.id);
    const passenger = await tx.ridesProfile.findUnique({ where: { userId: booking.passengerId } });
    const { fit } = checkSeat(
      g,
      o,
      accepted,
      booking.id,
      request,
      passenger,
      "Can't fit this passenger: ",
    );
    await tx.ridesOfferBooking.update({
      where: { id: booking.id },
      data: { status: 'accepted', decidedAt: new Date(), addedDetourM: fit.addedDetourM },
    });
    await savePlan(tx, o, fit.stops, [...accepted.map((b) => b.id), booking.id], g);
    await tx.ridesRequest.update({ where: { id: request.id }, data: { status: 'matched' } });
    await tx.ridesOfferBooking.updateMany({
      where: { requestId: request.id, status: 'requested', id: { not: booking.id } },
      data: { status: 'cancelled', decidedAt: new Date() },
    });
    await emit({
      recipients: booking.passengerId,
      actorId: o.driverId,
      module: 'rides',
      type: 'rides.seat_accepted',
      payload: offerInfo(g, o),
    });
  }

  async function lockRequest(tx, requestId) {
    await tx.$queryRaw`SELECT id FROM rides_requests WHERE id = ${requestId}::uuid FOR UPDATE`;
    return tx.ridesRequest.findUnique({ where: { id: requestId } });
  }

  async function requestSeat(userId, offerId, body) {
    const { requestId } = R.BookSeatRequest.parse(body);
    const profile = await c.ensureProfile(userId);
    c.assertNotSuspended(profile);
    const g = await c.loadGraph();
    await p.transaction(async (tx, emit) => {
      const o = await lockOffer(tx, offerId);
      if (!o) throw c.notFound('Offer not found');
      if (o.driverId === userId) throw c.conflict("You can't book a seat on your own ride.");
      if (!['open', 'full'].includes(o.status) || o.departAt.getTime() < Date.now())
        throw c.conflict('This ride is no longer taking passengers.');
      const request = await lockRequest(tx, requestId);
      if (!request || request.userId !== userId) throw c.notFound('Ride request not found');
      if (request.status !== 'open') throw c.conflict('This ride request is no longer open.');

      const existing = await tx.ridesOfferBooking.findUnique({
        where: { offerId_passengerId: { offerId, passengerId: userId } },
      });
      if (existing && existing.status !== 'cancelled') {
        throw c.conflict(
          existing.status === 'declined'
            ? 'The driver declined your request for this ride.'
            : 'You already asked for a seat on this ride.',
        );
      }
      const id = existing?.id ?? randomUUID();
      const accepted = await acceptedOf(tx, o.id);
      const { fit, planned, pickupAt } = checkSeat(g, o, accepted, id, request, profile);
      const cost = splitCost(fit.ev, o.costPerKmPaise);
      const data = {
        requestId: request.id,
        pickupNodeId: request.pickupNodeId,
        dropNodeId: request.dropNodeId,
        status: 'requested',
        addedDetourM: fit.addedDetourM,
        plannedPickupAt: pickupAt,
        inVehicleM: planned.dropM - planned.pickupM,
        directM: passengerOf(id, request, g).directM,
        costSharePaise: cost.shares.get(id),
        soloFarePaise: request.soloFarePaise,
        decidedAt: null,
      };
      const booking = existing
        ? await tx.ridesOfferBooking.update({ where: { id }, data })
        : await tx.ridesOfferBooking.create({
            data: { id, offerId, passengerId: userId, ...data },
          });
      await emitToDriver(emit, o, g, userId, 'rides.seat_requested');
      if (o.autoAccept) await acceptInTx(tx, emit, g, o, booking, request);
    });
    return view(userId, offerId);
  }

  // Driver: accept or decline a seat request on their own offer (anyone else: 404).
  async function decide(userId, bookingId, accept) {
    const peek = await prisma.ridesOfferBooking.findUnique({ where: { id: bookingId } });
    if (!peek) throw c.notFound('Booking not found');
    const g = await c.loadGraph();
    await p.transaction(async (tx, emit) => {
      const o = await lockOffer(tx, peek.offerId);
      if (!o || o.driverId !== userId) throw c.notFound('Booking not found');
      const booking = await tx.ridesOfferBooking.findUniqueOrThrow({ where: { id: bookingId } });
      if (booking.status !== 'requested')
        throw c.conflict(`This request is already ${booking.status}.`);
      if (!accept) {
        await tx.ridesOfferBooking.update({
          where: { id: bookingId },
          data: { status: 'declined', decidedAt: new Date() },
        });
        await emit({
          recipients: booking.passengerId,
          actorId: userId,
          module: 'rides',
          type: 'rides.seat_declined',
          payload: offerInfo(g, o),
        });
        return;
      }
      if (!['open', 'full'].includes(o.status) || o.departAt.getTime() < Date.now())
        throw c.conflict('This ride is no longer taking passengers.');
      const request = await lockRequest(tx, booking.requestId);
      if (!request || request.status !== 'open') {
        await tx.ridesOfferBooking.update({
          where: { id: bookingId },
          data: { status: 'cancelled', decidedAt: new Date() },
        });
        throw c.conflict('This passenger has already found another ride.');
      }
      await acceptInTx(tx, emit, g, o, booking, request);
    });
    return view(userId, peek.offerId);
  }

  // Passenger: withdraw a request or give up an accepted seat (re-plans for the others).
  async function cancelBooking(userId, bookingId, requestId) {
    const peek = await prisma.ridesOfferBooking.findUnique({ where: { id: bookingId } });
    if (!peek || peek.passengerId !== userId) throw c.notFound('Booking not found');
    const g = await c.loadGraph();
    await p.transaction(async (tx, emit) => {
      const o = await lockOffer(tx, peek.offerId);
      const booking = await tx.ridesOfferBooking.findUniqueOrThrow({ where: { id: bookingId } });
      if (!['requested', 'accepted'].includes(booking.status))
        throw c.conflict(`This booking is already ${booking.status}.`);
      if (!['open', 'full'].includes(o.status)) throw c.conflict(`This ride is ${o.status}.`);
      await tx.ridesOfferBooking.update({
        where: { id: bookingId },
        data: { status: 'cancelled', decidedAt: new Date() },
      });
      if (booking.status === 'accepted') {
        await tx.ridesRequest.updateMany({
          where: { id: booking.requestId, status: 'matched' },
          data: { status: 'open' },
        });
        const rest = await acceptedOf(tx, o.id);
        const stops = stopsOf(o).filter((s) => s.bookingId !== bookingId);
        await savePlan(
          tx,
          o,
          stops,
          rest.map((b) => b.id),
          g,
        );
        const minutes = minutesTo(o);
        if (minutes < O.lateCancelMinutes) {
          await audit(
            tx,
            userId,
            'rides.booking_cancelled_late',
            'rides_offer_booking',
            bookingId,
            {
              offerId: o.id,
              minutesToDeparture: minutes,
            },
            requestId,
          );
        }
      }
      await emitToDriver(emit, o, g, userId, 'rides.booking_cancelled');
    });
    // No longer a member, so no offer view: just the acknowledgement.
    return { cancelled: true, bookingId, offerId: peek.offerId };
  }

  // ── Views ─────────────────────────────────────────────────────────────────────────────
  const offerInclude = {
    driver: { include: { user: { select: { name: true } } } },
    vehicle: true,
    bookings: {
      where: { status: { in: ['requested', 'accepted'] } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { passenger: { include: { user: { select: { name: true } } } } },
    },
  };

  function describe(g, o, userId) {
    const isDriver = o.driverId === userId;
    const firstName = new Map(o.bookings.map((b) => [b.id, c.firstNameOf(b.passenger.user.name)]));
    const ev = evaluatePlan(g.sp, o, stopsOf(o));
    const at = (s) => new Date(o.departAt.getTime() + s * 1000).toISOString();
    // A passenger sees the confirmed passengers and their own request; the driver sees all.
    const visible = o.bookings.filter(
      (b) => isDriver || b.status === 'accepted' || b.passengerId === userId,
    );
    return {
      id: o.id,
      status: o.status,
      isDriver,
      driverFirstName: c.firstNameOf(o.driver.user.name),
      vehicle: {
        vehicleType: o.vehicle.vehicleType,
        model: o.vehicle.model,
        colour: o.vehicle.colour,
        plateNumber: o.vehicle.plateNumber,
      },
      origin: g.stop(o.originNodeId),
      destination: g.stop(o.destNodeId),
      departAt: o.departAt.toISOString(),
      seats: o.seats,
      peakOnboard: o.peakOnboard,
      maxDetourM: o.maxDetourM,
      maxDetourS: o.maxDetourS,
      costPerKmPaise: o.costPerKmPaise,
      autoAccept: o.autoAccept,
      womenOnly: o.womenOnly,
      baseDistanceM: o.baseDistanceM,
      planDistanceM: o.planDistanceM,
      planDurationS: o.planDurationS,
      tripCostPaise: o.tripCostPaise,
      driverSharePaise: o.driverSharePaise,
      route: (ev?.nodePath ?? o.basePath).map((id) => g.stop(id).name),
      plan: (ev?.points ?? []).map((pt) => ({
        type: pt.type,
        stop: g.stop(pt.nodeId),
        passengerFirstName: pt.bookingId ? (firstName.get(pt.bookingId) ?? null) : null,
        atM: pt.atM,
        at: at(pt.atS),
      })),
      bookings: visible.map((b) => ({
        id: b.id,
        status: b.status,
        passengerFirstName: firstName.get(b.id),
        isYou: b.passengerId === userId,
        pickup: g.stop(b.pickupNodeId),
        drop: g.stop(b.dropNodeId),
        plannedPickupAt: b.plannedPickupAt.toISOString(),
        addedDetourM: b.addedDetourM,
        inVehicleM: b.inVehicleM,
        costSharePaise: b.costSharePaise,
        soloFarePaise: b.soloFarePaise,
        savingsPaise: Math.max(0, b.soloFarePaise - b.costSharePaise),
      })),
    };
  }

  // Members only: the driver, or a passenger with a live booking. Anyone else gets 404.
  async function view(userId, offerId) {
    const [o, g] = await Promise.all([
      prisma.ridesOffer.findUnique({ where: { id: offerId }, include: offerInclude }),
      c.loadGraph(),
    ]);
    if (!o) throw c.notFound('Offer not found');
    if (o.driverId !== userId) {
      const mine = await prisma.ridesOfferBooking.findUnique({
        where: { offerId_passengerId: { offerId, passengerId: userId } },
        select: { status: true },
      });
      if (!mine || !['requested', 'accepted'].includes(mine.status))
        throw c.notFound('Offer not found');
    }
    return describe(g, o, userId);
  }

  // My offers as a driver, latest departure first.
  async function mine(userId, query) {
    const { cursor, limit } = c.pageQuery(query);
    const [rows, g] = await Promise.all([
      prisma.ridesOffer.findMany({
        where: { driverId: userId, ...c.beforeDesc('departAt', cursor) },
        orderBy: [{ departAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        include: offerInclude,
      }),
      c.loadGraph(),
    ]);
    return c.toPage(
      rows,
      limit,
      (o) => o.departAt,
      (o) => describe(g, o, userId),
    );
  }

  // Offers I booked (requested or accepted), latest pickup first, in two queries.
  async function myBookings(userId, query) {
    const { cursor, limit } = c.pageQuery(query);
    const bookings = await prisma.ridesOfferBooking.findMany({
      where: {
        passengerId: userId,
        status: { in: ['requested', 'accepted'] },
        ...c.beforeDesc('plannedPickupAt', cursor),
      },
      orderBy: [{ plannedPickupAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: { id: true, offerId: true, plannedPickupAt: true },
    });
    const ids = bookings.slice(0, limit).map((b) => b.offerId);
    const [offers, g] = await Promise.all([
      prisma.ridesOffer.findMany({ where: { id: { in: ids } }, include: offerInclude }),
      c.loadGraph(),
    ]);
    const byId = new Map(offers.map((o) => [o.id, o]));
    return c.toPage(
      bookings,
      limit,
      (b) => b.plannedPickupAt,
      (b) => describe(g, byId.get(b.offerId), userId),
    );
  }

  // ── Matching ──────────────────────────────────────────────────────────────────────────
  const HIDDEN = {
    full: () => 'no seats left',
    time: () => `pickup outside ±${cfg.matching.bufferMinutes} min`,
    women_only_group: () => 'women-only ride',
    not_women_only: () => 'not women-only (you chose women-only rides)',
    driver_preference: () => 'driver is not female (your driver preference)',
  };

  /**
   * Open offers this request could ride, best first, with the score breakdown and the added
   * detour. Step 1 is one SQL query on (status, depart_at) that also labels rows hidden by
   * seats or the gender rules (counted, no graph work); step 2 is the insertion plan per
   * offer; step 3 the score. Offers whose insertion breaks a hard rule are returned with
   * eligible = false and the reason; those outside the pickup window are counted as hidden.
   */
  async function matches(userId, query) {
    const q = R.OfferMatchesQuery.parse(query);
    const request = await prisma.ridesRequest.findUnique({ where: { id: q.requestId } });
    if (!request || request.userId !== userId) throw c.notFound('Ride request not found');
    // A request that found its seat (matched) still lists matches, so the rider sees the car
    // they are in next to the alternatives (P6).
    if (!['open', 'matched'].includes(request.status))
      throw c.badRequest('This request is no longer open');
    const [profile, g] = await Promise.all([c.ensureProfile(userId), c.loadGraph()]);
    const relax = q.relaxPreference === 'true';
    const female = isFemale(profile);
    const wantWomenOnly = wantsWomenOnly(profile) && !relax;
    const wantFemaleDriver = wantsFemaleDriver(profile) && !relax;
    const desired = request.pickupAt.getTime();
    const earliest = new Date(desired - c.bufferMs);

    const rows = await prisma.$queryRaw`
      SELECT o.id::text AS id,
             CASE WHEN o.status = 'full' THEN 'full'
                  WHEN o.women_only AND NOT ${female} THEN 'women_only_group'
                  WHEN ${wantWomenOnly} AND NOT o.women_only THEN 'not_women_only'
                  WHEN ${wantFemaleDriver} AND dp.gender IS DISTINCT FROM 'female' THEN 'driver_preference'
             END AS hidden
      FROM rides_offers o
      LEFT JOIN rides_profiles dp ON dp.user_id = o.driver_id
      WHERE o.status IN ('open', 'full')
        AND o.depart_at BETWEEN ${new Date(desired - c.bufferMs - O.maxTripMinutes * MIN)} AND ${new Date(desired + c.bufferMs)}
        AND o.depart_at + make_interval(secs => o.base_duration_s + o.max_detour_s) >= ${earliest}
        AND o.driver_id <> ${userId}::uuid
        AND NOT EXISTS (
          SELECT 1 FROM rides_offer_bookings b
          WHERE b.offer_id = o.id AND b.passenger_id = ${userId}::uuid
            AND b.status IN ('requested', 'accepted', 'declined'))`;

    const hidden = new Map();
    const hide = (reason) => hidden.set(reason, (hidden.get(reason) ?? 0) + 1);
    for (const r of rows) if (r.hidden) hide(r.hidden);
    const candidates = rows.filter((r) => !r.hidden).map((r) => r.id);
    const offersRows = candidates.length
      ? await prisma.ridesOffer.findMany({
          where: { id: { in: candidates } },
          include: {
            driver: { include: { user: { select: { name: true } } } },
            vehicle: { select: { vehicleType: true } },
            bookings: { where: { status: 'accepted' }, select: { id: true, directM: true } },
          },
        })
      : [];

    const passengerPath = g.sp(request.pickupNodeId, request.dropNodeId);
    const newId = 'you';
    const results = [];
    for (const o of offersRows) {
      const fit = insertPassenger(
        g.sp,
        o,
        stopsOf(o),
        directMap(o.bookings),
        passengerOf(newId, request, g),
        limits,
      );
      if (!fit.ev) continue; // no road at all to this request's stops
      const planned = fit.ev.byBooking.get(newId);
      const pickupAt = o.departAt.getTime() + planned.pickupS * 1000;
      const minutesApart = Math.round((Math.abs(pickupAt - desired) / MIN) * 10) / 10;
      if (minutesApart > cfg.matching.bufferMinutes) {
        hide('time');
        continue;
      }
      const shared = sharedMetres(passengerPath.nodeIds, fit.current.nodePath, g.edgeM);
      const s = score({
        sharedM: shared,
        passengerM: passengerPath.distanceM,
        routeM: fit.current.distanceM,
        minutesApart,
        bufferMinutes: cfg.matching.bufferMinutes,
        weights,
      });
      const share = splitCost(fit.ev, o.costPerKmPaise).shares.get(newId);
      results.push({
        offerId: o.id,
        eligible: fit.ok,
        reason: fit.reason,
        reasonText: fit.ok ? null : reasonText(fit, o),
        ...s,
        weights: { routeSimilarity: weights.route, timeFit: weights.time },
        minutesApart,
        addedDetourMetres: fit.addedDetourM,
        pickupAt: new Date(pickupAt).toISOString(),
        departAt: o.departAt.toISOString(),
        seatsLeft: Math.max(0, o.seats - fit.ev.peakOnboard),
        driverFirstName: c.firstNameOf(o.driver.user.name),
        vehicleType: o.vehicle.vehicleType,
        womenOnly: o.womenOnly,
        pickupNode: g.stop(request.pickupNodeId),
        dropNode: g.stop(request.dropNodeId),
        route: fit.ev.nodePath.map((id) => g.stop(id).name),
        costSharePaise: share,
        soloFarePaise: request.soloFarePaise,
        savingsPaise: Math.max(0, request.soloFarePaise - share),
        booking: null,
      });
    }
    // Offers this request already asked for or joined (the SQL above leaves them out), from
    // the booking's stored plan figures. Pooled autos are not offers, so a request matched to
    // a group just lists these (none) and the candidates.
    const booked = await prisma.ridesOfferBooking.findMany({
      where: { requestId: request.id, status: { in: ['requested', 'accepted'] } },
      include: {
        offer: {
          include: {
            driver: { include: { user: { select: { name: true } } } },
            vehicle: { select: { vehicleType: true } },
          },
        },
      },
    });
    for (const b of booked) {
      const o = b.offer;
      const ev = evaluatePlan(g.sp, o, stopsOf(o));
      const nodePath = ev?.nodePath ?? o.basePath;
      const minutesApart =
        Math.round((Math.abs(b.plannedPickupAt.getTime() - desired) / MIN) * 10) / 10;
      const s = score({
        sharedM: sharedMetres(passengerPath.nodeIds, nodePath, g.edgeM),
        passengerM: passengerPath.distanceM,
        routeM: ev?.distanceM ?? o.baseDistanceM,
        minutesApart,
        bufferMinutes: cfg.matching.bufferMinutes,
        weights,
      });
      results.push({
        offerId: o.id,
        eligible: true,
        reason: null,
        reasonText: null,
        ...s,
        weights: { routeSimilarity: weights.route, timeFit: weights.time },
        minutesApart,
        addedDetourMetres: b.addedDetourM,
        pickupAt: b.plannedPickupAt.toISOString(),
        departAt: o.departAt.toISOString(),
        seatsLeft: Math.max(0, o.seats - o.peakOnboard),
        driverFirstName: c.firstNameOf(o.driver.user.name),
        vehicleType: o.vehicle.vehicleType,
        womenOnly: o.womenOnly,
        pickupNode: g.stop(b.pickupNodeId),
        dropNode: g.stop(b.dropNodeId),
        route: nodePath.map((id) => g.stop(id).name),
        costSharePaise: b.costSharePaise,
        soloFarePaise: b.soloFarePaise,
        savingsPaise: Math.max(0, b.soloFarePaise - b.costSharePaise),
        booking: { id: b.id, status: b.status },
      });
    }
    // Deterministic: your own bookings first, then eligible, score, earlier departure, id.
    results.sort(
      (a, b) =>
        Number(Boolean(b.booking)) - Number(Boolean(a.booking)) ||
        Number(b.eligible) - Number(a.eligible) ||
        b.score - a.score ||
        a.departAt.localeCompare(b.departAt) ||
        a.offerId.localeCompare(b.offerId),
    );
    const reasons = [...hidden]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([reason, count]) => ({
        reason,
        count,
        message: `${count} hidden: ${HIDDEN[reason]()}`,
      }));
    return {
      matches: results.slice(0, q.limit),
      hidden: { total: reasons.reduce((t, r) => t + r.count, 0), reasons },
    };
  }

  // ── Graph ─────────────────────────────────────────────────────────────────────────────
  async function graphView() {
    const g = await c.loadGraph();
    return {
      nodes: g.nodes.map((n) => ({
        id: n.id,
        name: n.name,
        shortName: n.shortName,
        area: n.area,
        lat: n.lat,
        lng: n.lng,
        walkOnly: g.walkOnly(n.id),
      })),
      edges: g.edges.map((e) => ({
        nodeAId: e.nodeAId,
        nodeBId: e.nodeBId,
        distanceM: e.distanceM,
        durationS: e.durationS,
        mode: e.mode,
        estimated: e.estimated,
      })),
    };
  }

  async function route(query) {
    const { from, to } = R.RouteQuery.parse(query);
    const g = await c.loadGraph();
    if (!g.byId.has(from) || !g.byId.has(to)) throw c.notFound('Stop not found');
    const path = road(g, from, to);
    return {
      from: g.stop(from),
      to: g.stop(to),
      distanceM: path.distanceM,
      durationS: path.durationS,
      stops: path.nodeIds.map((id) => g.stop(id)),
    };
  }

  return {
    apply,
    carpoolMe,
    addDocument,
    review,
    create,
    update,
    cancel,
    depart,
    complete,
    requestSeat,
    accept: (userId, bookingId) => decide(userId, bookingId, true),
    decline: (userId, bookingId) => decide(userId, bookingId, false),
    cancelBooking,
    view,
    mine,
    myBookings,
    matches,
    graphView,
    route,
  };
};
