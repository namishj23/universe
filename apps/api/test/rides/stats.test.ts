import { beforeAll, describe, expect, it } from 'vitest';
import { rides as R } from '@universe/contracts';
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
  type Rides,
} from './helpers.js';

let rides: Rides;
beforeAll(async () => {
  rides = await setupRides();
});

// Hand-worked (OSRM metres from data/graph.json, car at Rs 7/km):
//   route Borivali -> SPIT = 4103 + 4763 + 3808 + 5478 + 2489 + 2080 + 1040 = 23761 m
//   trip cost = 23761 x 700 / 1000 = 16632.7 -> 16633 paise
//   passenger Malad -> Andheri boards at 8866 m, drops at 20641 m (11775 m in the car):
//     cost at 8866 m = 6206, at 20641 m = 14449; that stretch (8243) is shared by 2 -> 4121.5
//     each; largest remainder gives the tied odd paisa to the earlier person (the driver).
//   passenger share 4121; solo auto 11775 m = (2700 + 18 x 10.275) x 1.2 = Rs 254.34
//   savings = 25434 - 4121 = 21313 paise
const SHARE = 4121;
const SOLO = 25434;
const IN_CAR_M = 11775;

describe('stats over completed shared rides', () => {
  it('returns the hand-worked totals to the passenger, the driver and the admin', async () => {
    const [driver, passenger] = await Promise.all([user(rides), user(rides)]);
    await makeCarpoolDriver(driver);
    const o = await offer(driver, {
      originNodeId: stop('Borivali Station'),
      destNodeId: stop('SPIT Campus (Gate 2)'),
      departAt: inMinutes(20),
      seats: 3,
      autoAccept: true,
    });
    const r = (
      await driver.http
        .get(`/api/rides/route?from=${stop('Borivali Station')}&to=${stop('Malad')}`)
        .expect(200)
    ).body as { durationS: number };
    const departAt = (await prisma.ridesOffer.findUniqueOrThrow({ where: { id: o.id } })).departAt;
    const req = await requestAt(
      passenger,
      'Malad',
      'Andheri',
      new Date(departAt.getTime() + r.durationS * 1000).toISOString(),
    );
    expect(req.soloFarePaise).toBe(SOLO);
    await status(
      passenger.http.post(`/api/rides/offers/${o.id}/bookings`).send({ requestId: req.id }),
      201,
    );
    await status(driver.http.post(`/api/rides/offers/${o.id}/depart`).send({}), 200);
    const done = (
      await status(driver.http.post(`/api/rides/offers/${o.id}/complete`).send({}), 200)
    ).body as {
      tripCostPaise: number;
      driverSharePaise: number;
      bookings: { costSharePaise: number; inVehicleM: number }[];
    };
    expect(done.tripCostPaise).toBe(16633);
    expect(done.bookings[0]).toMatchObject({ costSharePaise: SHARE, inVehicleM: IN_CAR_M });
    expect(done.driverSharePaise).toBe(16633 - SHARE);

    const mine = R.RidesStatsReport.parse(
      (await status(passenger.http.get('/api/rides/stats/me'), 200)).body,
    );
    expect(mine).toMatchObject({
      estimate: true,
      totals: {
        sharedTrips: 1,
        sharedDistanceM: IN_CAR_M,
        savingsPaise: SOLO - SHARE,
        averageOccupancy: 2,
        pooledTrips: 0,
        carpoolTrips: 1,
      },
      driver: null,
      busiestRoutes: [{ pickupName: 'Malad', dropName: 'Andheri', trips: 1 }],
    });
    expect(mine.weeks).toHaveLength(1);
    expect(mine.weeks[0]).toMatchObject({
      sharedTrips: 1,
      sharedDistanceM: IN_CAR_M,
      savingsPaise: SOLO - SHARE,
    });
    expect(mine.assumptions.carpoolCostPerKmPaise).toEqual({ car: 700, bike: 250 });

    const drv = R.RidesStatsReport.parse(
      (await status(driver.http.get('/api/rides/stats/me'), 200)).body,
    );
    expect(drv.driver).toEqual({ completedOffers: 1, seatsFilled: 1, costRecoveredPaise: SHARE });

    // Dashboard tiles agree with the stats.
    const dash = (await status(passenger.http.get('/api/dashboard'), 200)).body as {
      modules: { id: string; status: string; data?: unknown }[];
    };
    expect(dash.modules.find((m) => m.id === 'rides')?.data).toMatchObject({
      ridesCompleted: 1,
      sharedDistanceM: IN_CAR_M,
      savedPaise: SOLO - SHARE,
      carpool: null,
    });

    const admin = await account(rides, 'admin@universe.test');
    const all = R.RidesStatsReport.parse(
      (await status(admin.http.get('/api/rides/admin/stats'), 200)).body,
    );
    expect(all.totals).toMatchObject({
      sharedTrips: 1,
      sharedDistanceM: IN_CAR_M,
      savingsPaise: SOLO - SHARE,
    });
  });

  it('the admin stats route is admin only', async () => {
    const student = await user(rides);
    await status(student.http.get('/api/rides/admin/stats'), 403);
  });
});
