// Module A tunables. Constants, not environment variables (no secrets here).
export const config = {
  /** Readiness = Σ weight × track completion. Sums to 1. */
  readinessWeights: { dsa: 0.5, core: 0.2, aptitude: 0.15, interview: 0.1, resume: 0.05 },
  ranking: {
    /** score = match × w.match + availability × w.availability + (1 − load) × w.freeCapacity */
    weights: { match: 0.6, availability: 0.2, freeCapacity: 0.2 },
    /** match = coverage × w.coverage + interestOverlap × w.interests */
    matchWeights: { coverage: 0.75, interests: 0.25 },
    weakTopics: 3,
    /** Open slots in the window that count as fully available. */
    slotsForFullAvailability: 4,
    windowDays: 7,
    nextSlots: 3,
  },
  /** Accept without a slot books the earliest open slot at least this far away. */
  acceptLeadMinutes: 60,
  /** A repeated Idempotency-Key from the same user is ignored for this long. */
  idempotencyTtlMs: 10 * 60_000,
  idempotencyMaxKeys: 10_000,
  /** Resource search requests per user per minute. */
  searchPerMinute: 60,
  newResourceDays: 7,
  /** A mentor whose mentees fill this share of capacity is "near capacity". */
  nearCapacityShare: 0.8,
  seriesDays: 30,
  defaultWeeklyTarget: 20,
} as const;
