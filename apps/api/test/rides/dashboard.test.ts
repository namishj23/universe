import { beforeAll, describe, expect, it } from 'vitest';
import { DashboardResponse, rides as R, RidesDashboardSummary } from '@universe/contracts';
import {
  account,
  driverEmail,
  joinGroup,
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

const ridesSummary = async (s: Session) => {
  const body = DashboardResponse.parse((await s.http.get('/api/dashboard').expect(200)).body);
  const entry = body.modules.find((m) => m.id === 'rides');
  expect(entry?.status).toBe('ok');
  return RidesDashboardSummary.parse(entry?.data);
};

describe('dashboard summary', () => {
  it('matches a hand-worked example', async () => {
    const [a, b] = await Promise.all([user(rides), user(rides)]);
    const group = await startGroup(a, 'Azad Nagar', 'Ghatkopar', 60);
    await status(joinGroup(b, group, 'Azad Nagar', 'Andheri', 61), 201);
    // Azad Nagar -> Ghatkopar is 11,490 m: (Rs 27 + 9.99 km x Rs 18) x 1.2 = Rs 248.184 -> 24818 paise.
    // The first stretch (2,080 m, 4493 paise) is shared by both riders, the rest is A's alone:
    // A = 4493/2 + 20325 = 22571.5, B = 2246.5; the odd paisa goes to the earlier member (A).
    const view = R.RidesGroupDetail.parse(
      (await a.http.get(`/api/rides/groups/${group.id}`).expect(200)).body,
    );
    expect(view.totalFarePaise).toBe(24818);
    expect(view.members.map((m) => m.fareSharePaise)).toEqual([22572, 2246]);

    expect(await ridesSummary(a)).toEqual({
      kind: 'rider',
      upcomingRide: {
        rideType: 'pool',
        id: group.id,
        pickupName: 'Azad Nagar',
        dropName: 'Ghatkopar',
        pickupTime: view.pickupTime,
        groupSize: 2,
      },
      ridesCompleted: 0,
      sharedDistanceM: 0,
      savedPaise: 0,
      carpool: null,
    });

    // A boards and the driver completes the ride: solo 24818 - share 22572 = 2246 saved.
    const code = R.RidesProfile.parse(
      (await a.http.get('/api/rides/me').expect(200)).body,
    ).riderCode;
    await status(a.http.post(`/api/rides/groups/${group.id}/board`).send({ code }), 200);
    await prisma.ridesGroup.update({ where: { id: group.id }, data: { status: 'completed' } });
    const next = await startGroup(a, 'SPIT', 'Andheri', 180);
    expect(await ridesSummary(a)).toEqual({
      kind: 'rider',
      upcomingRide: {
        rideType: 'pool',
        id: next.id,
        pickupName: 'SPIT Campus (Gate 2)',
        dropName: 'Andheri',
        pickupTime: expect.any(String) as unknown,
        groupSize: 1,
      },
      ridesCompleted: 1,
      sharedDistanceM: 11490,
      savedPaise: 2246,
      carpool: null,
    });
    // B never boarded: nothing completed.
    expect(await ridesSummary(b)).toMatchObject({ kind: 'rider', ridesCompleted: 0 });
    const stats = R.RidesStats.parse((await a.http.get('/api/rides/stats').expect(200)).body);
    expect(stats).toMatchObject({ totalRides: 2, completedRides: 1, totalSavingsPaise: 2246 });
  });

  it('shows a driver their working day', async () => {
    const ramesh = await account(rides, driverEmail('Ramesh Patil'));
    expect(await ridesSummary(ramesh)).toEqual({
      kind: 'driver',
      online: true,
      documentStatus: 'valid',
      tripsToday: 0,
      payoutTodayPaise: 0,
    });
  });
});

describe('no N+1 queries', () => {
  // Query events are emitted only when NODE_ENV=test (src/platform/db.ts).
  const counted = async (fn: () => Promise<unknown>) => {
    let n = 0;
    const client = prisma as unknown as { $on(event: 'query', cb: () => void): void };
    const listener = () => {
      n += 1;
    };
    client.$on('query', listener);
    await fn();
    // Prisma has no way to remove a listener; each call counts into its own variable.
    return n;
  };

  it('loads the available-groups list and the admin board in a fixed number of queries', async () => {
    const viewer = await user(rides);
    const admin = await account(rides, 'admin@universe.test');
    const groupsAt = async (count: number, minute: number) => {
      for (let i = 0; i < count; i++) {
        const owner = await user(rides);
        const g = await startGroup(owner, 'SPIT', 'Ghatkopar', minute + i);
        await status(joinGroup(await user(rides), g, 'SPIT', 'Marol', minute + i), 201);
      }
    };
    await groupsAt(1, 900);
    const small = await counted(() =>
      viewer.http.get('/api/rides/groups/available?limit=100').expect(200),
    );
    const smallBoard = await counted(() =>
      admin.http.get('/api/rides/admin/rides?limit=100').expect(200),
    );
    await groupsAt(5, 1000);
    const large = await counted(() =>
      viewer.http.get('/api/rides/groups/available?limit=100').expect(200),
    );
    const largeBoard = await counted(() =>
      admin.http.get('/api/rides/admin/rides?limit=100').expect(200),
    );
    expect(small).toBeGreaterThan(0);
    expect(large).toBe(small);
    expect(largeBoard).toBe(smallBoard);
  });
});
