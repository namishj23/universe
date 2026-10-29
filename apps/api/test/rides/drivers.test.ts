import { beforeAll, describe, expect, it } from 'vitest';
import { FileRecord, ModuleInfo, rides as R } from '@universe/contracts';
import { z } from 'zod';
import {
  account,
  driverEmail,
  prisma,
  setupRides,
  startGroup,
  status,
  user,
  type Rides,
  type Session,
} from './helpers.js';

let rides: Rides;
beforeAll(async () => {
  rides = await setupRides();
});

// A real 1x1 PNG (file-type checks the bytes, not the name).
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
// A Mach-O/ELF-style executable header renamed to .png.
const EXE = Buffer.concat([
  Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01]),
  Buffer.alloc(64),
]);

const upload = (s: Session, purpose: string, bytes: Buffer, name: string) =>
  s.http.post(`/api/files/${purpose}`).attach('file', bytes, name);
const driverMe = async (s: Session) =>
  R.DriverMe.parse((await status(s.http.get('/api/rides/driver'), 200)).body);
const userIdOf = async (name: string) =>
  (await prisma.user.findUniqueOrThrow({ where: { email: driverEmail(name) } })).id;

/** Only these roster drivers are online (assignment picks among online drivers at random). */
async function onlyOnline(...names: string[]) {
  await prisma.ridesDriver.updateMany({ data: { online: false } });
  const ids = await Promise.all(names.map(userIdOf));
  await prisma.ridesDriver.updateMany({ where: { userId: { in: ids } }, data: { online: true } });
}

async function bookedGroup(pickup: string, drop: string, inMinutes: number) {
  const rider = await user(rides);
  const group = await startGroup(rider, pickup, drop, inMinutes);
  const card = R.RidesDriverCard.parse(
    (await status(rider.http.get(`/api/rides/groups/${group.id}/driver`), 200)).body,
  );
  return { rider, group, card };
}

describe('role separation', () => {
  it('keeps drivers to the driver portal and riders out of it', async () => {
    const driver = await account(rides, driverEmail('Ramesh Patil'));
    const modules = z
      .array(ModuleInfo)
      .parse((await driver.http.get('/api/modules').expect(200)).body);
    expect(modules.map((m) => m.id)).toEqual(['rides']);
    await driver.http.get('/api/rides/me').expect(403);
    await driver.http.get('/api/rides/groups/mine').expect(403);
    await driver.http.post('/api/rides/requests').send({}).expect(403);
    await driver.http.get('/api/rides/admin/rides').expect(403);
    await driver.http.get('/api/hub/anything').expect(403);
    await driver.http.get('/api/wellbeing/anything').expect(403);
    await driver.http.get('/api/rides/notices').expect(200);

    const student = await user(rides);
    await student.http.get('/api/rides/driver').expect(403);
    await student.http.get('/api/rides/driver/offers').expect(403);
    await student.http
      .post(`/api/rides/driver/offers/${crypto.randomUUID()}/accept`)
      .send({})
      .expect(403);
  });
});

describe('documents (port of checkDriverPortal.js)', () => {
  it('uploads through the platform, is reviewed by an admin, and is readable only by its driver and admins', async () => {
    const ganesh = await account(rides, driverEmail('Ganesh Salunkhe'));
    let me = await driverMe(ganesh);
    expect(me.verification.verified).toBe(false);
    await ganesh.http.patch('/api/rides/driver/availability').send({ online: true }).expect(409);

    // A renamed executable is refused by its bytes, not its name.
    await upload(ganesh, 'rides.driver_document', EXE, 'licence.png').expect(415);
    const licence = FileRecord.parse(
      (await status(upload(ganesh, 'rides.driver_document', PNG, 'licence.png'), 201)).body,
    );
    const cert = FileRecord.parse(
      (await status(upload(ganesh, 'rides.driver_document', PDF, 'inspection.pdf'), 201)).body,
    );
    // Someone else's file can't be attached.
    const priya = await account(rides, driverEmail('Priya More'));
    await priya.http
      .post('/api/rides/driver/documents')
      .send({ type: 'licence', fileId: licence.id })
      .expect(400);
    await ganesh.http
      .post('/api/rides/driver/documents')
      .send({ type: 'licence', fileId: licence.id })
      .expect(201);
    me = R.DriverMe.parse(
      (
        await status(
          ganesh.http
            .post('/api/rides/driver/documents')
            .send({ type: 'inspection_certificate', fileId: cert.id }),
          201,
        )
      ).body,
    );
    expect(me.verification.documents.map((d) => d.current?.state)).toEqual(['pending', 'pending']);

    // Reads: the driver and admins only (404 for everyone else, so ids can't be probed).
    const admin = await account(rides, 'admin@universe.test');
    await ganesh.http.get(`/api/files/${licence.id}`).expect(200);
    await admin.http.get(`/api/files/${licence.id}`).expect(200);
    await priya.http.get(`/api/files/${licence.id}`).expect(404);
    await (await user(rides)).http.get(`/api/files/${licence.id}`).expect(404);

    // Students can't review; an admin approves both; a second review is a conflict.
    await (await user(rides)).http.get('/api/rides/admin/drivers').expect(403);
    const list = R.pages.adminDrivers.parse(
      (await admin.http.get('/api/rides/admin/drivers?limit=100').expect(200)).body,
    );
    const row = list.items.find((d) => d.id === me.id);
    for (const d of row?.verification.documents ?? []) {
      await admin.http
        .patch(`/api/rides/admin/driver-documents/${d.current?.id ?? ''}`)
        .send({ approve: true })
        .expect(200);
    }
    await admin.http
      .patch(
        `/api/rides/admin/driver-documents/${row?.verification.documents[0]?.current?.id ?? ''}`,
      )
      .send({ approve: true })
      .expect(409);
    me = await driverMe(ganesh);
    expect(me.verification.verified).toBe(true);
    expect(
      await prisma.auditLog.count({ where: { action: 'rides.driver_document_reviewed' } }),
    ).toBe(2);
    expect(
      await prisma.activityEvent.count({
        where: { recipientId: me.id, type: 'rides.document_reviewed' },
      }),
    ).toBe(2);
    // Verified, but no vehicle linked: still can't go online.
    await ganesh.http.patch('/api/rides/driver/availability').send({ online: true }).expect(409);
  });

  it('reminds before expiry and takes a lapsed driver offline', async () => {
    const kiran = await account(rides, driverEmail('Kiran Pawar'));
    const me = await driverMe(kiran);
    expect(me.verification).toMatchObject({ verified: true, reminder: true });
    expect(me.verification.documents.find((d) => d.type === 'licence')?.current?.state).toBe(
      'expiring',
    );
    const summary = await kiran.http.get('/api/dashboard').expect(200);
    expect(JSON.stringify(summary.body)).toContain('"documentStatus":"expiring_soon"');

    // Priya's documents run out: she is switched offline and can't accept or go online.
    const priya = await account(rides, driverEmail('Priya More'));
    const id = await userIdOf('Priya More');
    const old = new Date(Date.now() - 200 * 86_400_000);
    await prisma.ridesDriverDocument.updateMany({
      where: { driverId: id },
      data: { uploadedAt: old },
    });
    const lapsed = await driverMe(priya);
    expect(lapsed.verification).toMatchObject({ verified: false, reverificationRequired: true });
    expect(lapsed.online).toBe(false);
    expect(lapsed.verification.documents.map((d) => d.current?.state)).toEqual([
      'expired',
      'expired',
    ]);
    await priya.http.patch('/api/rides/driver/availability').send({ online: true }).expect(409);
    await prisma.ridesDriverDocument.updateMany({
      where: { driverId: id },
      data: { uploadedAt: new Date() },
    });
  });
});

describe('trips', () => {
  it('offers, accepts, heads, boards each rider by code, completes, and pays out exactly', async () => {
    await onlyOnline('Priya More');
    const priya = await account(rides, driverEmail('Priya More'));
    const { rider, group, card } = await bookedGroup('Azad Nagar', 'Ghatkopar', 60);
    expect(card.plateNumber).toBe('MH 47 BX 3308');
    expect(card.accepted).toBe(false);

    const offers = R.pages.driverRides.parse(
      (await priya.http.get('/api/rides/driver/offers').expect(200)).body,
    );
    const offer = offers.items.find((o) => o.groupId === group.id);
    expect(offer?.payoutPaise).toBeLessThan(offer?.totalFarePaise ?? 0);
    expect((offer?.payoutPaise ?? 0) + (offer?.platformFeePaise ?? 0)).toBe(offer?.totalFarePaise);
    // Riders appear by first name only: no rider code, no gender.
    expect(JSON.stringify(offers.items)).not.toMatch(/riderCode|gender|"name"/);

    await status(priya.http.post(`/api/rides/driver/offers/${group.id}/accept`).send({}), 200);
    await priya.http.post(`/api/rides/driver/trips/${group.id}/complete`).send({}).expect(409);
    await status(priya.http.post(`/api/rides/driver/trips/${group.id}/heading`).send({}), 200);
    const code = R.RidesProfile.parse(
      (await rider.http.get('/api/rides/me').expect(200)).body,
    ).riderCode;
    await priya.http
      .post(`/api/rides/driver/trips/${group.id}/board`)
      .send({ code: code === '000000' ? '111111' : '000000' })
      .expect(400);
    const boarded = R.BoardRiderResult.parse(
      (
        await status(
          priya.http.post(`/api/rides/driver/trips/${group.id}/board`).send({ code }),
          200,
        )
      ).body,
    );
    expect(boarded.trip.status).toBe('started');
    await priya.http.post(`/api/rides/driver/trips/${group.id}/board`).send({ code }).expect(409);
    const done = R.DriverRide.parse(
      (await status(priya.http.post(`/api/rides/driver/trips/${group.id}/complete`).send({}), 200))
        .body,
    );
    expect(done.status).toBe('completed');

    const trips = R.DriverTrips.parse(
      (await priya.http.get('/api/rides/driver/trips').expect(200)).body,
    );
    expect(trips.summary).toEqual({ completedTrips: 1, earnedPaise: done.payoutPaise });
    const riderFeed = await prisma.activityEvent.findMany({
      where: { recipientId: rider.user.id },
      select: { type: true },
    });
    expect(riderFeed.map((e) => e.type)).toEqual(
      expect.arrayContaining(['rides.driver_accepted', 'rides.driver_heading']) as unknown,
    );
    const driverFeed = await prisma.activityEvent.findMany({
      where: { recipient: { email: driverEmail('Priya More') } },
      select: { type: true },
    });
    expect(driverFeed.map((e) => e.type)).toEqual(
      expect.arrayContaining([
        'rides.ride_offered',
        'rides.rider_boarded',
        'rides.trip_completed',
      ]) as unknown,
    );
    // The first boarding put the ride on the odometer.
    const v = await prisma.ridesVehicle.findUniqueOrThrow({
      where: { plateNumber: 'MH 47 BX 3308' },
    });
    expect(v.drivenM).toBe(1900 * 1000 + done.distanceM);
  });

  it('lets exactly one accept win when two drivers (and a double click) accept at once', async () => {
    await onlyOnline('Sunita Jadhav');
    const { group, card } = await bookedGroup('SPIT', 'Andheri', 90);
    expect(card.plateNumber).toBe('MH 02 GK 5521');
    const [sunita, ramesh] = await Promise.all([
      account(rides, driverEmail('Sunita Jadhav')),
      account(rides, driverEmail('Ramesh Patil')),
    ]);
    const results = await Promise.all([
      sunita.http.post(`/api/rides/driver/offers/${group.id}/accept`).send({}),
      sunita.http.post(`/api/rides/driver/offers/${group.id}/accept`).send({}),
      ramesh.http.post(`/api/rides/driver/offers/${group.id}/accept`).send({}),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect(await prisma.ridesDriverTrip.count({ where: { groupId: group.id } })).toBe(1);
  });

  it('hands a declined ride to another free driver', async () => {
    // Anil's auto has an expired PUC in the seed, so Mahesh is the other free driver.
    await onlyOnline('Ramesh Patil', 'Mahesh Shinde');
    const { rider, group, card } = await bookedGroup('Andheri', 'Ghatkopar', 120);
    const assigned = card.plateNumber === 'MH 02 EK 4417' ? 'Ramesh Patil' : 'Mahesh Shinde';
    const decliner = await account(rides, driverEmail(assigned));
    await status(decliner.http.post(`/api/rides/driver/offers/${group.id}/decline`).send({}), 200);
    const after = R.RidesDriverCard.parse(
      (await status(rider.http.get(`/api/rides/groups/${group.id}/driver`), 200)).body,
    );
    expect(after.plateNumber).not.toBe(card.plateNumber);
    // The decliner can't take it back.
    await decliner.http.post(`/api/rides/driver/offers/${group.id}/accept`).send({}).expect(409);
  });
});
