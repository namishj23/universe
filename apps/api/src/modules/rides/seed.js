// Rides demo data, run by `npm run db:seed` after the platform seed (which creates the driver
// accounts). Idempotent: stops, edges, vehicles and drivers are upserted by natural keys,
// documents are added only to drivers that have none, and demo rides only when no upcoming
// group exists. Demo rides go through the real services, so their fares are the real ones.
const { randomInt } = require('node:crypto');
const { STOP_NODES, STOP_EDGES } = require('./data/stops');
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

  // Stops (PostGIS geography, so raw tagged SQL) and the road edges between them.
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
      update: { distanceM: e.distanceM },
    });
  }

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
};
