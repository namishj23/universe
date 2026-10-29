// Rides demo data, run by `npm run db:seed` after the platform seed (which creates the driver
// accounts). Idempotent: stops, edges, vehicles and drivers are upserted by natural keys,
// documents are added only to drivers that have none, and demo rides only when no upcoming
// group exists. Demo rides go through the real services, so their fares are the real ones.
const { randomInt } = require('node:crypto');
const { STOP_NODES, STOP_EDGES, stopId } = require('./data/stops');
const { assertValidGraph } = require('./lib/graph');
const { DEMO_DRIVERS, VEHICLE_OFFSETS, STATE_DEMO_DRIVERS, driverEmail } = require('./data/roster');

const DAY = 86_400_000;
const MIN = 60_000;
const IST_MS = 330 * MIN;
const istDate = (t) => new Date(t + IST_MS).toISOString().slice(0, 10);
/** `days` after today (Asia/Kolkata) at `hh:mm` IST. */
const istAt = (now, days, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(
    Date.parse(`${istDate(now + days * DAY)}T00:00:00Z`) - IST_MS + (h * 60 + m) * MIN,
  );
};
/** Days from today to the next Monday (IST), 1–7 (the hub seed puts the mentor session there). */
const nextMonday = (now) => {
  for (let d = 1; d <= 7; d += 1)
    if (new Date(Date.parse(`${istDate(now + d * DAY)}T00:00:00Z`)).getUTCDay() === 1) return d;
  return 7;
};
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newDriverCode = () =>
  'RP-DRV-' + Array.from({ length: 6 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('');
// A minimal valid PDF: placeholder bytes for the demo documents.
const DEMO_PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

module.exports = async function seed(platform, c, s) {
  const { prisma } = platform;
  const now = Date.now();
  const inDays = (n) => new Date(now + n * DAY);

  // Stops (PostGIS geography, so raw tagged SQL) and the edges between them (road, campus
  // road, walking path), then the stored graph is validated as a whole.
  for (const n of STOP_NODES) {
    await prisma.$executeRaw`
      INSERT INTO rides_nodes (id, name, short_name, area, aliases, geom)
      VALUES (${n.id}::uuid, ${n.name}, ${n.shortName}, ${n.area}, ${n.aliases},
              ST_SetSRID(ST_MakePoint(${n.lng}, ${n.lat}), 4326)::geography)
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, short_name = EXCLUDED.short_name,
        area = EXCLUDED.area, aliases = EXCLUDED.aliases, geom = EXCLUDED.geom`;
  }
  for (const e of STOP_EDGES) {
    await prisma.ridesRouteEdge.upsert({
      where: { nodeAId_nodeBId: { nodeAId: e.nodeAId, nodeBId: e.nodeBId } },
      create: e,
      update: {
        distanceM: e.distanceM,
        durationS: e.durationS,
        mode: e.mode,
        estimated: e.estimated,
      },
    });
  }
  assertValidGraph(
    await prisma.ridesNode.findMany({ select: { id: true, name: true } }),
    await prisma.ridesRouteEdge.findMany(),
    'database after seed',
  );

  // The seven autos, with Module B's document offsets (two are off the road on purpose).
  const vehicleIds = [];
  for (const [i, d] of DEMO_DRIVERS.entries()) {
    const o = VEHICLE_OFFSETS[i % VEHICLE_OFFSETS.length];
    const v = await prisma.ridesVehicle.upsert({
      where: { plateNumber: d.plateNumber },
      update: {},
      create: {
        plateNumber: d.plateNumber,
        registrationNumber: d.plateNumber.replace(/\s/g, ''),
        model: d.vehicle,
        colour: 'Yellow & black',
        permitExpiresAt: inDays(o.permit),
        insuranceExpiresAt: inDays(o.insurance),
        pucExpiresAt: inDays(o.puc),
        fitnessExpiresAt: inDays(o.fitness),
        lastServiceAt: inDays(o.service),
        drivenM: o.drivenKm * 1000,
      },
    });
    vehicleIds.push(v.id);
  }

  // Driver accounts (users made by the platform seed) -> rides_drivers + documents.
  const users = await prisma.user.findMany({
    where: {
      email: { in: [...DEMO_DRIVERS, ...STATE_DEMO_DRIVERS].map((d) => driverEmail(d.name)) },
    },
    select: { id: true, email: true },
  });
  const userByEmail = new Map(users.map((u) => [u.email, u.id]));
  const addDocuments = async (userId, uploadedDaysAgo) => {
    if (await prisma.ridesDriverDocument.count({ where: { driverId: userId } })) return;
    for (const [type, daysAgo] of Object.entries(uploadedDaysAgo)) {
      const file = await platform.files.save({
        ownerId: userId,
        module: 'rides',
        purpose: 'rides.driver_document',
        originalName: `${type}.pdf`,
        mimeType: 'application/pdf',
        bytes: DEMO_PDF,
      });
      const at = new Date(now - daysAgo * DAY);
      await prisma.ridesDriverDocument.create({
        data: {
          driverId: userId,
          type,
          fileId: file.id,
          status: 'verified',
          uploadedAt: at,
          reviewedAt: at,
        },
      });
    }
  };
  const upsertDriver = (userId, data) =>
    prisma.ridesDriver.upsert({
      where: { userId },
      update: {},
      create: { userId, driverCode: newDriverCode(), ...data },
    });

  for (const [i, d] of DEMO_DRIVERS.entries()) {
    const userId = userByEmail.get(driverEmail(d.name));
    if (!userId) continue;
    await upsertDriver(userId, {
      vehicleId: vehicleIds[i],
      gender: d.gender,
      ratingTenths: Math.round(Number(d.rating) * 10),
      online: true,
    });
    await addDocuments(userId, { licence: 20, inspection_certificate: 20 });
  }
  for (const d of STATE_DEMO_DRIVERS) {
    const userId = userByEmail.get(driverEmail(d.name));
    if (!userId) continue;
    await upsertDriver(userId, { gender: d.gender });
    // Valid for 6 months from upload: uploaded ~5 months 20 days ago -> expires in ~10 days.
    if (d.state === 'licence_expiring')
      await addDocuments(userId, { licence: 172, inspection_certificate: 20 });
  }

  // Rider profiles for every demo user. Diya (student2) and Ishita are female riders without
  // women-only rides; Sneha is the female rider with women-only rides on (P6).
  const demo = await prisma.user.findMany({
    where: { email: { endsWith: '@universe.test' } },
    select: { id: true, email: true },
  });
  const idOf = (email) => demo.find((u) => u.email === email)?.id;
  for (const u of demo) await c.ensureProfile(u.id);
  const PROFILES = {
    'student2@universe.test': { gender: 'female', womenOnlyGroups: false },
    'ishita.rao@universe.test': { gender: 'female', womenOnlyGroups: false },
    'sneha.patil@universe.test': { gender: 'female', womenOnlyGroups: true },
    'kabir.shah@universe.test': { gender: 'male', womenOnlyGroups: false },
  };
  for (const [email, data] of Object.entries(PROFILES)) {
    const userId = idOf(email);
    if (userId) await prisma.ridesProfile.update({ where: { userId }, data });
  }

  const student = idOf('student@universe.test'); // Aarav Mehta
  const diya = idOf('student2@universe.test');
  const mentor = idOf('mentor@universe.test'); // Prof. Neha Iyer
  const kabir = idOf('kabir.shah@universe.test');
  const ishita = idOf('ishita.rao@universe.test');
  const sneha = idOf('sneha.patil@universe.test');
  const rahul = idOf('rahul.verma@universe.test');
  const cast = [student, diya, mentor, kabir, ishita, sneha, rahul];

  // Pooled autos (P3a) relative to now, so pooled matching has something to show. Not Aarav:
  // his week strip is the design's.
  const upcoming = await prisma.ridesGroup.count({
    where: { pickupAt: { gt: new Date(now) }, status: { not: 'cancelled' } },
  });
  if (upcoming === 0 && cast.every(Boolean)) {
    const at = (minutes) => new Date(now + minutes * 60_000).toISOString();
    const start = async (userId, pickupText, dropText, minutes) => {
      const req = await s.riders.createRequest(userId, {
        pickupText,
        dropText,
        pickupTime: at(minutes),
      });
      return s.riders.join(userId, { rideRequestId: req.id, memberRideRequestIds: [req.id] });
    };
    await start(rahul, 'Azad Nagar', 'Ghatkopar', 90);
    await start(sneha, 'SPIT', 'Marol Naka', 120); // a women-only group (her preference)
    // An open request on the Azad Nagar line, to show up as a match for the group above.
    await s.riders.createRequest(kabir, {
      pickupText: 'Azad Nagar',
      dropText: 'Andheri',
      pickupTime: at(93),
    });
  }

  // Carpool drivers (P3b, P6): Neha, Diya, Kabir and Ishita drive cars with three seats; all
  // approved with verified documents.
  const carpoolers = [
    [mentor, 'MH02AB1234', 'Maruti Swift', 'White'],
    [diya, 'MH47CD5678', 'Hyundai i20', 'Red'],
    [kabir, 'MH02EF4321', 'Tata Altroz', 'Blue'],
    [ishita, 'MH03GH8765', 'Honda Amaze', 'Silver'],
  ].filter(([userId]) => userId);
  for (const [userId, plateNumber, model, colour] of carpoolers) {
    if (await prisma.ridesDriver.findUnique({ where: { userId } })) continue;
    const v = await prisma.ridesVehicle.create({
      data: {
        vehicleType: 'car',
        plateNumber,
        registrationNumber: plateNumber,
        model,
        colour,
        seats: 3,
        insuranceExpiresAt: inDays(200),
        pucExpiresAt: inDays(120),
      },
    });
    const profile = await prisma.ridesProfile.findUniqueOrThrow({ where: { userId } });
    await upsertDriver(userId, {
      kind: 'carpool',
      status: 'approved',
      vehicleId: v.id,
      gender: profile.gender,
      reviewedAt: new Date(now),
    });
    await addDocuments(userId, { licence: 30, inspection_certificate: 30 });
  }

  // The demo week (only on the first seed; `npm run demo:reset` starts it again). Times are
  // Asia/Kolkata wall clock on days relative to today; every ride goes through the services,
  // so plans, fares and events are the real ones.
  if (!cast.every(Boolean) || (await prisma.ridesOffer.count()) > 0) return;
  const stop = (name) => stopId(name);
  const BORIVALI = stop('Borivali Station');
  const DAHISAR = stop('Dahisar');
  const MALAD = stop('Malad');
  const SPIT = stop('SPIT Campus (Gate 2)');
  const MAIN_GATE = stop('SPIT Main Gate');
  const minutesFrom = async (from, to) => (await s.offers.route({ from, to })).durationS / 60;
  const offer = (driver, originNodeId, destNodeId, departAt, extra = {}) =>
    s.offers.create(driver, {
      originNodeId,
      destNodeId,
      departAt: departAt.toISOString(),
      seats: 3,
      ...extra,
    });
  const ask = (userId, pickupNodeId, dropNodeId, pickupAt) =>
    s.riders.createRequest(userId, {
      pickupNodeId,
      dropNodeId,
      pickupTime: pickupAt.toISOString(),
    });
  const book = async (userId, o, pickupNodeId, dropNodeId) => {
    const pickupAt = new Date(
      Date.parse(o.departAt) + (await minutesFrom(o.origin.id, pickupNodeId)) * MIN,
    );
    const r = await ask(userId, pickupNodeId, dropNodeId, pickupAt);
    const view = await s.offers.requestSeat(userId, o.id, { requestId: r.id });
    return { request: r, bookingId: view.bookings.find((b) => b.isYou).id };
  };

  // A completed ride (P3b): offered, booked, accepted, departed and completed through the
  // services (so every figure is the real one), then moved to yesterday. Feeds Aarav's savings.
  const done = await offer(mentor, BORIVALI, SPIT, new Date(now + 20 * MIN));
  const toMalad = await s.offers.route({ from: BORIVALI, to: MALAD });
  const req = await s.riders.createRequest(student, {
    pickupNodeId: MALAD,
    dropNodeId: stop('Andheri'),
    pickupTime: new Date(Date.parse(done.departAt) + toMalad.durationS * 1000).toISOString(),
  });
  const booked = await s.offers.requestSeat(student, done.id, { requestId: req.id });
  await s.offers.accept(mentor, booked.bookings[0].id);
  await s.offers.depart(mentor, done.id, null);
  await s.offers.complete(mentor, done.id, null);
  const back = 86_400_000;
  await prisma.$executeRaw`
    UPDATE rides_offers SET depart_at = depart_at - ${back} * interval '1 millisecond',
      departed_at = departed_at - ${back} * interval '1 millisecond',
      completed_at = completed_at - ${back} * interval '1 millisecond'
    WHERE id = ${done.id}::uuid`;
  await prisma.$executeRaw`
    UPDATE rides_offer_bookings SET planned_pickup_at = planned_pickup_at - ${back} * interval '1 millisecond'
    WHERE offer_id = ${done.id}::uuid`;
  await prisma.$executeRaw`
    UPDATE rides_requests SET pickup_at = pickup_at - ${back} * interval '1 millisecond'
    WHERE id = ${req.id}::uuid`;

  // Tomorrow 08:10: Aarav's Borivali → SPIT ride with Diya driving (Rahul also aboard, so
  // "1 of 3 seats left"). Kabir (08:17) and Ishita (08:12 at Borivali) are the other eligible
  // matches; Neha's 07:55 Borivali → SPIT (auto-accept) is hidden by time (15 minutes early).
  const diyaRide = await offer(diya, DAHISAR, SPIT, istAt(now, 1, '08:02'));
  const aaravSeat = await ask(student, BORIVALI, SPIT, istAt(now, 1, '08:10'));
  const seat = await s.offers.requestSeat(student, diyaRide.id, { requestId: aaravSeat.id });
  await s.offers.accept(diya, seat.bookings.find((b) => b.isYou).id);
  await s.offers.accept(diya, (await book(rahul, diyaRide, stop('Kandivali'), SPIT)).bookingId);
  await offer(kabir, BORIVALI, SPIT, istAt(now, 1, '08:17'));
  await offer(ishita, DAHISAR, SPIT, istAt(now, 1, '08:04'));
  await offer(mentor, BORIVALI, SPIT, istAt(now, 1, '07:55'), { autoAccept: true });
  // His return at 17:30 is still searching (no evening offers).
  await ask(student, SPIT, BORIVALI, istAt(now, 1, '17:30'));

  // Neha's 08:30 from Malad (the design's driver view), the day after tomorrow so Ishita isn't
  // in two cars on one morning: Ishita accepted, Kabir and Aarav still requesting.
  const nehaRide = await offer(mentor, MALAD, SPIT, istAt(now, 2, '08:30'));
  await s.offers.accept(mentor, (await book(ishita, nehaRide, MALAD, SPIT)).bookingId);
  await book(kabir, nehaRide, stop('Goregaon'), SPIT);
  await book(student, nehaRide, stop('Jogeshwari'), SPIT);

  // Monday: Kabir drives Borivali → SPIT Main Gate, arriving about 15:07, for the storyline
  // (Aarav's mentor session there is at 15:30; his ride link asks to arrive by 15:15).
  const monday = nextMonday(now);
  const toGate = await minutesFrom(BORIVALI, MAIN_GATE);
  await offer(
    kabir,
    BORIVALI,
    MAIN_GATE,
    new Date(istAt(now, monday, '15:07').getTime() - Math.round(toGate) * MIN),
  );
};
