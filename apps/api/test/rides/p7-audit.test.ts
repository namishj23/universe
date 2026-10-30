// The P7 audit's rides repros (docs/audit/P7-evidence/probes/p7-rides.test.ts.txt), kept as
// permanent regression tests for the P8 fixes. Each asserts the safe behaviour.
import { beforeAll, describe, expect, it } from 'vitest';
import {
  account,
  driverEmail,
  prisma,
  setupRides,
  startGroup,
  status,
  user,
  type Rides,
} from './helpers.js';

let rides: Rides;
beforeAll(async () => {
  rides = await setupRides();
}, 120_000);

const onlyOnline = async (name: string) => {
  await prisma.ridesDriver.updateMany({ data: { online: false } });
  const u = await prisma.user.findUniqueOrThrow({ where: { email: driverEmail(name) } });
  await prisma.ridesDriver.update({ where: { userId: u.id }, data: { online: true } });
};

describe('P7 rides repros', () => {
  it('P7-R1: one rider who never boarded cannot suspend an auto with one feedback', async () => {
    await onlyOnline('Ramesh Patil');
    const a = await user(rides);
    const g = await startGroup(a, 'Azad Nagar', 'Ghatkopar', 30);
    const card = (await status(a.http.get(`/api/rides/groups/${g.id}/driver`), 200)).body as {
      plateNumber: string;
    };
    const res = await a.http.post(`/api/rides/groups/${g.id}/feedback`).send({
      cleanliness: 1,
      condition: 1,
      tags: [
        'dirty seats',
        'meter not working',
        'unsafe driving',
        'poor condition',
        'rash lane changes',
      ],
    });
    const v = await prisma.ridesVehicle.findFirstOrThrow({
      where: { plateNumber: card.plateNumber },
    });
    await prisma.ridesVehicle.update({
      where: { id: v.id },
      data: { status: 'active', flaggedReason: null },
    });
    expect(v.status).not.toBe('suspended');
  });

  it('P7-R2: after an admin cancels a ride, its driver cannot run and complete it', async () => {
    await onlyOnline('Priya More');
    const priya = await account(rides, driverEmail('Priya More'));
    const admin = await account(rides, 'admin@universe.test');
    const rider = await user(rides);
    const g = await startGroup(rider, 'Azad Nagar', 'Ghatkopar', 60);
    await status(rider.http.get(`/api/rides/groups/${g.id}/driver`), 200);
    await status(priya.http.post(`/api/rides/driver/offers/${g.id}/accept`).send({}), 200);
    await status(
      admin.http.post(`/api/rides/admin/rides/${g.id}/cancel`).send({ reason: 'P7' }),
      200,
    );
    const heading = await priya.http.post(`/api/rides/driver/trips/${g.id}/heading`).send({});
    const complete = await priya.http.post(`/api/rides/driver/trips/${g.id}/complete`).send({});
    const after = await prisma.ridesGroup.findUniqueOrThrow({ where: { id: g.id } });
    expect(heading.status).toBe(409);
    expect(complete.status).toBe(409);
    expect((heading.body as { error: { code: string } }).error.code).toBe('RIDE_CLOSED');
    const board = await priya.http
      .post(`/api/rides/driver/trips/${g.id}/board`)
      .send({ code: '000000' });
    expect(board.status).toBe(409);
    expect(after.status).toBe('cancelled');
    const trip = await prisma.ridesDriverTrip.findFirstOrThrow({ where: { groupId: g.id } });
    expect(trip.status).toBe('cancelled');
  });

  it('P7-R2b: after an admin unassigns a driver, the same driver can be assigned and accept again', async () => {
    await onlyOnline('Priya More');
    const priya = await account(rides, driverEmail('Priya More'));
    const admin = await account(rides, 'admin@universe.test');
    const rider = await user(rides);
    const g = await startGroup(rider, 'Azad Nagar', 'Ghatkopar', 90);
    await status(rider.http.get(`/api/rides/groups/${g.id}/driver`), 200);
    await status(priya.http.post(`/api/rides/driver/offers/${g.id}/accept`).send({}), 200);
    await status(
      admin.http.post(`/api/rides/admin/rides/${g.id}/unassign-driver`).send({ reason: 'P7' }),
      200,
    );
    await status(rider.http.get(`/api/rides/groups/${g.id}/driver`), 200); // only Priya is online
    const closed = await prisma.ridesDriverTrip.findFirstOrThrow({ where: { groupId: g.id } });
    expect(closed.status).toBe('unassigned');
    const again = await priya.http.post(`/api/rides/driver/offers/${g.id}/accept`).send({});
    expect(again.status).toBe(200);
  });

  it("P7-R3: a student who is not in a pooled group does not see its members' full names", async () => {
    const owner = await user(rides, 'student', 'Meera Kapoorfamily');
    await startGroup(owner, 'Azad Nagar', 'Ghatkopar', 120);
    const stranger = await user(rides);
    const body = JSON.stringify(
      (await stranger.http.get('/api/rides/groups/available?limit=100').expect(200)).body,
    );
    expect(body).not.toContain('Kapoorfamily');
  });

  it('P7-R6: GET /admin/drivers pages past the first page', async () => {
    const admin = await account(rides, 'admin@universe.test');
    const first = await admin.http.get('/api/rides/admin/drivers?limit=1').expect(200);
    const cursor = (first.body as { nextCursor: string | null }).nextCursor;
    expect(cursor).toBeTruthy();
    const second = await admin.http.get(
      `/api/rides/admin/drivers?limit=1&cursor=${encodeURIComponent(cursor ?? '')}`,
    );
    expect(second.status).toBe(200);
  });
});
