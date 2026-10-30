import { z } from 'zod';

// Module B · Rides (Person 1). Request schemas are strict (unknown fields rejected); response
// schemas describe the API for the OpenAPI document. Money is integer paise, distance integer
// metres. Stop ids are stable name-derived ids, not RFC 4122 UUIDs, so they use z.guid().

const Paise = z.number().int().nonnegative();
const Metres = z.number().int().nonnegative();
const Id = z.uuid();
const StopId = z.guid();
const When = z.iso.datetime({ offset: true });
const Note = z.string().trim().max(300);

export const RidesGender = z.enum(['female', 'male', 'non_binary']);
export const DriverPreference = z.enum(['any', 'female']);
export const GroupKind = z.enum(['auto', 'transit']);
export const TransitMode = z.enum(['bus', 'train', 'metro', 'walk', 'other']);
export const PaymentMethod = z.enum(['upi', 'wallet', 'card', 'cash']);
export const ComplaintTag = z.enum([
  'dirty seats',
  'meter not working',
  'unsafe driving',
  'poor condition',
  'rash lane changes',
]);
export const ReportCategory = z.enum([
  'unsafe driving',
  'harassment',
  'no show',
  'payment issue',
  'other',
]);
export const DriverDocumentType = z.enum(['licence', 'inspection_certificate']);

/** Cursor paging for every rides list: an opaque cursor, 20 by default, at most 100. */
export const RidesPageQuery = z
  .object({
    cursor: z.string().min(1).max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export const NoQuery = z.object({}).strict();
/** A small acknowledgement, e.g. `{ left: true, groupId }`. */
export const Ack = z.record(z.string(), z.unknown()).meta({ id: 'RidesAck' });
export const NoBody = z.object({}).strict();

// ── Requests ────────────────────────────────────────────────────────────────────────────

/** All optional; gender null = prefer not to say. Women-only groups need gender female. */
export const PreferencesRequest = z
  .object({
    gender: RidesGender.nullable().optional(),
    womenOnlyGroups: z.boolean().optional(),
    driverPreference: DriverPreference.optional(),
  })
  .strict();

/** Stop ids, or the free text the student typed (matched to the nearest stop). */
export const CreateRideRequest = z
  .object({
    pickupNodeId: StopId.optional(),
    dropNodeId: StopId.optional(),
    pickupText: z.string().trim().min(1).max(120).optional(),
    dropText: z.string().trim().min(1).max(120).optional(),
    pickupTime: When.optional(),
    /**
     * Instead of `pickupTime`: when you must arrive at the drop. The pickup time is this minus
     * the shortest-path driving time between the two stops (the mentor-session ride link).
     */
    arriveBy: When.optional(),
  })
  .strict()
  .refine((b) => (b.pickupNodeId ?? b.pickupText) && (b.dropNodeId ?? b.dropText), {
    message: 'Pickup and drop are required',
  })
  .refine((b) => (b.pickupTime === undefined) !== (b.arriveBy === undefined), {
    message: 'Give either pickupTime or arriveBy',
    path: ['pickupTime'],
  });

export const MatchesQuery = z
  .object({
    rideRequestId: Id,
    kind: GroupKind.default('auto'),
    /** "Show other groups for this ride": ignore my own women-only preference once. */
    relaxPreference: z.enum(['true', 'false']).default('false'),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export const JoinGroupRequest = z
  .object({
    rideRequestId: Id,
    memberRideRequestIds: z.array(Id).min(1).max(10),
    kind: GroupKind.optional(),
    relaxPreference: z.boolean().optional(),
  })
  .strict();

export const GroupIdParam = z.object({ groupId: Id }).strict();
export const IdParam = z.object({ id: Id }).strict();
export const UserIdParam = z.object({ userId: Id }).strict();
export const VehicleIdParam = z.object({ vehicleId: Id }).strict();

export const ChatPostRequest = z.object({ message: z.string().trim().min(1).max(1000) }).strict();
export const MeetingRequest = z
  .object({
    meetingPoint: z.string().trim().max(120).optional(),
    transitMode: TransitMode.optional(),
  })
  .strict();
export const RiderCode = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Rider codes are 6 digits');
export const BoardRequest = z.object({ code: RiderCode }).strict();
export const DriverPreferenceRequest = z.object({ allowAnyDriver: z.boolean() }).strict();
export const PayRequest = z.object({ method: PaymentMethod }).strict();
export const FeedbackRequest = z
  .object({
    cleanliness: z.number().int().min(1).max(5),
    condition: z.number().int().min(1).max(5),
    tags: z
      .array(ComplaintTag)
      .max(5)
      .refine((t) => new Set(t).size === t.length, 'Each tag at most once')
      .optional(),
  })
  .strict();
export const ReportRequest = z
  .object({
    aboutUserId: Id.optional(),
    aboutVehicle: z.boolean().optional(),
    category: ReportCategory,
    message: z.string().trim().min(5).max(600),
  })
  .strict();

export const AdminRidesQuery = RidesPageQuery.extend({
  includePast: z.enum(['true', 'false']).default('false'),
}).strict();
export const ReasonRequest = z.object({ reason: z.string().trim().max(200).optional() }).strict();
export const SuspensionRequest = z
  .object({ suspended: z.boolean(), reason: z.string().trim().max(200).optional() })
  .strict();
export const ResolveReportRequest = z
  .object({ status: z.enum(['resolved', 'dismissed']), resolution: Note.optional() })
  .strict();
export const NoticeRequest = z
  .object({
    message: z.string().trim().min(3).max(300),
    level: z.enum(['info', 'warning']).optional(),
    expiresAt: When.optional(),
  })
  .strict();
export const VehicleDocumentsRequest = z
  .object({
    permit: When.optional(),
    insurance: When.optional(),
    puc: When.optional(),
    fitness: When.optional(),
    registrationNumber: z.string().trim().min(4).max(30).optional(),
    documentsStatus: z.enum(['approved', 'pending', 'rejected']).optional(),
  })
  .strict();
export const VehicleStatusRequest = z
  .object({
    status: z.enum(['active', 'suspended']),
    reason: z.string().trim().max(200).optional(),
  })
  .strict();
export const VehicleServiceRequest = z.object({ servicedOn: When.optional() }).strict();
export const InspectionRequest = z
  .object({ photos: z.object({ tyres: Id, lights: Id, seats: Id, meter: Id }).strict() })
  .strict();
export const ReviewRequest = z.object({ approve: z.boolean(), note: Note.optional() }).strict();

export const DriverVehicleRequest = z
  .object({
    model: z.string().trim().min(2, 'Enter the vehicle model').max(60),
    colour: z.string().trim().min(2, 'Enter the colour').max(30),
    seats: z.number().int().min(1).max(6),
  })
  .strict();
export const AvailabilityRequest = z.object({ online: z.boolean() }).strict();
export const DriverDocumentRequest = z.object({ type: DriverDocumentType, fileId: Id }).strict();

// ── Responses ───────────────────────────────────────────────────────────────────────────

const page = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

export const RidesProfile = z
  .object({
    riderCode: z.string(),
    preferences: z.object({
      gender: RidesGender.nullable(),
      womenOnlyGroups: z.boolean(),
      driverPreference: DriverPreference,
    }),
    suspended: z.object({ at: When, reason: z.string() }).nullable(),
  })
  .meta({ id: 'RidesProfile' });

export const RidesNode = z
  .object({
    id: StopId,
    name: z.string(),
    shortName: z.string(),
    area: z.enum(['campus', 'city']),
    aliases: z.array(z.string()),
    lat: z.number(),
    lng: z.number(),
  })
  .meta({ id: 'RidesNode' });

const StopRef = z.object({ id: StopId, name: z.string(), shortName: z.string() });

export const RideRequestCreated = z
  .object({
    id: Id,
    pickup: StopRef,
    drop: StopRef,
    pickupTime: When,
    windowStart: When,
    windowEnd: When,
    status: z.string(),
    distanceM: Metres,
    soloFarePaise: Paise,
    pooledEstimatePaise: z.object({ of2: Paise, of3: Paise }),
  })
  .meta({ id: 'RidesRideRequest' });

export const FareBreakup = z
  .object({
    distanceM: Metres,
    baseFarePaise: Paise,
    baseMetres: Metres,
    extraMetres: Metres,
    perKmPaise: Paise,
    distanceChargePaise: Paise,
    meterFarePaise: Paise,
    surgePercent: z.number().int(),
    surgeChargePaise: z.number().int(),
    totalFarePaise: Paise,
    members: z.array(
      z.object({
        name: z.string(),
        dropName: z.string(),
        distanceM: Metres,
        fareSharePaise: Paise,
        soloFarePaise: Paise,
        savedPaise: z.number().int(),
        isYou: z.boolean(),
      }),
    ),
  })
  .meta({ id: 'RidesFareBreakup' });

const MemberRow = z.object({
  userId: Id,
  rideRequestId: Id,
  name: z.string(),
  initials: z.string(),
  isYou: z.boolean(),
  boarded: z.boolean().optional(),
  dropNode: StopRef,
  dropDistanceM: Metres,
  fareSharePaise: Paise,
  soloFarePaise: Paise,
});

export const RidesMatch = z
  .object({
    id: Id,
    score: z.number(),
    routeOverlap: z.number(),
    routeSimilarity: z.number(),
    womenOnly: z.boolean(),
    pickupTime: When,
    totalFarePaise: Paise,
    distanceM: Metres,
    seatsLeft: z.number().int(),
    pickupNode: StopRef,
    /** Opaque: pass back unchanged to `POST /groups/join`. */
    memberRideRequestIds: z.array(Id),
    fare: FareBreakup,
    /** Other riders by first name, without user or request ids (P8, P7-004). */
    members: z.array(MemberRow.omit({ userId: true, rideRequestId: true })),
  })
  .meta({ id: 'RidesMatch' });

export const RidesMatches = z
  .object({ groups: z.array(RidesMatch), hiddenByPreference: z.number().int() })
  .meta({ id: 'RidesMatches' });

export const RidesGroupSummary = z
  .object({
    id: Id,
    status: z.string(),
    kind: GroupKind,
    womenOnly: z.boolean(),
    meetingPoint: z.string().nullable(),
    transitMode: z.string().nullable(),
    pickupName: z.string(),
    dropName: z.string(),
    pickupTime: When,
    seatsLeft: z.number().int(),
    members: z.array(z.object({ name: z.string(), initials: z.string(), dropName: z.string() })),
    fare: FareBreakup,
    isMine: z.boolean(),
    joinBlockedReason: z.string().nullable(),
    paymentPending: z.boolean(),
    isPast: z.boolean(),
    leaveLockedReason: z.string().nullable(),
  })
  .meta({ id: 'RidesGroupSummary' });

export const RidesGroupDetail = z
  .object({
    id: Id,
    womenOnly: z.boolean(),
    driverPreference: z.object({
      femaleRequired: z.boolean(),
      youAskedFemale: z.boolean(),
      youWaived: z.boolean(),
    }),
    status: z.string(),
    pickupTime: When,
    totalFarePaise: Paise,
    distanceM: Metres,
    seatsLeft: z.number().int(),
    kind: GroupKind,
    meetingPoint: z.string().nullable(),
    transitMode: z.string().nullable(),
    leaveLockedReason: z.string().nullable(),
    pickupNode: StopRef,
    memberRideRequestIds: z.array(Id),
    fare: FareBreakup,
    boarded: z.boolean(),
    driverAssigned: z.boolean(),
    youPaid: z.boolean(),
    paymentPending: z.boolean(),
    members: z.array(MemberRow),
  })
  .meta({ id: 'RidesGroupDetail' });

export const RidesDriverCard = z
  .object({
    name: z.string(),
    ratingTenths: z.number().int().nullable(),
    vehicle: z.string(),
    plateNumber: z.string(),
    arrivesAt: When,
    etaMinutes: z.number().int(),
    femaleDriverAsRequested: z.boolean(),
    accepted: z.boolean(),
    vehicleCheck: z.object({
      verified: z.boolean(),
      inspectedOn: When.nullable(),
      registrationNumber: z.string(),
      serviceOverdue: z.boolean(),
    }),
  })
  .meta({ id: 'RidesDriverCard' });

export const RidesChatMessage = z
  .object({
    id: Id,
    groupId: Id,
    message: z.string(),
    createdAt: When,
    userId: Id,
    name: z.string(),
    initials: z.string(),
    isYou: z.boolean(),
  })
  .meta({ id: 'RidesChatMessage' });

export const RidesHistoryRow = z
  .object({
    groupId: Id,
    pickupName: z.string(),
    dropName: z.string(),
    pickupTime: When,
    status: z.string(),
    kind: GroupKind,
    fareSharePaise: Paise,
    soloFarePaise: Paise,
    savedPaise: z.number().int(),
    coRiderNames: z.array(z.string()),
    paid: z.boolean(),
    boarded: z.boolean(),
    active: z.boolean(),
    paymentPending: z.boolean(),
  })
  .meta({ id: 'RidesHistoryRow' });

export const RidesTotals = z.object({
  totalRides: z.number().int(),
  completedRides: z.number().int(),
  totalSavingsPaise: z.number().int(),
  avgFarePaise: z.number().int(),
});

export const RidesStats = RidesTotals.extend({
  activeRide: RidesHistoryRow.nullable(),
  pendingPayments: z.array(RidesHistoryRow),
}).meta({ id: 'RidesStats' });

export const RidesBusyRoute = z.object({
  name: z.string(),
  pickupShort: z.string(),
  dropShort: z.string(),
  count: z.number().int(),
  widthPercent: z.number().int(),
});

export const RidesCampusStats = z
  .object({
    totalUsers: z.number().int(),
    totalPools: z.number().int(),
    avgFarePaise: z.number().int(),
    totalSavingsPaise: z.number().int(),
    hourLabels: z.array(z.string()),
    byHour: z.array(z.number().int()),
  })
  .meta({ id: 'RidesCampusStats' });

export const RidesNotice = z
  .object({
    id: Id,
    message: z.string(),
    level: z.enum(['info', 'warning']),
    at: When,
    expiresAt: When.nullable(),
  })
  .meta({ id: 'RidesNotice' });

const DocumentView = z.object({
  id: Id,
  fileId: Id,
  uploadedAt: When,
  validUntil: When,
  daysLeft: z.number().int(),
  reviewStatus: z.string(),
  reviewedAt: When.nullable(),
  note: z.string().nullable(),
  state: z.string(),
});

export const DriverVerification = z
  .object({
    verified: z.boolean(),
    reverificationRequired: z.boolean(),
    reminder: z.boolean(),
    message: z.string().nullable(),
    documents: z.array(
      z.object({
        type: DriverDocumentType,
        label: z.string(),
        current: DocumentView.nullable(),
        activeUntil: When.nullable(),
        activeDaysLeft: z.number().int().nullable(),
        cleared: z.boolean(),
        lapsed: z.boolean(),
      }),
    ),
  })
  .meta({ id: 'RidesDriverVerification' });

export const DriverMe = z
  .object({
    id: Id,
    name: z.string(),
    initials: z.string(),
    driverCode: z.string(),
    kind: z.string(),
    online: z.boolean(),
    vehicle: z
      .object({
        id: Id,
        model: z.string(),
        plateNumber: z.string(),
        registrationNumber: z.string(),
        colour: z.string().nullable(),
        seats: z.number().int(),
      })
      .nullable(),
    verification: DriverVerification,
    rating: z.object({
      ratingTenths: z.number().int().nullable(),
      rides: z.number().int(),
      ratingsCount: z.number().int(),
    }),
  })
  .meta({ id: 'RidesDriverMe' });

export const DriverRide = z
  .object({
    groupId: Id,
    pickupName: z.string(),
    dropName: z.string(),
    drops: z.array(z.string()),
    pickupTime: When,
    womenOnly: z.boolean(),
    riders: z.array(
      z.object({ firstName: z.string(), dropName: z.string(), boarded: z.boolean() }),
    ),
    distanceM: Metres,
    totalFarePaise: Paise,
    payoutPaise: Paise,
    platformFeePaise: Paise,
    status: z.string(),
    acceptedAt: When.nullable(),
    completedAt: When.nullable(),
  })
  .meta({ id: 'RidesDriverRide' });

export const DriverTrips = z
  .object({
    items: z.array(DriverRide),
    nextCursor: z.string().nullable(),
    summary: z.object({ completedTrips: z.number().int(), earnedPaise: Paise }),
  })
  .meta({ id: 'RidesDriverTrips' });

export const BoardRiderResult = z.object({ rider: z.string(), trip: DriverRide });

export const AdminRideRow = z
  .object({
    id: Id,
    kind: GroupKind,
    status: z.string(),
    womenOnly: z.boolean(),
    pickupName: z.string(),
    dropName: z.string(),
    pickupTime: When,
    isPast: z.boolean(),
    totalFarePaise: Paise,
    driver: z
      .object({ name: z.string(), plateNumber: z.string(), accepted: z.boolean() })
      .nullable(),
    members: z.array(
      z.object({
        userId: Id,
        name: z.string(),
        dropName: z.string(),
        fareSharePaise: Paise,
        boarded: z.boolean(),
        paid: z.boolean(),
      }),
    ),
  })
  .meta({ id: 'RidesAdminRide' });

export const AdminRiderRow = z
  .object({
    id: Id,
    name: z.string(),
    email: z.string(),
    joinedOn: When,
    rides: z.number().int(),
    ridesBoarded: z.number().int(),
    unpaid: z.number().int(),
    reportsAgainst: z.number().int(),
    suspended: z.boolean(),
    suspendedReason: z.string().nullable(),
  })
  .meta({ id: 'RidesAdminRider' });

export const AdminReportRow = z
  .object({
    id: Id,
    status: z.string(),
    category: ReportCategory,
    message: z.string(),
    reportedBy: z.string(),
    aboutRider: z.string().nullable(),
    aboutRiderId: Id.nullable(),
    aboutPlate: z.string().nullable(),
    groupId: Id,
    at: When,
    resolution: z.string().nullable(),
    resolvedBy: z.string().nullable(),
  })
  .meta({ id: 'RidesAdminReport' });

export const AdminDriverRow = z
  .object({
    id: Id,
    name: z.string(),
    email: z.string(),
    driverCode: z.string(),
    vehicle: z.string().nullable(),
    plateNumber: z.string().nullable(),
    online: z.boolean(),
    /** auto: roster auto driver; carpool: a student or mentor with their own car or bike. */
    kind: z.enum(['auto', 'carpool']),
    status: z.enum(['pending', 'approved', 'rejected', 'suspended']),
    verification: DriverVerification,
  })
  .meta({ id: 'RidesAdminDriver' });

export const VehicleView = z
  .object({
    id: Id,
    plateNumber: z.string(),
    registrationNumber: z.string(),
    model: z.string(),
    colour: z.string().nullable(),
    seats: z.number().int(),
    driverName: z.string().nullable(),
    status: z.string(),
    documentsStatus: z.string(),
    flaggedReason: z.string().nullable(),
    documents: z.array(
      z.object({
        document: z.string(),
        expiresOn: When,
        daysLeft: z.number().int(),
        expired: z.boolean(),
        expiringSoon: z.boolean(),
      }),
    ),
    expiringSoon: z.array(z.string()),
    inspection: z.object({
      inspectedOn: When.nullable(),
      current: z.boolean(),
      overdue: z.boolean(),
      pending: z.boolean(),
      pendingId: Id.nullable(),
    }),
    service: z.object({
      lastServicedOn: When,
      daysSinceService: z.number().int(),
      metresSinceService: z.number().int(),
      overdueByDate: z.boolean(),
      overdueByDistance: z.boolean(),
      overdue: z.boolean(),
    }),
    feedback: z.object({
      complaints: z.number().int(),
      ratingCount: z.number().int(),
      avgRatingTenths: z.number().int().nullable(),
      shouldFlag: z.boolean(),
      shouldSuspend: z.boolean(),
    }),
    drivenM: Metres,
    eligible: z.boolean(),
    blockedReason: z.string().nullable(),
  })
  .meta({ id: 'RidesVehicle' });

export const InspectionView = z
  .object({ id: Id, vehicleId: Id, status: z.string(), submittedAt: When })
  .meta({ id: 'RidesInspection' });

export const pages = {
  groups: page(RidesGroupSummary),
  chat: page(RidesChatMessage),
  history: page(RidesHistoryRow),
  notices: page(RidesNotice),
  driverRides: page(DriverRide),
  adminRides: page(AdminRideRow),
  adminRiders: page(AdminRiderRow),
  adminReports: page(AdminReportRow),
  adminDrivers: page(AdminDriverRow),
  vehicles: page(VehicleView),
};

export * from './offers.js';

/** Read-only functions for other modules (`platform.modules.get('rides')`). */
export * as pub from './public.js';
