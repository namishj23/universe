import { beforeAll, describe, expect, it } from 'vitest';
import { ApiErrorBody, rides as R } from '@universe/contracts';
import {
  account,
  joinGroup,
  prisma,
  request,
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

const prefs = (s: Session, body: object) => s.http.put('/api/rides/preferences').send(body);
const matchIds = async (s: Session, requestId: string, relax = false) =>
  R.RidesMatches.parse(
    (
      await s.http
        .get(`/api/rides/matches?rideRequestId=${requestId}&relaxPreference=${String(relax)}`)
        .expect(200)
    ).body,
  );

async function woman(womenOnly: boolean, driverPreference: 'any' | 'female' = 'any') {
  const s = await user(rides);
  await status(
    s.http
      .put('/api/rides/preferences')
      .send({ gender: 'female', womenOnlyGroups: womenOnly, driverPreference }),
    200,
  );
  return s;
}

describe('women-only groups and the female-driver rule (port of checkGenderAndAccess.js)', () => {
  it('keeps women-only groups closed to everyone not female, and lets a woman relax her own filter', async () => {
    const starter = await woman(true, 'female');
    const group = await startGroup(starter, 'Azad Nagar', 'Ghatkopar', 240);
    expect(
      R.RidesGroupDetail.parse((await starter.http.get(`/api/rides/groups/${group.id}`)).body)
        .womenOnly,
    ).toBe(true);

    // A man is never offered it and cannot join it, by matching or directly.
    const man = await user(rides);
    await status(prefs(man, { gender: 'male' }), 200);
    const m = await request(man, 'Azad Nagar', 'Andheri', 241);
    expect((await matchIds(man, m.id)).groups.some((g) => g.id === group.id)).toBe(false);
    const refused = await status(joinGroup(man, group, 'Azad Nagar', 'Andheri', 241), 403);
    expect(ApiErrorBody.parse(refused.body).error.message).toMatch(/women-only/);
    await man.http.post(`/api/rides/groups/${group.id}/join`).send({}).expect(403);
    // A student who set no gender is treated the same.
    const unset = await user(rides);
    await status(joinGroup(unset, group, 'Azad Nagar', 'Andheri', 242), 403);

    // Another woman (no preference) is offered it and joins.
    const plain = await woman(false);
    const w = await request(plain, 'Azad Nagar', 'Andheri', 242);
    expect((await matchIds(plain, w.id)).groups.some((g) => g.id === group.id)).toBe(true);
    await status(joinGroup(plain, group, 'Azad Nagar', 'Andheri', 242), 201);

    // A woman who wants women-only groups doesn't see a mixed one unless she relaxes it.
    const mixed = await startGroup(await user(rides), 'SPIT', 'Ghatkopar', 260);
    const picky = await woman(true);
    const p = await request(picky, 'SPIT', 'Ghatkopar', 261);
    const strict = await matchIds(picky, p.id);
    expect(strict.groups.some((g) => g.id === mixed.id)).toBe(false);
    expect(strict.hiddenByPreference).toBeGreaterThan(0);
    expect((await matchIds(picky, p.id, true)).groups.some((g) => g.id === mixed.id)).toBe(true);
    await picky.http
      .post('/api/rides/groups/join')
      .send({
        rideRequestId: p.id,
        memberRideRequestIds: [...mixed.memberRideRequestIds, p.id],
        relaxPreference: true,
      })
      .expect(201);
  });

  it('refuses women-only groups for a student whose gender is not female', async () => {
    const s = await user(rides);
    await status(prefs(s, { gender: 'male', womenOnlyGroups: true }), 400);
    await status(prefs(s, { womenOnlyGroups: true }), 400);
  });

  it('assigns a women-only group a female driver, and says why when none is free', async () => {
    const starter = await woman(true);
    const group = await startGroup(starter, 'Azad Nagar', 'Ghatkopar', 280);
    const card = R.RidesDriverCard.parse(
      (await status(starter.http.get(`/api/rides/groups/${group.id}/driver`), 200)).body,
    );
    const vehicle = await prisma.ridesVehicle.findUniqueOrThrow({
      where: { plateNumber: card.plateNumber },
      include: { driver: true },
    });
    expect(vehicle.driver?.gender).toBe('female');
    expect(card.femaleDriverAsRequested).toBe(true);

    // Take every female driver off the road: a women-only group is refused, never given a man.
    const females = await prisma.ridesDriver.findMany({
      where: { gender: 'female', vehicleId: { not: null } },
    });
    await prisma.ridesVehicle.updateMany({
      where: { id: { in: females.map((d) => d.vehicleId ?? '') } },
      data: { status: 'suspended' },
    });
    const other = await woman(true);
    const g2 = await startGroup(other, 'SPIT', 'Marol', 290);
    const refused = await status(other.http.get(`/api/rides/groups/${g2.id}/driver`), 409);
    expect(ApiErrorBody.parse(refused.body).error.message).toMatch(/female/i);

    // A student who asked for a female driver in a mixed group may waive it for this ride.
    const asker = await woman(false, 'female');
    const g3 = await startGroup(asker, 'SPIT', 'Andheri', 295);
    const waivable = await status(asker.http.get(`/api/rides/groups/${g3.id}/driver`), 409);
    expect(ApiErrorBody.parse(waivable.body).error).toMatchObject({
      code: 'NO_MATCHING_DRIVER',
      details: { canWaive: true },
    });
    await status(
      asker.http
        .post(`/api/rides/groups/${g3.id}/driver-preference`)
        .send({ allowAnyDriver: true }),
      200,
    );
    const any = R.RidesDriverCard.parse(
      (await status(asker.http.get(`/api/rides/groups/${g3.id}/driver`), 200)).body,
    );
    expect(any.femaleDriverAsRequested).toBe(false);
    await prisma.ridesVehicle.updateMany({
      where: { id: { in: females.map((d) => d.vehicleId ?? '') } },
      data: { status: 'active' },
    });
  });
});

describe('privacy', () => {
  it("never puts another user's gender or preferences in a payload", async () => {
    const her = await woman(false, 'female');
    const him = await user(rides);
    await status(prefs(him, { gender: 'male' }), 200);
    const group = await startGroup(her, 'Azad Nagar', 'Ghatkopar', 340);
    const req = await request(him, 'Azad Nagar', 'Andheri', 341);
    const payloads: unknown[] = [];
    payloads.push(
      (await him.http.get(`/api/rides/matches?rideRequestId=${req.id}`).expect(200)).body,
    );
    await status(joinGroup(him, group, 'Azad Nagar', 'Andheri', 341), 201);
    await him.http.post(`/api/rides/groups/${group.id}/chat`).send({ message: 'Hi!' }).expect(201);
    for (const s of [her, him]) {
      payloads.push((await s.http.get(`/api/rides/groups/${group.id}`).expect(200)).body);
      payloads.push((await s.http.get(`/api/rides/groups/${group.id}/chat`).expect(200)).body);
      payloads.push((await s.http.get('/api/rides/groups/mine').expect(200)).body);
      payloads.push((await s.http.get('/api/rides/groups/available').expect(200)).body);
      payloads.push((await s.http.get('/api/rides/history').expect(200)).body);
    }
    payloads.push((await her.http.get(`/api/rides/groups/${group.id}/driver`).expect(200)).body);
    const admin = await account(rides, 'admin@universe.test');
    payloads.push((await admin.http.get('/api/rides/admin/rides').expect(200)).body);
    payloads.push((await admin.http.get('/api/rides/admin/riders?limit=100').expect(200)).body);
    payloads.push(
      await prisma.activityEvent.findMany({
        where: { module: 'rides' },
        select: { payload: true },
      }),
    );

    // Gender values and preference fields; the group's own `driverPreference` block only says
    // whether a female driver is required and what the viewer chose, never who asked.
    const text = JSON.stringify(payloads);
    expect(text).not.toMatch(/"gender"|"womenOnlyGroups"|"riderCode"|"(fe)?male"|"non_binary"/);
  });
});
