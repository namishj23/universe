// Document and re-verification status for a driver, worked out from their uploads.
// Ported from Module B (modules/drivers/verification.js). Pure: everything is derived from
// the rows (camelCase Prisma fields), nothing is stored. `now` is passed in for tests.
const { driverDocuments } = require('../config');

const DAY_MS = 86_400_000;

function validUntil(doc) {
  const d = new Date(doc.uploadedAt);
  d.setUTCMonth(d.getUTCMonth() + driverDocuments.validMonths);
  return d;
}

const daysLeft = (doc, now) => Math.ceil((validUntil(doc).getTime() - now) / DAY_MS);
const isActive = (doc, now) => doc.status === 'verified' && daysLeft(doc, now) >= 0;

// Chip shown on a single upload: not_uploaded | pending | verified | expiring | expired | rejected.
function documentState(doc, now) {
  if (!doc) return 'not_uploaded';
  if (daysLeft(doc, now) < 0) return 'expired';
  if (doc.status === 'rejected') return 'rejected';
  if (doc.status === 'pending') return 'pending';
  return daysLeft(doc, now) <= driverDocuments.reminderDays ? 'expiring' : 'verified';
}

const publicDocument = (doc, now) =>
  doc && {
    id: doc.id,
    fileId: doc.fileId,
    uploadedAt: doc.uploadedAt.toISOString(),
    validUntil: validUntil(doc).toISOString(),
    daysLeft: daysLeft(doc, now),
    reviewStatus: doc.status,
    reviewedAt: doc.reviewedAt ? doc.reviewedAt.toISOString() : null,
    note: doc.note || null,
    state: documentState(doc, now),
  };

// `docs` = every upload of this driver, newest first. The newest upload of each type is what
// the driver sees; a driver stays cleared on an older verified one until it runs out, so
// re-uploading early never takes them off the road.
function verificationOf(docs, now = Date.now()) {
  const documents = Object.entries(driverDocuments.types).map(([type, label]) => {
    const ofType = docs.filter((d) => d.type === type);
    const latest = ofType[0] || null;
    const active = ofType.find((d) => isActive(d, now)) || null;
    const everVerified = ofType.some((d) => d.status === 'verified');
    return {
      type,
      label,
      current: publicDocument(latest, now),
      // The upload that clears the driver today (may be older than `current`).
      activeUntil: active ? validUntil(active).toISOString() : null,
      activeDaysLeft: active ? daysLeft(active, now) : null,
      cleared: Boolean(active),
      lapsed: !active && everVerified,
    };
  });

  const blocking = documents.filter((d) => !d.cleared);
  const expiring = documents.filter(
    (d) =>
      d.cleared &&
      d.activeDaysLeft <= driverDocuments.reminderDays &&
      // A replacement already sent in counts as dealt with.
      !(d.current && d.current.reviewStatus === 'pending'),
  );

  // One calm sentence for the banner, or null when there's nothing to say.
  let message = null;
  if (blocking.length) {
    const reasons = blocking.map((d) => {
      if (d.lapsed) return `your ${d.label.toLowerCase()} has expired`;
      if (!d.current) return `your ${d.label.toLowerCase()} hasn't been uploaded`;
      if (d.current.state === 'pending')
        return `your ${d.label.toLowerCase()} is waiting for review`;
      if (d.current.state === 'rejected') return `your ${d.label.toLowerCase()} was not accepted`;
      return `your ${d.label.toLowerCase()} needs to be uploaded again`;
    });
    message = `You can't take rides yet: ${reasons.join(' and ')}.`;
  } else if (expiring.length) {
    message =
      expiring
        .map(
          (d) =>
            `Your ${d.label.toLowerCase()} expires in ${d.activeDaysLeft} day${d.activeDaysLeft === 1 ? '' : 's'}`,
        )
        .join('. ') + '. Upload a new one so you stay on the road.';
  }

  return {
    verified: blocking.length === 0,
    reverificationRequired: documents.some((d) => d.lapsed),
    documents,
    reminder: expiring.length > 0,
    message,
  };
}

// Dashboard chip: valid | expiring_soon | missing.
function documentStatus(verification) {
  if (!verification.verified) return 'missing';
  return verification.reminder ? 'expiring_soon' : 'valid';
}

module.exports = { verificationOf, validUntil, documentStatus };
