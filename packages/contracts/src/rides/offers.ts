import { z } from 'zod';

// P3b (Person 1): carpool drivers, ride offers, seat bookings, detour matching and stats.
// Distances are integer metres, durations integer seconds, money integer paise.

const Paise = z.number().int().nonnegative();
const Metres = z.number().int().nonnegative();
const Id = z.uuid();
const StopId = z.guid();
const When = z.iso.datetime({ offset: true });
const Note = z.string().trim().max(300);
const StopRef = z.object({ id: StopId, name: z.string(), shortName: z.string() });
const page = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

export const VehicleType = z.enum(['car', 'bike']);
export const CarpoolStatus = z.enum(['pending', 'approved', 'rejected', 'suspended']);
export const OfferStatus = z.enum(['open', 'full', 'departed', 'completed', 'cancelled']);
export const BookingStatus = z.enum(['requested', 'accepted', 'declined', 'cancelled']);

/** Indian registration plate, any spacing or hyphens: MH02AB1234, MH 2 A 1234, 22BH1234AB. */
export const PlateNumber = z
  .string()
  .trim()
  .max(20)
  .transform((s) => s.toUpperCase().replace(/[\s-]/g, ''))
  .pipe(
    z
      .string()
      .regex(
        /^([A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}|[0-9]{2}BH[0-9]{4}[A-Z]{1,2})$/,
        'Enter a valid Indian registration number, e.g. MH02AB1234',
      ),
  );

// ── Requests ────────────────────────────────────────────────────────────────────────────

/** A student or mentor applies to drive their own car or bike. A bike carries one passenger. */
export const CarpoolApplyRequest = z
  .object({
    vehicleType: VehicleType,
    plateNumber: PlateNumber,
    model: z.string().trim().min(1).max(60),
    colour: z.string().trim().max(30).optional(),
    seats: z.number().int().min(1).max(6),
    insuranceExpiresAt: When,
    pucExpiresAt: When,
  })
  .strict()
  .refine((b) => b.vehicleType !== 'bike' || b.seats === 1, {
    message: 'A bike carries exactly one passenger',
    path: ['seats'],
  });

export const CarpoolReviewRequest = z
  .object({ decision: z.enum(['approve', 'reject', 'suspend']), note: Note.optional() })
  .strict();

export const CreateOfferRequest = z
  .object({
    originNodeId: StopId,
    destNodeId: StopId,
    departAt: When,
    seats: z.number().int().min(1).max(6),
    /** Extra metres you'll drive for passengers (default 2000, 0–10000). */
    maxDetourM: z.number().int().min(0).max(10_000).optional(),
    /** Extra seconds you'll drive for passengers (default: the metres at 20 km/h). */
    maxDetourS: z.number().int().min(0).max(3600).optional(),
    /** Running cost per km shared by everyone aboard (default by vehicle type). */
    costPerKmPaise: z.number().int().min(0).max(5000).optional(),
    autoAccept: z.boolean().optional(),
    /** Only female passengers (you must have set your gender as female). */
    womenOnly: z.boolean().optional(),
  })
  .strict();

/** Partial edit; with accepted passengers only seats/detour up, cost down and autoAccept. */
export const UpdateOfferRequest = z
  .object({
    originNodeId: StopId.optional(),
    destNodeId: StopId.optional(),
    departAt: When.optional(),
    seats: z.number().int().min(1).max(6).optional(),
    maxDetourM: z.number().int().min(0).max(10_000).optional(),
    maxDetourS: z.number().int().min(0).max(3600).optional(),
    costPerKmPaise: z.number().int().min(0).max(5000).optional(),
    autoAccept: z.boolean().optional(),
    womenOnly: z.boolean().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to change');

export const OfferMatchesQuery = z
  .object({
    requestId: Id,
    limit: z.coerce.number().int().min(1).max(50).default(20),
    /** "Show other offers for this ride": relax my women-only and female-driver choices. */
    relaxPreference: z.enum(['true', 'false']).optional(),
  })
  .strict();

export const BookSeatRequest = z.object({ requestId: Id }).strict();

export const RouteQuery = z.object({ from: StopId, to: StopId }).strict();

// ── Responses ───────────────────────────────────────────────────────────────────────────

export const CarpoolDriver = z
  .object({
    id: Id,
    driverCode: z.string(),
    status: CarpoolStatus,
    reviewNote: z.string().nullable(),
    vehicle: z.object({
      id: Id,
      vehicleType: VehicleType,
      plateNumber: z.string(),
      model: z.string(),
      colour: z.string().nullable(),
      seats: z.number().int(),
      insuranceExpiresAt: When,
      pucExpiresAt: When,
    }),
    /** Licence and inspection certificate, as for auto drivers. */
    documentsVerified: z.boolean(),
    documentsMessage: z.string().nullable(),
    /** True when every rule for creating offers holds today. */
    canOffer: z.boolean(),
  })
  .meta({ id: 'RidesCarpoolDriver' });

const PlanStop = z.object({
  type: z.enum(['origin', 'pickup', 'drop', 'destination']),
  stop: StopRef,
  /** Passenger's first name for pickups and drops; only shown to the offer's driver and its passengers. */
  passengerFirstName: z.string().nullable(),
  atM: Metres,
  at: When,
});

export const OfferBooking = z.object({
  id: Id,
  status: BookingStatus,
  passengerFirstName: z.string(),
  isYou: z.boolean(),
  pickup: StopRef,
  drop: StopRef,
  plannedPickupAt: When,
  addedDetourM: Metres,
  inVehicleM: Metres,
  costSharePaise: Paise,
  soloFarePaise: Paise,
  /** Solo auto fare minus cost share, never negative. Estimate. */
  savingsPaise: Paise,
});

export const OfferView = z
  .object({
    id: Id,
    status: OfferStatus,
    isDriver: z.boolean(),
    driverFirstName: z.string(),
    vehicle: z.object({
      vehicleType: VehicleType,
      model: z.string(),
      colour: z.string().nullable(),
      plateNumber: z.string(),
    }),
    origin: StopRef,
    destination: StopRef,
    departAt: When,
    seats: z.number().int(),
    peakOnboard: z.number().int(),
    maxDetourM: Metres,
    maxDetourS: z.number().int().nonnegative(),
    costPerKmPaise: Paise,
    autoAccept: z.boolean(),
    womenOnly: z.boolean(),
    baseDistanceM: Metres,
    planDistanceM: Metres,
    planDurationS: z.number().int().nonnegative(),
    tripCostPaise: Paise,
    driverSharePaise: Paise,
    /** Stop names in driving order (origin, pickups and drops, destination). */
    route: z.array(z.string()),
    plan: z.array(PlanStop),
    bookings: z.array(OfferBooking),
  })
  .meta({ id: 'RidesOffer' });

export const OfferMatch = z
  .object({
    offerId: Id,
    eligible: z.boolean(),
    /** Why not, when not eligible: detour, detour_time, delay, ride_length, seats, no_route. */
    reason: z.string().nullable(),
    reasonText: z.string().nullable(),
    score: z.number(),
    routeSimilarity: z.number(),
    timeFit: z.number(),
    weights: z.object({ routeSimilarity: z.number(), timeFit: z.number() }),
    minutesApart: z.number(),
    /** Share of the passenger's shortest path that is on the driver's route. */
    overlapRatio: z.number(),
    addedDetourMetres: Metres,
    pickupAt: When,
    departAt: When,
    seatsLeft: z.number().int().nonnegative(),
    driverFirstName: z.string(),
    vehicleType: VehicleType,
    womenOnly: z.boolean(),
    pickupNode: StopRef,
    dropNode: StopRef,
    route: z.array(z.string()),
    costSharePaise: Paise,
    soloFarePaise: Paise,
    savingsPaise: Paise,
  })
  .meta({ id: 'RidesOfferMatch' });

export const OfferMatches = z
  .object({
    matches: z.array(OfferMatch),
    hidden: z.object({
      total: z.number().int().nonnegative(),
      reasons: z.array(
        z.object({ reason: z.string(), count: z.number().int().positive(), message: z.string() }),
      ),
    }),
  })
  .meta({ id: 'RidesOfferMatches' });

export const GraphView = z
  .object({
    nodes: z.array(
      z.object({
        id: StopId,
        name: z.string(),
        shortName: z.string(),
        area: z.enum(['campus', 'city']),
        lat: z.number(),
        lng: z.number(),
        walkOnly: z.boolean(),
      }),
    ),
    edges: z.array(
      z.object({
        nodeAId: StopId,
        nodeBId: StopId,
        distanceM: Metres,
        durationS: z.number().int().positive(),
        mode: z.enum(['road', 'campus_road', 'walk']),
        estimated: z.boolean(),
      }),
    ),
  })
  .meta({ id: 'RidesGraph' });

export const RouteView = z
  .object({
    from: StopRef,
    to: StopRef,
    distanceM: Metres,
    durationS: z.number().int().nonnegative(),
    stops: z.array(StopRef),
  })
  .meta({ id: 'RidesRoute' });

const WeekRow = z.object({
  weekStart: z.iso.date(),
  sharedTrips: z.number().int().nonnegative(),
  sharedDistanceM: Metres,
  savingsPaise: Paise,
  averageOccupancy: z.number().nonnegative(),
});

export const RidesStatsReport = z
  .object({
    /** Every distance and money figure here is an estimate (see `assumptions`). */
    estimate: z.literal(true),
    totals: z.object({
      sharedTrips: z.number().int().nonnegative(),
      sharedDistanceM: Metres,
      savingsPaise: Paise,
      averageOccupancy: z.number().nonnegative(),
      pooledTrips: z.number().int().nonnegative(),
      carpoolTrips: z.number().int().nonnegative(),
    }),
    /** Present on /stats/me for a carpool driver. */
    driver: z
      .object({
        completedOffers: z.number().int().nonnegative(),
        seatsFilled: z.number().int().nonnegative(),
        /** Passengers' cost shares on completed offers: trip cost minus the driver's own share. */
        costRecoveredPaise: Paise,
      })
      .nullable(),
    weeks: z.array(WeekRow),
    busiestRoutes: z.array(
      z.object({
        pickupName: z.string(),
        dropName: z.string(),
        trips: z.number().int().positive(),
      }),
    ),
    assumptions: z.object({
      autoTariff: z.object({
        baseFarePaise: Paise,
        baseMetres: Metres,
        perKmPaise: Paise,
        surgePercent: z.number().int(),
      }),
      carpoolCostPerKmPaise: z.object({ car: Paise, bike: Paise }),
      speedKmh: z.object({ road: z.number(), campus_road: z.number(), walk: z.number() }),
      notes: z.array(z.string()),
    }),
  })
  .meta({ id: 'RidesStatsReport' });

export const offerPages = {
  offers: page(OfferView),
};
