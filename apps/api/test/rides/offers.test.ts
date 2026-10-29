import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { ApiErrorBody, FileRecord, rides as R } from '@universe/contracts';
import { sweepFiles } from '../../src/platform/files/index.js';
import {
  account,
  inMinutes,
  makeCarpoolDriver,
  offer,
  prisma,
  requestAt,
  setupRides,
  status,
  stop,
  user,
  type OfferBody,
  type Rides,
  type Session,
} from './helpers.js';

const errCode = (res: { body: unknown }) => ApiErrorBody.parse(res.body).error.code;

let rides: Rides;
beforeAll(async () => {
  rides = await setupRides();
});

const BORIVALI = stop('Borivali Station');
const SPIT = stop('SPIT Campus (Gate 2)');
// Road metres along the design's main corridor (OSRM, data/graph.json).
const KANDIVALI_M = 4103;
const MALAD_M = KANDIVALI_M + 4763;
const ANDHERI_M = MALAD_M + 3808 + 5478 + 2489;
const ROUTE_M = ANDHERI_M + 2080 + 1040;

/** A driver's offer Borivali -> SPIT and the passenger's pickup time at `pickup` on it. */
async function corridorOffer(driver: Session, extra: Record<string, unknown> = {}) {
  const o = await offer(driver, {
    originNodeId: BORIVALI,
    destNodeId: SPIT,
    departAt: inMinutes(60),
    seats: 3,
    ...extra,
  });
  return o;
}
async function pickupTimeAt(o: { id: string }, s: Session, name: string) {
  const r = (await s.http.get(`/api/rides/route?from=${BORIVALI}&to=${stop(name)}`).expect(200))
    .body as { durationS: number };
  const departAt = (await prisma.ridesOffer.findUniqueOrThrow({ where: { id: o.id } })).departAt;
  return new Date(departAt.getTime() + r.durationS * 1000).toISOString();
}
const events = (recipientId: string, type: string) =>
  prisma.activityEvent.count({ where: { recipientId, type } });

describe('carpool drivers', () => {
  it('apply -> documents -> admin approval; only then can they offer', async () => {
    const s = await user(rides);
    const admin = await account(rides, 'admin@universe.test');
    const body = {
      vehicleType: 'car',
      plateNumber: 'mh 04 cd 4321',
      model: 'Hyundai i20',
      seats: 4,
      insuranceExpiresAt: inMinutes(60 * 24 * 100),
      pucExpiresAt: inMinutes(60 * 24 * 100),
    };
    const applied = (await status(s.http.post('/api/rides/carpool/driver').send(body), 201))
      .body as { status: string; vehicle: { plateNumber: string }; canOffer: boolean };
    expect(applied).toMatchObject({ status: 'pending', canOffer: false });
    expect(applied.vehicle.plateNumber).toBe('MH04CD4321');
    // Same plate again, and a bike with two seats, are refused.
    const other = await user(rides);
    await status(other.http.post('/api/rides/carpool/driver').send(body), 409);
    await status(
      other.http
        .post('/api/rides/carpool/driver')
        .send({ ...body, plateNumber: 'MH04CD9999', vehicleType: 'bike', seats: 2 }),
      400,
    );
    await status(
      other.http.post('/api/rides/carpool/driver').send({ ...body, plateNumber: 'NOT A PLATE' }),
      400,
    );

    // Not approved yet: no offers.
    const tryOffer = () =>
      s.http
        .post('/api/rides/offers')
        .send({ originNodeId: BORIVALI, destNodeId: SPIT, departAt: inMinutes(60), seats: 2 });
    expect(errCode(await status(tryOffer(), 403))).toBe('CARPOOL_NOT_APPROVED');
    // Approving needs verified documents.
    await status(
      admin.http.post(`/api/rides/admin/drivers/${s.user.id}/review`).send({ decision: 'approve' }),
      409,
    );

    for (const type of ['licence', 'inspection_certificate']) {
      const file = await s.http
        .post('/api/files/rides.driver_document')
        .attach(
          'file',
          Buffer.concat([Buffer.from('%PDF-1.7\n'), randomBytes(2000)]),
          `${type}.pdf`,
        )
        .expect(201);
      await status(
        s.http
          .post('/api/rides/carpool/driver/documents')
          .send({ type, fileId: FileRecord.parse(file.body).id }),
        201,
      );
      const doc = await prisma.ridesDriverDocument.findFirstOrThrow({
        where: { driverId: s.user.id, type },
      });
      await status(
        admin.http.patch(`/api/rides/admin/driver-documents/${doc.id}`).send({ approve: true }),
        200,
      );
    }

    // Step 0: a file a document still points at can't be deleted, and the sweep keeps it.
    const doc = await prisma.ridesDriverDocument.findFirstOrThrow({
      where: { driverId: s.user.id },
    });
    expect(errCode(await status(s.http.delete(`/api/files/${doc.fileId}`), 409))).toBe(
      'FILE_IN_USE',
    );
    await prisma.file.update({
      where: { id: doc.fileId },
      data: { deletedAt: new Date(Date.now() - 25 * 3_600_000) },
    });
    await sweepFiles(rides.modules);
    expect(await prisma.file.count({ where: { id: doc.fileId } })).toBe(1);
    await prisma.file.update({ where: { id: doc.fileId }, data: { deletedAt: null } });

    const approved = R.CarpoolDriver.parse(
      (
        await status(
          admin.http
            .post(`/api/rides/admin/drivers/${s.user.id}/review`)
            .send({ decision: 'approve' }),
          200,
        )
      ).body,
    );
    expect(approved).toMatchObject({ status: 'approved', canOffer: true });
    expect(await events(s.user.id, 'rides.carpool_reviewed')).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { action: 'rides.carpool_driver_reviewed', targetId: s.user.id },
      }),
    ).toBe(1);
    await status(tryOffer(), 201);

    // A student without any carpool record, and a student calling an admin route.
    const stranger = await user(rides);
    expect(
      errCode(
        await status(
          stranger.http
            .post('/api/rides/offers')
            .send({ originNodeId: BORIVALI, destNodeId: SPIT, departAt: inMinutes(60), seats: 1 }),
          403,
        ),
      ),
    ).toBe('NOT_A_CARPOOL_DRIVER');
    await status(
      stranger.http
        .post(`/api/rides/admin/drivers/${s.user.id}/review`)
        .send({ decision: 'suspend' }),
      403,
    );

    // Suspension cancels upcoming offers.
    await status(
      admin.http
        .post(`/api/rides/admin/drivers/${s.user.id}/review`)
        .send({ decision: 'suspend', note: 'test' }),
      200,
    );
    expect(await prisma.ridesOffer.count({ where: { driverId: s.user.id, status: 'open' } })).toBe(
      0,
    );
  });
});

describe('detour matching through the API', () => {
  it('on-route passenger: no detour; Lokhandwala: over the 2 km budget, with the reason', async () => {
    const [driver, onRoute, offRoute] = await Promise.all([user(rides), user(rides), user(rides)]);
    await makeCarpoolDriver(driver);
    const o = await corridorOffer(driver);
    expect(o.planDistanceM).toBe(ROUTE_M);

    const r1 = await requestAt(
      onRoute,
      'Malad',
      'Andheri',
      await pickupTimeAt(o, onRoute, 'Malad'),
    );
    const m1 = R.OfferMatches.parse(
      (await status(onRoute.http.get(`/api/rides/offers/matches?requestId=${r1.id}`), 200)).body,
    );
    expect(m1.matches[0]).toMatchObject({
      offerId: o.id,
      eligible: true,
      addedDetourMetres: 0,
      overlapRatio: 1,
      minutesApart: 0,
      timeFit: 1,
      weights: { routeSimilarity: 0.7, timeFit: 0.3 },
      seatsLeft: 2,
    });
    const top = m1.matches[0]!;
    expect(top.routeSimilarity).toBeCloseTo((ANDHERI_M - MALAD_M) / ROUTE_M, 3);
    expect(
      Math.abs(top.score - (0.7 * top.routeSimilarity + 0.3 * top.timeFit)),
    ).toBeLessThanOrEqual(0.0005);

    // Lokhandwala -> SPIT: Jogeshwari -> Lokhandwala -> Azad Nagar instead of via Andheri.
    // Picked up after the detour Jogeshwari -> Lokhandwala.
    const extra = (
      await offRoute.http
        .get(`/api/rides/route?from=${stop('Jogeshwari')}&to=${stop('Lokhandwala')}`)
        .expect(200)
    ).body as { durationS: number };
    const atLok = new Date(
      Date.parse(await pickupTimeAt(o, offRoute, 'Jogeshwari')) + extra.durationS * 1000,
    ).toISOString();
    const r2 = await requestAt(offRoute, 'Lokhandwala', 'SPIT Campus (Gate 2)', atLok);
    const m2 = R.OfferMatches.parse(
      (await status(offRoute.http.get(`/api/rides/offers/matches?requestId=${r2.id}`), 200)).body,
    );
    const lok = m2.matches.find((x) => x.offerId === o.id);
    expect(lok).toMatchObject({
      eligible: false,
      reason: 'detour',
      addedDetourMetres: 4032 + 3601 - (2489 + 2080),
    });
    expect(lok?.reasonText).toMatch(/Detour 3\.1 km is over this driver's 2\.0 km limit/);
    await status(
      offRoute.http.post(`/api/rides/offers/${o.id}/bookings`).send({ requestId: r2.id }),
      409,
    );
    // With a bigger budget the same passenger fits.
    await status(
      driver.http.patch(`/api/rides/offers/${o.id}`).send({ maxDetourM: 4000, maxDetourS: 1800 }),
      200,
    );
    const m3 = R.OfferMatches.parse(
      (await status(offRoute.http.get(`/api/rides/offers/matches?requestId=${r2.id}`), 200)).body,
    );
    expect(m3.matches.find((x) => x.offerId === o.id)).toMatchObject({ eligible: true });
  });

  it('counts hidden offers by reason (time window, women-only)', async () => {
    await prisma.ridesOffer.deleteMany();
    const [driver, womanDriver, passenger] = await Promise.all([
      user(rides),
      user(rides),
      user(rides),
    ]);
    await makeCarpoolDriver(driver);
    await makeCarpoolDriver(womanDriver, { gender: 'female' });
    const early = await corridorOffer(driver);
    await corridorOffer(womanDriver, { womenOnly: true });
    // Asks for Malad 25 minutes after the planned pickup: outside ±10 min.
    const at = new Date(
      Date.parse(await pickupTimeAt(early, passenger, 'Malad')) + 25 * 60_000,
    ).toISOString();
    const r = await requestAt(passenger, 'Malad', 'Andheri', at);
    const m = R.OfferMatches.parse(
      (await status(passenger.http.get(`/api/rides/offers/matches?requestId=${r.id}`), 200)).body,
    );
    expect(m.matches).toEqual([]);
    expect(m.hidden).toEqual({
      total: 2,
      reasons: [
        { reason: 'time', count: 1, message: '1 hidden: pickup outside ±10 min' },
        { reason: 'women_only_group', count: 1, message: '1 hidden: women-only ride' },
      ],
    });
  });
});

describe('seats and bookings', () => {
  it('3 passengers race for 2 seats on an auto-accept offer: exactly 2 are accepted', async () => {
    const [driver, ...passengers] = await Promise.all([
      user(rides),
      user(rides),
      user(rides),
      user(rides),
    ]);
    await makeCarpoolDriver(driver, { seats: 2 });
    const o = await corridorOffer(driver, { seats: 2, autoAccept: true });
    const at = await pickupTimeAt(o, driver, 'Malad');
    const reqs = await Promise.all(passengers.map((p) => requestAt(p, 'Malad', 'Andheri', at)));
    const results = await Promise.all(
      passengers.map((p, i) =>
        p.http.post(`/api/rides/offers/${o.id}/bookings`).send({ requestId: reqs[i]?.id }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 201, 409]);
    expect(
      await prisma.ridesOfferBooking.count({ where: { offerId: o.id, status: 'accepted' } }),
    ).toBe(2);
    const after = await prisma.ridesOffer.findUniqueOrThrow({ where: { id: o.id } });
    expect(after).toMatchObject({ status: 'full', peakOnboard: 2 });
    // Shares add up to the trip cost: driver plus two passengers.
    const shares = await prisma.ridesOfferBooking.findMany({
      where: { offerId: o.id, status: 'accepted' },
    });
    expect(shares.reduce((t, b) => t + b.costSharePaise, after.driverSharePaise)).toBe(
      after.tripCostPaise,
    );
  });

  it('manual accept: only the driver can accept; non-members get 404; edit rules; cancellations', async () => {
    const [driver, passenger, stranger] = await Promise.all([
      user(rides),
      user(rides),
      user(rides),
    ]);
    await makeCarpoolDriver(driver);
    const o = await corridorOffer(driver);
    const r = await requestAt(
      passenger,
      'Malad',
      'Andheri',
      await pickupTimeAt(o, passenger, 'Malad'),
    );
    const booked = (
      await status(
        passenger.http.post(`/api/rides/offers/${o.id}/bookings`).send({ requestId: r.id }),
        201,
      )
    ).body as OfferBody;
    const booking = booked.bookings.find((b) => b.isYou);
    expect(booking).toMatchObject({
      status: 'requested',
      addedDetourM: 0,
      inVehicleM: ANDHERI_M - MALAD_M,
    });
    expect(await events(driver.user.id, 'rides.seat_requested')).toBe(1);
    // The driver can't book their own ride; the passenger can't accept their own booking.
    await status(passenger.http.post(`/api/rides/bookings/${booking?.id}/accept`).send({}), 404);
    await status(stranger.http.get(`/api/rides/offers/${o.id}`), 404);
    await status(passenger.http.get(`/api/rides/offers/${o.id}`), 200);

    const accepted = (
      await status(driver.http.post(`/api/rides/bookings/${booking?.id}/accept`).send({}), 200)
    ).body as OfferBody;
    expect(accepted.bookings[0]).toMatchObject({ status: 'accepted' });
    expect(accepted.plan.map((p) => `${p.type}:${p.stop.name}`)).toEqual([
      'origin:Borivali Station',
      'pickup:Malad',
      'drop:Andheri',
      'destination:SPIT Campus (Gate 2)',
    ]);
    const b = accepted.bookings[0];
    expect(b?.savingsPaise).toBe(Math.max(0, (b?.soloFarePaise ?? 0) - (b?.costSharePaise ?? 0)));
    expect(await events(passenger.user.id, 'rides.seat_accepted')).toBe(1);
    expect((await prisma.ridesRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe(
      'matched',
    );

    // Confirmed passenger: departure can't move, more seats can be added.
    expect(
      errCode(
        await status(
          driver.http.patch(`/api/rides/offers/${o.id}`).send({ departAt: inMinutes(90) }),
          409,
        ),
      ),
    ).toBe('OFFER_HAS_PASSENGERS');
    await status(driver.http.patch(`/api/rides/offers/${o.id}`).send({ costPerKmPaise: 900 }), 409);
    await status(driver.http.patch(`/api/rides/offers/${o.id}`).send({ costPerKmPaise: 500 }), 200);

    // Driver cancels: the passenger is told and their request reopens.
    await status(driver.http.post(`/api/rides/offers/${o.id}/cancel`).send({}), 200);
    expect(await events(passenger.user.id, 'rides.offer_cancelled')).toBe(1);
    expect((await prisma.ridesRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe(
      'open',
    );
    await status(passenger.http.get(`/api/rides/offers/${o.id}`), 404);
  });

  it('passenger cancels: the plan and costs are recomputed for the rest', async () => {
    const [driver, p1, p2] = await Promise.all([user(rides), user(rides), user(rides)]);
    await makeCarpoolDriver(driver);
    const o = await corridorOffer(driver, { autoAccept: true });
    const at = await pickupTimeAt(o, driver, 'Malad');
    const r1 = await requestAt(p1, 'Malad', 'Andheri', at);
    const r2 = await requestAt(p2, 'Malad', 'SPIT Campus (Gate 2)', at);
    await status(
      p1.http.post(`/api/rides/offers/${o.id}/bookings`).send({ requestId: r1.id }),
      201,
    );
    const both = (
      await status(
        p2.http.post(`/api/rides/offers/${o.id}/bookings`).send({ requestId: r2.id }),
        201,
      )
    ).body as OfferBody;
    expect(both.peakOnboard).toBe(2);
    const mine = (await p1.http.get('/api/rides/bookings/mine').expect(200)).body as {
      items: OfferBody[];
    };
    const myBooking = mine.items[0]?.bookings.find((b) => b.isYou);
    await status(p1.http.post(`/api/rides/bookings/${myBooking?.id}/cancel`).send({}), 200);
    const after = (await p2.http.get(`/api/rides/offers/${o.id}`).expect(200)).body as OfferBody;
    expect(after.peakOnboard).toBe(1);
    expect(after.bookings).toHaveLength(1);
    expect(after.bookings[0]!.costSharePaise + after.driverSharePaise).toBe(after.tripCostPaise);
    expect(await events(driver.user.id, 'rides.booking_cancelled')).toBe(1);
  });

  it('depart and complete: passengers are told, transitions are audited', async () => {
    const [driver, passenger] = await Promise.all([user(rides), user(rides)]);
    await makeCarpoolDriver(driver);
    const o = await corridorOffer(driver, { departAt: inMinutes(90), autoAccept: true });
    await status(driver.http.post(`/api/rides/offers/${o.id}/depart`).send({}), 409); // too early
    await status(driver.http.post(`/api/rides/offers/${o.id}/complete`).send({}), 409); // not departed
    await prisma.ridesOffer.update({
      where: { id: o.id },
      data: { departAt: new Date(Date.now() + 20 * 60_000) },
    });
    const r = await requestAt(
      passenger,
      'Malad',
      'Andheri',
      await pickupTimeAt(o, passenger, 'Malad'),
    );
    await status(
      passenger.http.post(`/api/rides/offers/${o.id}/bookings`).send({ requestId: r.id }),
      201,
    );
    await status(driver.http.post(`/api/rides/offers/${o.id}/depart`).send({}), 200);
    expect(await events(passenger.user.id, 'rides.offer_departing')).toBe(1);
    const done = (
      await status(driver.http.post(`/api/rides/offers/${o.id}/complete`).send({}), 200)
    ).body as OfferBody;
    expect(done.status).toBe('completed');
    expect(
      await prisma.auditLog.count({
        where: {
          targetId: o.id,
          action: { in: ['rides.offer_departed', 'rides.offer_completed'] },
        },
      }),
    ).toBe(2);
    expect((await prisma.ridesRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe(
      'completed',
    );
  });
});
