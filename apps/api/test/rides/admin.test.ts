import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FileRecord, rides as R } from '@universe/contracts';
import { createApp } from '../../src/app.js';
import {
  account,
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
let admin: Session;
beforeAll(async () => {
  rides = await setupRides();
  admin = await account(rides, 'admin@universe.test');
});

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const iso = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const audits = (action: string) => prisma.auditLog.count({ where: { action } });
const vehicle = async (plate: string) =>
  (await prisma.ridesVehicle.findUniqueOrThrow({ where: { plateNumber: plate } })).id;

describe('admin routes', () => {
  it('refuses a student every admin route with 403', async () => {
    const student = await user(rides);
    const id = crypto.randomUUID();
    const gets = ['rides', 'riders', 'reports', 'notices', 'vehicles', `vehicles/${id}`, 'drivers'];
    for (const path of gets) await student.http.get(`/api/rides/admin/${path}`).expect(403);
    const writes: [string, string][] = [
      ['post', `rides/${id}/cancel`],
      ['post', `rides/${id}/unassign-driver`],
      ['patch', `riders/${id}/suspension`],
      ['patch', `reports/${id}`],
      ['post', 'notices'],
      ['delete', `notices/${id}`],
      ['patch', `vehicles/${id}/documents`],
      ['patch', `vehicles/${id}/status`],
      ['post', `vehicles/${id}/service`],
      ['post', `vehicles/${id}/inspections`],
      ['patch', `inspections/${id}`],
      ['patch', `driver-documents/${id}`],
    ];
    for (const [method, path] of writes) {
      const call =
        method === 'post'
          ? student.http.post
          : method === 'patch'
            ? student.http.patch
            : student.http.delete;
      await call(`/api/rides/admin/${path}`).send({}).expect(403);
    }
  });

  it('cancels a ride, notifies its members, and audits it', async () => {
    const [a, b] = await Promise.all([user(rides), user(rides)]);
    const group = await startGroup(a, 'Azad Nagar', 'Ghatkopar', 400);
    await status(joinGroup(b, group, 'Azad Nagar', 'Andheri', 401), 201);
    await status(a.http.get(`/api/rides/groups/${group.id}/driver`), 200);
    const board = R.pages.adminRides.parse(
      (await admin.http.get('/api/rides/admin/rides').expect(200)).body,
    );
    const row = board.items.find((r) => r.id === group.id);
    expect(row?.members).toHaveLength(2);
    expect(row?.driver?.plateNumber).toBeTruthy();

    await status(
      admin.http
        .post(`/api/rides/admin/rides/${group.id}/unassign-driver`)
        .send({ reason: 'check' }),
      200,
    );
    expect(await audits('rides.driver_unassigned')).toBe(1);
    await status(
      admin.http.post(`/api/rides/admin/rides/${group.id}/cancel`).send({ reason: 'Road closed' }),
      200,
    );
    await admin.http.post(`/api/rides/admin/rides/${group.id}/cancel`).send({}).expect(409);
    expect(await audits('rides.ride_cancelled')).toBe(1);
    for (const s of [a, b]) {
      const event = await prisma.activityEvent.findFirstOrThrow({
        where: { recipientId: s.user.id, type: 'rides.ride_cancelled' },
      });
      expect(event.payload).toMatchObject({ groupId: group.id, reason: 'Road closed' });
    }
    expect(
      await prisma.ridesRequest.count({
        where: { groupId: group.id, status: { not: 'cancelled' } },
      }),
    ).toBe(0);
  });

  it('suspends and unsuspends a rider, with audit and feed entries', async () => {
    const rider = await user(rides);
    await rider.http.get('/api/rides/me').expect(200);
    await status(
      admin.http
        .patch(`/api/rides/admin/riders/${rider.user.id}/suspension`)
        .send({ suspended: true, reason: 'No-shows' }),
      200,
    );
    const riders = R.pages.adminRiders.parse(
      (await admin.http.get('/api/rides/admin/riders?limit=100').expect(200)).body,
    );
    expect(riders.items.find((r) => r.id === rider.user.id)).toMatchObject({
      suspended: true,
      suspendedReason: 'No-shows',
    });
    await status(
      admin.http
        .patch(`/api/rides/admin/riders/${rider.user.id}/suspension`)
        .send({ suspended: false }),
      200,
    );
    expect([
      await audits('rides.rider_suspended'),
      await audits('rides.rider_unsuspended'),
    ]).toEqual([1, 1]);
    const feed = await prisma.activityEvent.findMany({
      where: { recipientId: rider.user.id, module: 'rides' },
      select: { type: true },
    });
    expect(feed.map((e) => e.type).sort()).toEqual(['rides.suspended', 'rides.unsuspended']);
    await admin.http
      .patch(`/api/rides/admin/riders/${crypto.randomUUID()}/suspension`)
      .send({ suspended: true })
      .expect(404);
  });

  it('takes safety reports from riders of that ride only, and resolves them', async () => {
    const [a, b, outsider] = await Promise.all([user(rides), user(rides), user(rides)]);
    const group = await startGroup(a, 'SPIT', 'Andheri', 450);
    await status(joinGroup(b, group, 'SPIT', 'Andheri', 451), 201);
    const body = { category: 'harassment', message: 'Rude all the way.', aboutUserId: b.user.id };
    await outsider.http.post(`/api/rides/groups/${group.id}/reports`).send(body).expect(404);
    await a.http
      .post(`/api/rides/groups/${group.id}/reports`)
      .send({ ...body, aboutUserId: outsider.user.id })
      .expect(400);
    await status(a.http.post(`/api/rides/groups/${group.id}/reports`).send(body), 201);
    const reports = R.pages.adminReports.parse(
      (await admin.http.get('/api/rides/admin/reports').expect(200)).body,
    );
    const report = reports.items.find((r) => r.groupId === group.id);
    expect(report).toMatchObject({ status: 'open', aboutRiderId: b.user.id });
    await status(
      admin.http
        .patch(`/api/rides/admin/reports/${report?.id ?? ''}`)
        .send({ status: 'resolved', resolution: 'Warned' }),
      200,
    );
    await admin.http
      .patch(`/api/rides/admin/reports/${report?.id ?? ''}`)
      .send({ status: 'dismissed' })
      .expect(409);
    expect(await audits('rides.report_resolved')).toBe(1);
    expect(
      await prisma.activityEvent.count({
        where: { recipientId: a.user.id, type: 'rides.report_resolved' },
      }),
    ).toBe(1);
  });

  it('posts notices to every rider and deletes them', async () => {
    const rider = await user(rides);
    await rider.http.get('/api/rides/me').expect(200);
    const notice = R.RidesNotice.parse(
      (
        await status(
          admin.http
            .post('/api/rides/admin/notices')
            .send({ message: 'Autos are late today', level: 'warning' }),
          201,
        )
      ).body,
    );
    await status(
      admin.http.post('/api/rides/admin/notices').send({ message: 'Old news', expiresAt: iso(-1) }),
      201,
    );
    const active = R.pages.notices.parse(
      (await rider.http.get('/api/rides/notices').expect(200)).body,
    );
    expect(active.items.map((n) => n.message)).toEqual(['Autos are late today']);
    expect(
      await prisma.activityEvent.count({
        where: { recipientId: rider.user.id, type: 'rides.notice_posted' },
      }),
    ).toBe(2);
    await status(admin.http.delete(`/api/rides/admin/notices/${notice.id}`), 200);
    await admin.http.delete(`/api/rides/admin/notices/${notice.id}`).expect(404);
    expect([await audits('rides.notice_posted'), await audits('rides.notice_deleted')]).toEqual([
      2, 1,
    ]);
  });
});

describe('fleet (port of checkVehicles.js)', () => {
  it('gates on documents, reminds before expiry, reviews inspections, logs service and suspends', async () => {
    const list = R.pages.vehicles.parse(
      (await admin.http.get('/api/rides/admin/vehicles?limit=100').expect(200)).body,
    );
    expect(list.items).toHaveLength(7);
    const expired = list.items.find((v) => !v.eligible && v.blockedReason?.startsWith('Expired'));
    const id = expired?.id ?? '';
    const base = `/api/rides/admin/vehicles/${id}`;

    const renewed = R.VehicleView.parse(
      (
        await status(
          admin.http
            .patch(`${base}/documents`)
            .send({ permit: iso(200), insurance: iso(200), puc: iso(200), fitness: iso(200) }),
          200,
        )
      ).body,
    );
    expect(renewed.eligible).toBe(true);
    const soon = R.VehicleView.parse(
      (await status(admin.http.patch(`${base}/documents`).send({ insurance: iso(5) }), 200)).body,
    );
    expect(soon.expiringSoon).toEqual(['insurance']);
    expect(soon.eligible).toBe(true);

    // Inspection: four photos uploaded by the admin as inspection photos.
    const photos = await Promise.all(
      ['tyres', 'lights', 'seats', 'meter'].map(
        async (name) =>
          FileRecord.parse(
            (
              await status(
                admin.http
                  .post('/api/files/rides.inspection_photo')
                  .attach('file', PNG, `${name}.png`),
                201,
              )
            ).body,
          ).id,
      ),
    );
    const [tyres, lights, seats, meter] = photos;
    await admin.http.post(`${base}/inspections`).send({ photos: { tyres, lights } }).expect(400);
    await admin.http
      .post(`${base}/inspections`)
      .send({ photos: { tyres, lights, seats, meter: tyres } })
      .expect(400);
    const submitted = R.InspectionView.parse(
      (
        await status(
          admin.http.post(`${base}/inspections`).send({ photos: { tyres, lights, seats, meter } }),
          201,
        )
      ).body,
    );
    expect(submitted.status).toBe('pending');
    await status(
      admin.http.patch(`/api/rides/admin/inspections/${submitted.id}`).send({ approve: true }),
      200,
    );
    await admin.http
      .patch(`/api/rides/admin/inspections/${submitted.id}`)
      .send({ approve: true })
      .expect(409);
    expect(
      R.VehicleView.parse((await admin.http.get(base).expect(200)).body).inspection.current,
    ).toBe(true);
    // Only admins can see inspection photos.
    await (await user(rides)).http.get(`/api/files/${tyres ?? ''}`).expect(404);

    const stale = R.VehicleView.parse(
      (await status(admin.http.post(`${base}/service`).send({ servicedOn: iso(-200) }), 200)).body,
    );
    expect(stale.service).toMatchObject({ overdueByDate: true, overdue: true });
    const serviced = R.VehicleView.parse(
      (await status(admin.http.post(`${base}/service`).send({}), 200)).body,
    );
    expect(serviced.service).toMatchObject({ overdue: false, metresSinceService: 0 });
    await admin.http
      .post(`${base}/service`)
      .send({ servicedOn: iso(5) })
      .expect(400);

    const suspended = R.VehicleView.parse(
      (
        await status(
          admin.http.patch(`${base}/status`).send({ status: 'suspended', reason: 'check' }),
          200,
        )
      ).body,
    );
    expect(suspended).toMatchObject({ eligible: false, blockedReason: 'Vehicle suspended' });
    await status(admin.http.patch(`${base}/status`).send({ status: 'active' }), 200);

    expect(await audits('rides.vehicle_documents_updated')).toBe(2);
    expect(await audits('rides.inspection_reviewed')).toBe(1);
    expect(await audits('rides.vehicle_serviced')).toBe(2);
    expect(await audits('rides.vehicle_status_changed')).toBe(2);
  });

  it('flags and then suspends a vehicle after rider complaints, one rating per rider', async () => {
    await prisma.ridesDriver.updateMany({ data: { online: false } });
    const ramesh = await prisma.user.findUniqueOrThrow({
      where: { email: 'ramesh.patil@drivers.universe.test' },
    });
    await prisma.ridesDriver.update({ where: { userId: ramesh.id }, data: { online: true } });
    const [a, b, c] = await Promise.all([user(rides), user(rides), user(rides)]);
    const group = await startGroup(a, 'Azad Nagar', 'Ghatkopar', 30);
    await status(joinGroup(b, group, 'Azad Nagar', 'Ghatkopar', 31), 201);
    await status(joinGroup(c, group, 'Azad Nagar', 'Ghatkopar', 31), 201);
    await status(a.http.get(`/api/rides/groups/${group.id}/driver`), 200);
    const tags = ['dirty seats', 'unsafe driving'];
    await status(
      a.http
        .post(`/api/rides/groups/${group.id}/feedback`)
        .send({ cleanliness: 1, condition: 2, tags }),
      201,
    );
    await a.http
      .post(`/api/rides/groups/${group.id}/feedback`)
      .send({ cleanliness: 1, condition: 2 })
      .expect(409);
    await status(
      b.http
        .post(`/api/rides/groups/${group.id}/feedback`)
        .send({ cleanliness: 2, condition: 2, tags }),
      201,
    );
    let v = await prisma.ridesVehicle.findUniqueOrThrow({
      where: { id: await vehicle('MH 02 EK 4417') },
    });
    expect(v.flaggedReason).toMatch(/Sent for inspection: 4 rider complaints/);
    await status(
      c.http
        .post(`/api/rides/groups/${group.id}/feedback`)
        .send({ cleanliness: 1, condition: 1, tags }),
      201,
    );
    v = await prisma.ridesVehicle.findUniqueOrThrow({ where: { id: v.id } });
    expect(v.status).toBe('suspended');
    await prisma.ridesVehicle.update({
      where: { id: v.id },
      data: { status: 'active', flaggedReason: null },
    });
  });
});

describe('group chat', () => {
  let server: Server;
  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });

  it('pushes a message to the other members as rides.chat, and not into their activity feed', async () => {
    server = createApp({ modules: rides.modules }).listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const [a, b] = await Promise.all([user(rides), user(rides)]);
    const group = await startGroup(a, 'SPIT', 'Ghatkopar', 500);
    await status(joinGroup(b, group, 'SPIT', 'Ghatkopar', 501), 201);
    const feedBefore = await prisma.activityEvent.count({ where: { recipientId: b.user.id } });

    const abort = new AbortController();
    const res = await fetch(`${url}/api/activity/stream`, {
      headers: { cookie: b.cookie },
      signal: abort.signal,
    });
    const reader = (res.body as ReadableStream<Uint8Array>)
      .pipeThrough(new TextDecoderStream())
      .getReader();
    let text = '';
    const until = async (needle: string) => {
      const deadline = Date.now() + 2000;
      while (!text.includes(needle) && Date.now() < deadline) {
        const chunk = await Promise.race([
          reader.read(),
          new Promise<null>((r) => setTimeout(() => r(null), 200)),
        ]);
        if (chunk && !chunk.done) text += chunk.value;
      }
      return text.includes(needle);
    };
    expect(await until('event: unread-count')).toBe(true);

    const sent = R.RidesChatMessage.parse(
      (
        await status(
          a.http.post(`/api/rides/groups/${group.id}/chat`).send({ message: 'On my way' }),
          201,
        )
      ).body,
    );
    expect(await until('event: rides.chat')).toBe(true);
    const line = text.split('\n\n').find((block) => block.includes('event: rides.chat')) ?? '';
    const data = R.RidesChatMessage.parse(JSON.parse(line.split('\ndata: ')[1] ?? '{}'));
    expect(data).toMatchObject({ id: sent.id, message: 'On my way', isYou: false });
    abort.abort();

    expect(await prisma.activityEvent.count({ where: { recipientId: b.user.id } })).toBe(
      feedBefore,
    );
    const history = R.pages.chat.parse(
      (await b.http.get(`/api/rides/groups/${group.id}/chat`).expect(200)).body,
    );
    expect(history.items.map((m) => m.message)).toEqual(['On my way']);
  });
});
