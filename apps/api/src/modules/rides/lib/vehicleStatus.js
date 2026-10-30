// A vehicle's maintenance checks, worked out from its row, inspections and rider feedback.
// Ported from Module B (modules/vehicles/vehicles.service.js, the pure parts); distances are
// metres. `now` is passed in so a whole list is judged at one instant.
const { vehicles: rules } = require('../config');

const DAY_MS = 86_400_000;
const daysUntil = (date, now) => Math.floor((date.getTime() - now) / DAY_MS);
const daysSince = (date, now) => Math.floor((now - date.getTime()) / DAY_MS);
const expiryField = {
  permit: 'permitExpiresAt',
  insurance: 'insuranceExpiresAt',
  puc: 'pucExpiresAt',
  fitness: 'fitnessExpiresAt',
};

// Every document with how long it has left. Expired closes the eligibility gate.
function documentStatus(v, now) {
  return rules.documents.map((doc) => {
    const expiresOn = v[expiryField[doc]];
    const daysLeft = daysUntil(expiresOn, now);
    return {
      document: doc,
      expiresOn: expiresOn.toISOString(),
      daysLeft,
      expired: daysLeft < 0,
      expiringSoon: daysLeft >= 0 && daysLeft <= rules.expiryReminderDays,
    };
  });
}

// The last inspection an admin approved, and whether it is still current.
function inspectionStatus(inspections, now) {
  const approved = inspections
    .filter((i) => i.status === 'approved' && i.reviewedAt)
    .sort((a, b) => b.reviewedAt - a.reviewedAt)[0];
  const inspectedOn = approved ? approved.reviewedAt : null;
  const ageDays = inspectedOn ? daysSince(inspectedOn, now) : null;
  const waiting = inspections.find((i) => i.status === 'pending');
  return {
    inspectedOn: inspectedOn ? inspectedOn.toISOString() : null,
    current: Boolean(inspectedOn) && ageDays <= rules.inspectionValidDays,
    overdue: !inspectedOn || ageDays > rules.inspectionValidDays,
    pending: Boolean(waiting),
    pendingId: waiting ? waiting.id : null,
  };
}

// Overdue by date OR by distance driven since the last service, whichever comes first.
function serviceStatus(v, now) {
  const metresSinceService = v.drivenM - v.lastServiceM;
  const daysSinceService = daysSince(v.lastServiceAt, now);
  return {
    lastServicedOn: v.lastServiceAt.toISOString(),
    daysSinceService,
    metresSinceService,
    overdueByDate: daysSinceService > rules.serviceDueDays,
    overdueByDistance: metresSinceService > rules.serviceDueMetres,
    overdue: daysSinceService > rules.serviceDueDays || metresSinceService > rules.serviceDueMetres,
  };
}

function complaintStatus(feedback, now) {
  const since = now - rules.complaintWindowDays * DAY_MS;
  const recent = feedback.filter((f) => f.createdAt.getTime() >= since);
  // Riders, not tags: one rider's feedback counts once, however many tags it carries (P7-002).
  const complaints = new Set(
    recent.filter((f) => f.tags.some((t) => rules.complaintTags.includes(t))).map((f) => f.userId),
  ).size;
  const ratings = recent.flatMap((f) => [f.cleanliness, f.condition]);
  return {
    complaints,
    ratingCount: recent.length,
    // Tenths of a star (e.g. 43 = 4.3), so no float rounding reaches the API.
    avgRatingTenths: ratings.length
      ? Math.round((ratings.reduce((a, b) => a + b, 0) * 10) / ratings.length)
      : null,
    shouldFlag: complaints >= rules.complaintFlagCount,
    shouldSuspend: complaints >= rules.complaintSuspendCount,
  };
}

/** One vehicle with every check resolved. `eligible` is the gate driver assignment uses. */
function describeVehicle(v, inspections, feedback, now = Date.now()) {
  const documents = documentStatus(v, now);
  const expired = documents.filter((d) => d.expired).map((d) => d.document);
  const blockedReason =
    v.status === 'suspended'
      ? 'Vehicle suspended'
      : expired.length
        ? `Expired ${expired.join(' and ')}`
        : v.documentsStatus !== 'approved'
          ? 'Documents awaiting admin approval'
          : null;
  return {
    id: v.id,
    plateNumber: v.plateNumber,
    registrationNumber: v.registrationNumber,
    model: v.model,
    colour: v.colour,
    seats: v.seats,
    status: v.status,
    documentsStatus: v.documentsStatus,
    flaggedReason: v.flaggedReason,
    documents,
    expiringSoon: documents.filter((d) => d.expiringSoon).map((d) => d.document),
    inspection: inspectionStatus(inspections, now),
    service: serviceStatus(v, now),
    feedback: complaintStatus(feedback, now),
    drivenM: v.drivenM,
    eligible: !blockedReason,
    blockedReason,
  };
}

// The cheap part of the gate, for assignment: no inspections or feedback needed.
function isRoadworthy(v, now = Date.now()) {
  if (v.status !== 'active' || v.documentsStatus !== 'approved') return false;
  return rules.documents.every((doc) => daysUntil(v[expiryField[doc]], now) >= 0);
}

module.exports = { describeVehicle, isRoadworthy, complaintStatus, expiryField };
