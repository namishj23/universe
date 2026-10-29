// Every tuneable rides setting, in one validated object. Module B read the tariff from
// environment variables (AUTO_*); the values below are its `.env.example` defaults, kept in
// integer units (paise, metres, percent) so no money or distance is ever a float.

const config = {
  matching: {
    // Two riders share an auto only if their pickup times are at most this far apart.
    // A request's window is pickup ± this buffer.
    bufferMinutes: 10,
    // One auto seats this many riders; a group stays 'forming' (joinable) until full.
    maxGroupSize: 3,
    // Eligibility: shared road ≥ this percent of the SHORTER of the two routes.
    minRouteOverlapPercent: 50,
    // Ranking weights (percent): route similarity vs pickup-time closeness.
    similarityWeightPercent: 70,
    timeWeightPercent: 30,
    // Leaving is locked this many minutes before pickup.
    leaveLockMinutes: 10,
  },
  // Auto-rickshaw meter tariff (Mumbai): Rs 27 for the first 1.5 km, Rs 18 per km after,
  // with a 1.2 surge multiplier on top for the driver.
  tariff: {
    baseFarePaise: 2700,
    baseMetres: 1500,
    perKmPaise: 1800,
    surgePercent: 120,
  },
  drivers: {
    // Assigned driver's ETA to pickup is picked in this range (minutes).
    etaMinutes: { min: 3, max: 8 },
    // A vehicle stays busy until this long after its group's pickup. The exclusion constraint
    // rides_groups_vehicle_busy in the migration uses the same 30 minutes.
    busyAfterPickupMinutes: 30,
    // Driver's share of the fare (percent); the rest is the platform fee.
    payoutPercent: 90,
  },
  driverDocuments: {
    types: {
      inspection_certificate: 'Vehicle inspection certificate',
      licence: "Driver's licence",
    },
    validMonths: 6,
    reminderDays: 30,
  },
  vehicles: {
    // A vehicle document expiring within this many days is "expiring soon".
    expiryReminderDays: 14,
    // An approved self-inspection counts as current for this long.
    inspectionValidDays: 30,
    // Servicing is overdue past either of these, whichever comes first.
    serviceDueDays: 180,
    serviceDueMetres: 3_000_000,
    // Rider complaints counted over this window: FLAG = send for inspection, SUSPEND = off the road.
    complaintWindowDays: 30,
    complaintFlagCount: 3,
    complaintSuspendCount: 5,
    complaintTags: [
      'dirty seats',
      'meter not working',
      'unsafe driving',
      'poor condition',
      'rash lane changes',
    ],
    documents: ['permit', 'insurance', 'puc', 'fitness'],
    inspectionPhotos: ['tyres', 'lights', 'seats', 'meter'],
  },
  reportCategories: ['unsafe driving', 'harassment', 'no show', 'payment issue', 'other'],
  transitModes: ['bus', 'train', 'metro', 'walk', 'other'],
  paymentMethods: ['upi', 'wallet', 'card', 'cash'],
};

// Validated once at load: a bad edit stops the server at startup, not mid-ride.
function check(path, value) {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) {
    throw new Error(`rides config ${path} must be a non-negative integer, got ${value}`);
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) check(`${path}.${k}`, v);
  }
}
check('config', config);
if (config.matching.similarityWeightPercent + config.matching.timeWeightPercent !== 100) {
  throw new Error('rides config: matching weights must add up to 100');
}
if (config.drivers.etaMinutes.min > config.drivers.etaMinutes.max) {
  throw new Error('rides config: drivers.etaMinutes.min must not exceed max');
}
if (config.drivers.payoutPercent > 100 || config.matching.minRouteOverlapPercent > 100) {
  throw new Error('rides config: percentages must be at most 100');
}

const deepFreeze = (o) => {
  for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v);
  return Object.freeze(o);
};

module.exports = deepFreeze(config);
