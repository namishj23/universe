// The fleet: vehicle checks for admins, inspections (photos are platform files) and the rider
// complaint rules. Ported from Module B's vehicles.service; vehicles are addressed by id.
const { describeVehicle, complaintStatus, expiryField } = require('../lib/vehicleStatus');

module.exports = function vehicles(c) {
  const { p, cfg, prisma } = c;
  const R = p.contracts.rides;

  const include = { driver: { include: { user: { select: { name: true } } } } };

  /** Vehicles with every check resolved: inspections and feedback loaded in two queries. */
  async function describeMany(rows, db = prisma) {
    const ids = rows.map((v) => v.id);
    const since = new Date(Date.now() - cfg.vehicles.complaintWindowDays * 86_400_000);
    const [inspections, feedback] = await Promise.all([
      db.ridesVehicleInspection.findMany({
        where: { vehicleId: { in: ids } },
        orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
      }),
      db.ridesVehicleFeedback.findMany({
        where: { vehicleId: { in: ids }, createdAt: { gte: since } },
      }),
    ]);
    const now = Date.now();
    return rows.map((v) => ({
      ...describeVehicle(
        v,
        inspections.filter((i) => i.vehicleId === v.id),
        feedback.filter((f) => f.vehicleId === v.id),
        now,
      ),
      driverName: v.driver?.user.name ?? null,
    }));
  }

  async function list(query) {
    const { cursor, limit } = c.pageQuery(query);
    // The auto fleet only: carpool cars and bikes follow other rules (see offers.js).
    const rows = await prisma.ridesVehicle.findMany({
      where: { vehicleType: 'auto', ...c.afterAsc('createdAt', cursor) },
      orderBy: [{ vehicleType: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      include,
    });
    const page = c.toPage(
      rows,
      limit,
      (v) => v.createdAt,
      (v) => v,
    );
    return { items: await describeMany(page.items), nextCursor: page.nextCursor };
  }

  async function get(vehicleId, db = prisma) {
    const v = await db.ridesVehicle.findUnique({ where: { id: vehicleId }, include });
    if (!v || v.vehicleType !== 'auto') throw c.notFound('Vehicle not found');
    return (await describeMany([v], db))[0];
  }

  // Locks the vehicle row for an admin change; 404 if it doesn't exist.
  async function lockVehicle(tx, vehicleId) {
    const [row] =
      await tx.$queryRaw`SELECT id FROM rides_vehicles WHERE id = ${vehicleId}::uuid AND vehicle_type = 'auto' FOR UPDATE`;
    if (!row) throw c.notFound('Vehicle not found');
    return tx.ridesVehicle.findUniqueOrThrow({ where: { id: vehicleId } });
  }

  async function updateDocuments(admin, vehicleId, body, requestId) {
    const input = R.VehicleDocumentsRequest.parse(body);
    const fields = Object.keys(input);
    if (fields.length === 0) throw c.badRequest('Nothing to update');
    await p.transaction(async (tx) => {
      await lockVehicle(tx, vehicleId);
      const data = {};
      for (const doc of cfg.vehicles.documents)
        if (input[doc]) data[expiryField[doc]] = new Date(input[doc]);
      if (input.registrationNumber) data.registrationNumber = input.registrationNumber;
      if (input.documentsStatus) data.documentsStatus = input.documentsStatus;
      await tx.ridesVehicle.update({ where: { id: vehicleId }, data });
      await p.audit.record(tx, {
        actorId: admin.id,
        action: 'rides.vehicle_documents_updated',
        targetType: 'rides_vehicle',
        targetId: vehicleId,
        metadata: { fields },
        requestId,
      });
    });
    return get(vehicleId);
  }

  async function setStatus(admin, vehicleId, body, requestId) {
    const { status, reason } = R.VehicleStatusRequest.parse(body);
    await p.transaction(async (tx) => {
      const v = await lockVehicle(tx, vehicleId);
      await tx.ridesVehicle.update({
        where: { id: vehicleId },
        data: {
          status,
          flaggedReason: status === 'suspended' ? reason || 'Suspended by admin' : null,
        },
      });
      await p.audit.record(tx, {
        actorId: admin.id,
        action: 'rides.vehicle_status_changed',
        targetType: 'rides_vehicle',
        targetId: vehicleId,
        metadata: { status: { from: v.status, to: status }, reason: reason ?? null },
        requestId,
      });
    });
    return get(vehicleId);
  }

  // Counting distance from this service resets the distance side of the due check.
  async function logService(admin, vehicleId, body, requestId) {
    const { servicedOn } = R.VehicleServiceRequest.parse(body);
    const date = servicedOn ? new Date(servicedOn) : new Date();
    if (date.getTime() > Date.now()) throw c.badRequest('Service date cannot be in the future');
    await p.transaction(async (tx) => {
      const v = await lockVehicle(tx, vehicleId);
      await tx.ridesVehicle.update({
        where: { id: vehicleId },
        data: { lastServiceAt: date, lastServiceM: v.drivenM },
      });
      await p.audit.record(tx, {
        actorId: admin.id,
        action: 'rides.vehicle_serviced',
        targetType: 'rides_vehicle',
        targetId: vehicleId,
        metadata: { servicedOn: date.toISOString() },
        requestId,
      });
    });
    return get(vehicleId);
  }

  /**
   * A self-inspection: four photos uploaded first to POST /api/files/rides.inspection_photo
   * by the same person. Each must exist, be theirs and have that purpose.
   */
  async function submitInspection(userId, vehicleId, body) {
    const { photos } = R.InspectionRequest.parse(body);
    const ids = cfg.vehicles.inspectionPhotos.map((k) => photos[k]);
    if (new Set(ids).size !== ids.length) throw c.badRequest('Each photo must be a different file');
    const files = await prisma.file.findMany({
      where: {
        id: { in: ids },
        ownerId: userId,
        purpose: 'rides.inspection_photo',
        deletedAt: null,
      },
      select: { id: true },
    });
    if (files.length !== ids.length)
      throw c.badRequest(
        'Photos required: tyres, lights, seats, meter (uploaded by you as inspection photos)',
      );
    if (
      !(await prisma.ridesVehicle.findFirst({
        where: { id: vehicleId, vehicleType: 'auto' },
        select: { id: true },
      }))
    )
      throw c.notFound('Vehicle not found');
    await c.ensureProfile(userId);
    const row = await prisma.ridesVehicleInspection.create({
      data: {
        vehicleId,
        tyresFileId: photos.tyres,
        lightsFileId: photos.lights,
        seatsFileId: photos.seats,
        meterFileId: photos.meter,
        submittedById: userId,
      },
    });
    return {
      id: row.id,
      vehicleId,
      status: row.status,
      submittedAt: row.submittedAt.toISOString(),
    };
  }

  async function reviewInspection(admin, id, body, requestId) {
    const { approve, note } = R.ReviewRequest.parse(body);
    await c.ensureProfile(admin.id);
    const row = await p.transaction(async (tx) => {
      const [locked] =
        await tx.$queryRaw`SELECT id FROM rides_vehicle_inspections WHERE id = ${id}::uuid FOR UPDATE`;
      if (!locked) throw c.notFound('Inspection not found');
      const current = await tx.ridesVehicleInspection.findUniqueOrThrow({ where: { id } });
      if (current.status !== 'pending') throw c.conflict('This inspection was already reviewed');
      const status = approve ? 'approved' : 'rejected';
      const reviewed = await tx.ridesVehicleInspection.update({
        where: { id },
        data: { status, reviewedById: admin.id, reviewedAt: new Date(), note: note || null },
      });
      // A fresh approved inspection clears a "sent for inspection" flag.
      if (approve)
        await tx.ridesVehicle.update({
          where: { id: current.vehicleId },
          data: { flaggedReason: null },
        });
      await p.audit.record(tx, {
        actorId: admin.id,
        action: 'rides.inspection_reviewed',
        targetType: 'rides_vehicle_inspection',
        targetId: id,
        metadata: { status },
        requestId,
      });
      return reviewed;
    });
    return {
      id: row.id,
      vehicleId: row.vehicleId,
      status: row.status,
      submittedAt: row.submittedAt.toISOString(),
    };
  }

  // Run after new feedback, with the vehicle row locked: enough complaints in the window flag
  // the vehicle for inspection, more take it off the road.
  async function applyComplaintRules(tx, vehicleId) {
    const since = new Date(Date.now() - cfg.vehicles.complaintWindowDays * 86_400_000);
    const [v, feedback] = await Promise.all([
      tx.ridesVehicle.findUniqueOrThrow({ where: { id: vehicleId } }),
      tx.ridesVehicleFeedback.findMany({ where: { vehicleId, createdAt: { gte: since } } }),
    ]);
    const status = complaintStatus(feedback, Date.now());
    const window = `${status.complaints} rider complaints in ${cfg.vehicles.complaintWindowDays} days`;
    if (status.shouldSuspend && v.status !== 'suspended') {
      return tx.ridesVehicle.update({
        where: { id: vehicleId },
        data: { status: 'suspended', flaggedReason: `Suspended: ${window}` },
      });
    }
    if (status.shouldFlag && !v.flaggedReason) {
      return tx.ridesVehicle.update({
        where: { id: vehicleId },
        data: { flaggedReason: `Sent for inspection: ${window}` },
      });
    }
    return v;
  }

  return {
    list,
    get,
    updateDocuments,
    setStatus,
    logService,
    submitInspection,
    reviewInspection,
    applyComplaintRules,
  };
};
