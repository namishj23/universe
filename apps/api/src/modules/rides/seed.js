// Rides demo data, run by `npm run db:seed` after the platform seed (which creates the driver
// accounts). Idempotent: stops, edges, vehicles and drivers are upserted by natural keys,
// documents are added only to drivers that have none, and demo rides only when no upcoming
// group exists. Demo rides go through the real services, so their fares are the real ones.
const { randomInt } = require('node:crypto');
const { STOP_NODES, STOP_EDGES, stopId } = require('./data/stops');
const { assertValidGraph } = require('./lib/graph');
const { DEMO_DRIVERS, VEHICLE_OFFSETS, STATE_DEMO_DRIVERS, driverEmail } = require('./data/roster');

const DAY = 86_400_000;
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
      update: { distanceM: e.distanceM, durationS: e.durationS, mode: e.mode, estimated: e.estimated },
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

  // Rider profiles for the demo users; student2 rides women-only (a female demo rider).
  const demo = await prisma.user.findMany({
    where: { email: { endsWith: '@universe.test' } },
    select: { id: true, email: true },
  });
  const idOf = (email) => demo.find((u) => u.email === email)?.id;
  for (const u of demo) await c.ensureProfile(u.id);
  const student2 = idOf('student2@universe.test');
  if (student2) {
    await prisma.ridesProfile.update({
      where: { userId: student2 },
      data: { gender: 'female', womenOnlyGroups: true },
    });
  }

  // A few requests and forming groups relative to now, so matching has something to show.
  const upcoming = await prisma.ridesGroup.count({
    where: { pickupAt: { gt: new Date(now) }, status: { not: 'cancelled' } },
  });
  const student = idOf('student@universe.test');
  const mentor = idOf('mentor@universe.test');
  if (upcoming === 0 && student && student2 && mentor) {
    const at = (minutes) => new Date(now + minutes * 60_000).toISOString();
    const start = async (userId, pickupText, dropText, minutes) => {
      const req = await s.riders.createRequest(userId, {
        pickupText,
        dropText,
        pickupTime: at(minutes),
      });
      return s.riders.join(userId, { rideRequestId: req.id, memberRideRequestIds: [req.id] });
    };
    await start(student, 'Azad Nagar', 'Ghatkopar', 90);
    await start(student2, 'SPIT', 'Marol Naka', 120);
    // An open request on the Azad Nagar line, to show up as a match for the group above.
    await s.riders.createRequest(mentor, {
      pickupText: 'Azad Nagar',
      dropText: 'Andheri',
      pickupTime: at(93),
    });
  }

  // Carpool (P3b): the mentor drives a car, student2 a bike; both approved with verified
  // documents. Two open offers and one completed shared ride, only on the first seed.
  const carpoolers = [
    { userId: mentor, vehicleType: 'car', plateNumber: 'MH02AB1234', model: 'Maruti Swift', colour: 'White', seats: 3 },
    { userId: student2, vehicleType: 'bike', plateNumber: 'MH47C5678', model: 'Honda Activa', colour: 'Grey', seats: 1 },
  ].filter((x) => x.userId);
  for (const x of carpoolers) {
    if (await prisma.ridesDriver.findUnique({ where: { userId: x.userId } })) continue;
    const v = await prisma.ridesVehicle.create({
      data: {
        vehicleType: x.vehicleType,
        plateNumber: x.plateNumber,
        registrationNumber: x.plateNumber,
        model: x.model,
        colour: x.colour,
        seats: x.seats,
        insuranceExpiresAt: inDays(200),
        pucExpiresAt: inDays(120),
      },
    });
    const profile = await prisma.ridesProfile.findUniqueOrThrow({ where: { userId: x.userId } });
    await upsertDriver(x.userId, {
      kind: 'carpool',
      status: 'approved',
      vehicleId: v.id,
      gender: profile.gender,
      reviewedAt: new Date(now),
    });
    await addDocuments(x.userId, { licence: 30, inspection_certificate: 30 });
  }
  if (mentor && student && student2 && (await prisma.ridesOffer.count()) === 0) {
    const at = (minutes) => new Date(now + minutes * 60_000).toISOString();
    const BORIVALI = stopId('Borivali Station');
    const MALAD = stopId('Malad');
    const SPIT = stopId('SPIT Campus (Gate 2)');
    // A completed ride: offered, booked, accepted, departed and completed through the
    // services (so every figure is the real one), then moved to yesterday.
    const done = await s.offers.create(mentor, {
      originNodeId: BORIVALI,
      destNodeId: SPIT,
      departAt: at(20),
      seats: 3,
    });
    const toMalad = await s.offers.route({ from: BORIVALI, to: MALAD });
    const req = await s.riders.createRequest(student, {
      pickupNodeId: MALAD,
      dropNodeId: stopId('Andheri'),
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

    // Open offers for the demo: the design's main corridor, and a women-only bike ride.
    await s.offers.create(mentor, {
      originNodeId: BORIVALI,
      destNodeId: SPIT,
      departAt: at(75),
      seats: 3,
      autoAccept: true,
    });
    await s.offers.create(student2, {
      originNodeId: stopId('Goregaon'),
      destNodeId: SPIT,
      departAt: at(50),
      seats: 1,
      womenOnly: true,
    });
  }
};
