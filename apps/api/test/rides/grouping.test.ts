import { beforeAll, describe, expect, it } from 'vitest';
import { ApiErrorBody, rides as R } from '@universe/contracts';
import {
  first,
  joinGroup,
  prisma,
  request,
  setupRides,
  startGroup,
  status,
  user,
  users,
  type Rides,
  type Session,
} from './helpers.js';

let rides: Rides;
beforeAll(async () => {
  rides = await setupRides();
});

const error = (body: unknown) => ApiErrorBody.parse(body).error;
const matches = async (s: Session, requestId: string) =>
  R.RidesMatches.parse(
    (await s.http.get(`/api/rides/matches?rideRequestId=${requestId}`).expect(200)).body,
  ).groups;
const detail = async (s: Session, groupId: string) =>
  R.RidesGroupDetail.parse((await s.http.get(`/api/rides/groups/${groupId}`).expect(200)).body);
const riderCode = async (s: Session) =>
  R.RidesProfile.parse((await s.http.get('/api/rides/me').expect(200)).body).riderCode;
const join = (s: Session, rideRequestId: string, memberRideRequestIds: string[]) =>
  s.http.post('/api/rides/groups/join').send({ rideRequestId, memberRideRequestIds });

describe('requests and matching (port of checkGrouping.js)', () => {
  it('rejects a past time, an unknown place and unknown fields', async () => {
    const x = await user(rides);
    const later = new Date(Date.now() + 3_600_000).toISOString();
    const past = new Date(Date.now() - 600_000).toISOString();
    const send = (body: object) => x.http.post('/api/rides/requests').send(body);
    await send({ pickupText: 'Azad Nagar', dropText: 'Andheri', pickupTime: past }).expect(400);
    await send({ pickupText: 'Nowhere', dropText: 'Andheri', pickupTime: later }).expect(400);
    await send({ pickupText: 'Azad', dropText: 'Andheri', pickupTime: later, x: 1 }).expect(400);
  });

  it('offers contained trips, ranks the same route first, refuses full and opposite groups', async () => {
    const [x, s1, s2, s3, s4, opp] = await Promise.all([
      user(rides),
      user(rides),
      user(rides),
      user(rides),
      user(rides),
      user(rides),
    ]);
    const T = 200;
    await startGroup(x, 'Azad Nagar', 'Ghatkopar', T);

    // A trip inside the long-haul route is offered at 100% overlap; this rider starts their own.
    const r1 = await request(s1, 'azad', 'andheri', T + 2);
    const offered = await matches(s1, r1.id);
    expect(offered).toHaveLength(1);
    expect(first(offered).routeOverlap).toBe(1);
    const g1 = R.RidesGroupDetail.parse((await status(join(s1, r1.id, [r1.id]), 201)).body);

    // The next two see the same-route group ranked first; the preview fare is the charged fare.
    for (const [s, min] of [
      [s2, 3],
      [s3, 4],
    ] as const) {
      const r = await request(s, 'Azad Nagar', 'Andheri East', T + min);
      const best = first(await matches(s, r.id));
      expect(best.id).toBe(g1.id);
      const preview = best.members.find((m) => m.isYou)?.fareSharePaise;
      const joined = R.RidesGroupDetail.parse(
        (await status(join(s, r.id, best.memberRideRequestIds), 201)).body,
      );
      expect(joined.members.find((m) => m.isYou)?.fareSharePaise).toBe(preview);
    }
    const full = await request(s4, 'Azad Nagar', 'Andheri', T + 4);
    expect((await matches(s4, full.id)).some((g) => g.id === g1.id)).toBe(false);
    const o = await request(opp, 'Azad Nagar', 'SPIT', T);
    expect(await matches(opp, o.id)).toHaveLength(0);

    // Every member sees the same fares, and the shares add up exactly to the total.
    const [v1, v2] = await Promise.all([detail(s1, g1.id), detail(s2, g1.id)]);
    expect(v1.members.map((m) => m.fareSharePaise)).toEqual(
      v2.members.map((m) => m.fareSharePaise),
    );
    expect(v1.members.reduce((t, m) => t + m.fareSharePaise, 0)).toBe(v1.totalFarePaise);
    expect(v1.status).toBe('confirmed');

    // Leaving reopens the seat.
    await s3.http.post(`/api/rides/groups/${g1.id}/leave`).send({}).expect(200);
    expect((await detail(s1, g1.id)).members).toHaveLength(2);
    const again = await request(s4, 'Azad Nagar', 'Andheri', T + 3);
    expect(first(await matches(s4, again.id)).id).toBe(g1.id);

    // Lists are paged and flag the student's own groups.
    const available = R.pages.groups.parse(
      (await s1.http.get('/api/rides/groups/available?limit=100').expect(200)).body,
    );
    expect(available.items.find((g) => g.id === g1.id)?.isMine).toBe(true);
    const mine = R.pages.groups.parse(
      (await s1.http.get('/api/rides/groups/mine').expect(200)).body,
    );
    expect(mine.items.map((g) => g.id)).toContain(g1.id);
    await s1.http.get('/api/rides/groups/mine?limit=101').expect(400);
  });
});

describe('seat race', () => {
  it('never lets more riders in than there are seats when four join at once', async () => {
    const founder = await user(rides);
    const group = await startGroup(founder, 'Azad Nagar', 'Ghatkopar', 300);
    const racers = await users(rides, 4);
    const reqs = await Promise.all(racers.map((r) => request(r, 'Azad Nagar', 'Ghatkopar', 301)));
    const results = await Promise.all(
      racers.map((r, i) => {
        const id = reqs[i]?.id ?? '';
        return join(r, id, [...group.memberRideRequestIds, id]);
      }),
    );
    // A group starts with its founder, so four riders race for the two remaining seats of three.
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(results.filter((r) => r.status === 409)).toHaveLength(2);
    expect(await prisma.ridesGroupMember.count({ where: { groupId: group.id } })).toBe(3);
  });

  it('with one seat left, exactly one of four simultaneous joiners gets it', async () => {
    const [a, b] = await Promise.all([user(rides), user(rides)]);
    const group = await startGroup(a, 'SPIT', 'Ghatkopar', 320);
    const second = R.RidesGroupDetail.parse(
      (await status(joinGroup(b, group, 'SPIT', 'Ghatkopar', 321), 201)).body,
    );
    const racers = await users(rides, 4);
    const results = await Promise.all(
      racers.map((r) => joinGroup(r, second, 'SPIT', 'Ghatkopar', 322)),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await prisma.ridesGroupMember.count({ where: { groupId: group.id } })).toBe(3);
  });
});

describe('end to end: request -> join -> confirmed -> driver -> board -> pay', () => {
  it('runs a whole ride', async () => {
    const [a, b, c] = await Promise.all([user(rides), user(rides), user(rides)]);
    const group = await startGroup(a, 'Azad Nagar', 'Ghatkopar', 400);
    const g2 = R.RidesGroupDetail.parse(
      (await status(joinGroup(b, group, 'Azad Nagar', 'Andheri', 401), 201)).body,
    );
    const g3 = R.RidesGroupDetail.parse(
      (await status(joinGroup(c, g2, 'Azad Nagar', 'Marol', 402), 201)).body,
    );
    expect(g3.status).toBe('confirmed');
    expect(g3.members.reduce((t, m) => t + m.fareSharePaise, 0)).toBe(g3.totalFarePaise);

    // Paying needs a driver first.
    await a.http.post(`/api/rides/groups/${group.id}/pay`).send({ method: 'upi' }).expect(409);
    // Two members asking at once get the same driver.
    const [d1, d2] = await Promise.all([
      a.http.get(`/api/rides/groups/${group.id}/driver`),
      b.http.get(`/api/rides/groups/${group.id}/driver`),
    ]);
    expect(d1.status).toBe(200);
    expect(R.RidesDriverCard.parse(d1.body).plateNumber).toBe(
      R.RidesDriverCard.parse(d2.body).plateNumber,
    );
    expect(d1.body).toEqual(d2.body);

    const code = await riderCode(a);
    const wrong = code === '000000' ? '111111' : '000000';
    await a.http.post(`/api/rides/groups/${group.id}/board`).send({ code: wrong }).expect(400);
    const boarded = a.http.post(`/api/rides/groups/${group.id}/board`).send({ code });
    expect(R.RidesGroupDetail.parse((await status(boarded, 200)).body).boarded).toBe(true);
    const paid = a.http.post(`/api/rides/groups/${group.id}/pay`).send({ method: 'upi' });
    expect(R.RidesGroupDetail.parse((await status(paid, 200)).body).youPaid).toBe(true);

    // Members were told about the join, the full group and the driver.
    const feed = await prisma.activityEvent.findMany({
      where: { recipientId: a.user.id, module: 'rides' },
      select: { type: true },
    });
    expect(feed.map((e) => e.type)).toEqual(
      expect.arrayContaining([
        'rides.member_joined',
        'rides.group_confirmed',
        'rides.driver_assigned',
      ]) as unknown,
    );
  });
});

describe('rules', () => {
  it('locks leaving inside 10 minutes of pickup', async () => {
    const [a, b] = await Promise.all([user(rides), user(rides)]);
    const group = await startGroup(a, 'Andheri', 'Ghatkopar', 8);
    await status(joinGroup(b, group, 'Andheri', 'Ghatkopar', 8), 201);
    const res = await b.http.post(`/api/rides/groups/${group.id}/leave`).send({}).expect(409);
    expect(error(res.body).message).toMatch(/locked in/);
  });

  it('answers 404 to a non-member on chat, driver, pay, board, leave and detail', async () => {
    const [owner, outsider] = await Promise.all([user(rides), user(rides)]);
    const group = await startGroup(owner, 'SPIT', 'Andheri', 500);
    const base = `/api/rides/groups/${group.id}`;
    await outsider.http.get(base).expect(404);
    await outsider.http.get(`${base}/chat`).expect(404);
    await outsider.http.post(`${base}/chat`).send({ message: 'hi' }).expect(404);
    await outsider.http.get(`${base}/driver`).expect(404);
    await outsider.http.post(`${base}/pay`).send({ method: 'upi' }).expect(404);
    await outsider.http.post(`${base}/board`).send({ code: '123456' }).expect(404);
    await outsider.http.post(`${base}/leave`).send({}).expect(404);
  });

  it('refuses a suspended rider request, join and board', async () => {
    const [rider, owner] = await Promise.all([user(rides), user(rides)]);
    const group = await startGroup(owner, 'SPIT', 'Marol', 600);
    const mine = await startGroup(rider, 'SPIT', 'Saki Naka', 650);
    const req = await request(rider, 'SPIT', 'Marol', 601);
    await prisma.ridesProfile.update({
      where: { userId: rider.user.id },
      data: { suspendedAt: new Date(), suspendedReason: 'Repeated no-shows' },
    });
    const refused = await rider.http
      .post('/api/rides/requests')
      .send({
        pickupText: 'SPIT',
        dropText: 'Andheri',
        pickupTime: new Date(Date.now() + 3_600_000).toISOString(),
      })
      .expect(403);
    expect(error(refused.body).code).toBe('RIDES_SUSPENDED');
    expect(error(refused.body).message).toMatch(/Repeated no-shows/);
    await join(rider, req.id, [...group.memberRideRequestIds, req.id]).expect(403);
    const code = await riderCode(rider);
    await rider.http.post(`/api/rides/groups/${mine.id}/board`).send({ code }).expect(403);
  });

  it('keeps a boarded rider out of other groups until that ride is over', async () => {
    const [a, b] = await Promise.all([user(rides), user(rides)]);
    const ride = await startGroup(a, 'Azad Nagar', 'Andheri', 5);
    const code = await riderCode(a);
    await a.http.post(`/api/rides/groups/${ride.id}/board`).send({ code }).expect(200);
    const other = await startGroup(b, 'Azad Nagar', 'Andheri', 700);
    const res = await status(joinGroup(a, other, 'Azad Nagar', 'Andheri', 701), 409);
    expect(error(res.body).message).toMatch(/already boarded/);
  });
});
