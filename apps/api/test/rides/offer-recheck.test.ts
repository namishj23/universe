import { beforeAll, describe, expect, it } from 'vitest';
import {
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

// P7-005: the time window and the women-only rule hold at accept time and after an offer edit,
// not only when the seat was requested.
let rides: Rides;
beforeAll(async () => {
  rides = await setupRides();
});

const code = (body: unknown) => (body as { error: { code: string } }).error.code;

/** A driver's 60-minute Borivali → SPIT offer (manual accept) and a male passenger's request. */
async function requestedSeat(passengerGender: string | null = 'male') {
  const [driver, passenger] = await Promise.all([user(rides), user(rides)]);
  await makeCarpoolDriver(driver, { gender: 'female' });
  const o = await offer(driver, {
    originNodeId: stop('Borivali Station'),
    destNodeId: stop('SPIT Campus (Gate 2)'),
    departAt: inMinutes(60),
    seats: 3,
  });
  await passenger.http.get('/api/rides/me').expect(200);
  if (passengerGender)
    await prisma.ridesProfile.update({
      where: { userId: passenger.user.id },
      data: { gender: passengerGender },
    });
  const route = (
    await passenger.http
      .get(`/api/rides/route?from=${stop('Borivali Station')}&to=${stop('Malad')}`)
      .expect(200)
  ).body as { durationS: number };
  const departAt = (await prisma.ridesOffer.findUniqueOrThrow({ where: { id: o.id } })).departAt;
  const r = await requestAt(
    passenger,
    'Malad',
    'Andheri',
    new Date(departAt.getTime() + route.durationS * 1000).toISOString(),
  );
  const booked = (
    await status(
      passenger.http.post(`/api/rides/offers/${o.id}/bookings`).send({ requestId: r.id }),
      201,
    )
  ).body as OfferBody;
  const booking = booked.bookings.find((b) => b.isYou)!;
  return { driver, passenger, o, booking, departAt };
}

const accept = (driver: Session, bookingId: string) =>
  driver.http.post(`/api/rides/bookings/${bookingId}/accept`).send({});

describe('carpool seats are re-checked (P7-005)', () => {
  it('moving the departure cancels requested seats that no longer fit, and tells the passenger', async () => {
    const { driver, passenger, o, booking } = await requestedSeat();
    await status(
      driver.http.patch(`/api/rides/offers/${o.id}`).send({ departAt: inMinutes(600) }),
      200,
    );
    const b = await prisma.ridesOfferBooking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(b.status).toBe('cancelled');
    expect(
      await prisma.activityEvent.count({
        where: { recipientId: passenger.user.id, type: 'rides.seat_declined' },
      }),
    ).toBe(1);
    expect((await accept(driver, booking.id)).status).toBe(409);
  });

  it('turning on women-only cancels a male passenger’s requested seat', async () => {
    const { driver, o, booking } = await requestedSeat('male');
    await status(driver.http.patch(`/api/rides/offers/${o.id}`).send({ womenOnly: true }), 200);
    const b = await prisma.ridesOfferBooking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(b.status).toBe('cancelled');
  });

  it('a change that still fits keeps the booking, and it can be accepted', async () => {
    const { driver, o, booking, departAt } = await requestedSeat();
    const later = new Date(departAt.getTime() + 2 * 60_000).toISOString();
    await status(driver.http.patch(`/api/rides/offers/${o.id}`).send({ departAt: later }), 200);
    const b = await prisma.ridesOfferBooking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(b.status).toBe('requested');
    await status(accept(driver, booking.id), 200);
  });

  it('accept itself refuses a time that no longer fits (409 TIME_WINDOW_MISMATCH)', async () => {
    const { driver, booking, o } = await requestedSeat();
    // As if the offer had moved without the edit route (the backstop inside accept).
    await prisma.ridesOffer.update({
      where: { id: o.id },
      data: { departAt: new Date(Date.now() + 9 * 60 * 60_000) },
    });
    const res = await accept(driver, booking.id);
    expect(res.status).toBe(409);
    expect(code(res.body)).toBe('TIME_WINDOW_MISMATCH');
  });

  it('accept checks women-only against the passenger’s current profile (403 GROUP_ACCESS)', async () => {
    const { driver, passenger, booking, o } = await requestedSeat('female');
    await prisma.ridesOffer.update({ where: { id: o.id }, data: { womenOnly: true } });
    await prisma.ridesProfile.update({
      where: { userId: passenger.user.id },
      data: { gender: 'male' },
    });
    const res = await accept(driver, booking.id);
    expect(res.status).toBe(403);
    expect(code(res.body)).toBe('GROUP_ACCESS');
  });
});
