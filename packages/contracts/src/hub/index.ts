import { z } from 'zod';
import { InternalHref } from '../dashboard/week.js';
import { Role } from '../role.js';

// Module A · Student Hub (Person 1). Request schemas are strict (unknown fields, including the
// read-only name and email, are rejected); response schemas describe the API for OpenAPI.

const Id = z.uuid();
const When = z.iso.datetime({ offset: true });
const Day = z.iso.date();
const Percent = z.number().int().min(0).max(100);
const Count = z.number().int().nonnegative();
/** 0..1, rounded to 4 decimals. */
const Unit = z.number().min(0).max(1);
/** Rides stop ids are stable name-derived ids, not RFC 4122 UUIDs. */
const StopId = z.guid();
const Text = (max: number) => z.string().trim().min(1).max(max);
const List = (maxItems: number, maxLen = 40) => z.array(Text(maxLen)).max(maxItems);

export const Year = z.enum(['FE', 'SE', 'TE', 'BE']);
export const Track = z.enum(['dsa', 'aptitude', 'core', 'interview', 'resume']);
export const ResourceType = z.enum(['notes', 'question_paper', 'study_material', 'cheat_sheet']);
export const RequestStatus = z.enum(['pending', 'accepted', 'declined', 'cancelled', 'completed']);
export const SlotStatus = z.enum(['open', 'booked', 'cancelled']);
export const PaceStatus = z.enum(['on_track', 'behind']);
export const TopicId = z.string().regex(/^[a-z0-9-]{2,40}$/);
export const SubjectCode = z.string().regex(/^[A-Z]{2,10}$/);

export const NoQuery = z.object({}).strict();
export const NoBody = z.object({}).strict();
export const HubIdParam = z.object({ id: Id }).strict();
export const TopicParam = z.object({ topicId: TopicId }).strict();
const PageFields = {
  cursor: z.string().min(1).max(300).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};
export const HubPageQuery = z.object(PageFields).strict();
const page = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

// ── Profile ─────────────────────────────────────────────────────────────────────────────

export const ReadinessTracks = z.object({
  dsa: Percent,
  aptitude: Percent,
  core: Percent,
  interview: Percent,
  resume: Percent,
});

export const Readiness = z
  .object({
    /** Σ weight × track completion, 0–100. A track with no tracked topics counts 0. */
    score: Percent,
    tracks: ReadinessTracks,
    weights: z.object({
      dsa: Unit,
      aptitude: Unit,
      core: Unit,
      interview: Unit,
      resume: Unit,
    }),
  })
  .meta({ id: 'HubReadiness' });

/** Partial update: omitted fields keep their value; `null` clears an optional one. */
export const UpdateProfileRequest = z
  .object({
    branch: Text(80).nullable().optional(),
    year: Year.nullable().optional(),
    skills: List(30).optional(),
    interests: List(20).optional(),
    targetRole: Text(80).nullable().optional(),
    targetCompanies: List(10, 60).optional(),
    placementDeadline: Day.nullable().optional(),
    /** Students only: appear as a mentor (needs a non-empty `mentorExpertise`). */
    isPeerMentor: z.boolean().optional(),
    mentorExpertise: List(15).optional(),
    mentorDepartment: Text(80).nullable().optional(),
    mentorCapacity: z.number().int().min(0).max(20).optional(),
  })
  .strict()
  .meta({ id: 'HubUpdateProfileRequest' });

export const HubProfile = z
  .object({
    /** From the platform account; read-only here. */
    user: z.object({ id: Id, name: z.string(), email: z.string(), role: Role }),
    branch: z.string().nullable(),
    year: Year.nullable(),
    skills: z.array(z.string()),
    interests: z.array(z.string()),
    targetRole: z.string().nullable(),
    targetCompanies: z.array(z.string()),
    placementDeadline: Day.nullable(),
    isPeerMentor: z.boolean(),
    /** Listed as a mentor: role mentor, or a peer mentor with expertise. */
    isMentor: z.boolean(),
    mentorExpertise: z.array(z.string()),
    mentorDepartment: z.string().nullable(),
    mentorCapacity: z.number().int(),
    readiness: Readiness,
    updatedAt: When.nullable(),
  })
  .meta({ id: 'HubProfile' });

/** What a mentor sees of a student who asked them (and what admins see). */
export const StudentCard = z
  .object({
    id: Id,
    name: z.string(),
    year: Year.nullable(),
    branch: z.string().nullable(),
    /** DSA sheet completion over tracked topics. */
    dsaPercent: Percent,
    readiness: Percent,
  })
  .meta({ id: 'HubStudentCard' });

// ── Prep ────────────────────────────────────────────────────────────────────────────────

export const TopicProgress = z
  .object({
    topicId: TopicId,
    track: Track,
    name: z.string(),
    tag: z.string(),
    solved: Count,
    total: Count,
    percent: Percent,
  })
  .meta({ id: 'HubTopicProgress' });

export const CatalogueTopic = z
  .object({ topicId: TopicId, track: Track, name: z.string(), tag: z.string(), total: Count })
  .meta({ id: 'HubCatalogueTopic' });

const Totals = z.object({ solved: Count, total: Count, percent: Percent });

export const WeekGoal = z
  .object({
    target: z.number().int().min(1).max(200),
    /** max(0, Σ changes since the week began): a +1 then a −1 correction counts 0. */
    done: Count,
    left: Count,
    /** Sunday (Asia/Kolkata). */
    weekStart: Day,
    /** Saturday 23:59:59.999 Asia/Kolkata. */
    weekEndsAt: When,
    /** target × share of the week elapsed, 1 decimal. */
    expectedByNow: z.number().nonnegative(),
    status: PaceStatus,
  })
  .meta({ id: 'HubWeekGoal' });

export const PrepView = z
  .object({
    tracks: z.array(
      Totals.extend({ track: Track, topics: z.array(TopicProgress) }).meta({ id: 'HubPrepTrack' }),
    ),
    untracked: z.array(CatalogueTopic),
    /** The OVERALL card: tracked DSA topics. */
    dsa: Totals,
    readiness: Readiness,
    week: WeekGoal,
    /** Cumulative solved over tracked topics at the end of each of the last 30 IST days. */
    series: z.array(z.object({ date: Day, solved: Count })).length(30),
    /**
     * Minutes of focused study this week from Wellbeing, present only when the student has
     * turned sharing on there (and counts study). Nothing else from Wellbeing reaches the hub.
     */
    focusStudyMinutesThisWeek: Count.optional(),
  })
  .meta({ id: 'HubPrepView' });

export const TrackTopicsRequest = z
  .object({ topicIds: z.array(TopicId).max(50) })
  .strict()
  .meta({ id: 'HubTrackTopicsRequest' });

export const IncrementRequest = z
  .object({
    delta: z
      .number()
      .int()
      .min(-5)
      .max(5)
      .refine((d) => d !== 0, 'delta must not be 0'),
  })
  .strict()
  .meta({ id: 'HubIncrementRequest' });

export const IncrementResponse = z
  .object({ topic: TopicProgress, dsa: Totals, week: WeekGoal })
  .meta({ id: 'HubIncrementResponse' });

export const GoalRequest = z
  .object({ target: z.number().int().min(1).max(200) })
  .strict()
  .meta({ id: 'HubGoalRequest' });

// ── Mentors and slots ───────────────────────────────────────────────────────────────────

export const Slot = z
  .object({
    id: Id,
    startsAt: When,
    endsAt: When,
    locationLabel: z.string().nullable(),
    locationStopId: z.string().nullable(),
    status: SlotStatus,
  })
  .meta({ id: 'HubSlot' });

export const MySlot = Slot.extend({
  /** The accepted (or completed) request that booked it. */
  booking: z.object({ requestId: Id, studentName: z.string() }).nullable(),
}).meta({ id: 'HubMySlot' });

export const SlotQuery = z
  .object({ ...PageFields, status: SlotStatus.optional() })
  .strict()
  .meta({ id: 'HubSlotQuery' });

export const CreateSlotRequest = z
  .object({
    startsAt: When,
    endsAt: When,
    locationLabel: Text(120).optional(),
    locationStopId: StopId.optional(),
  })
  .strict()
  .refine(
    (s) => {
      const minutes = (Date.parse(s.endsAt) - Date.parse(s.startsAt)) / 60_000;
      return minutes >= 30 && minutes <= 180;
    },
    { message: 'A slot is 30 to 180 minutes long', path: ['endsAt'] },
  )
  .meta({ id: 'HubCreateSlotRequest' });

/** The caller's live request with this mentor, for the button on the mentor card. */
export const MyRequest = z
  .discriminatedUnion('status', [
    z.object({ status: z.literal('none') }),
    z.object({ status: z.literal('pending'), requestId: Id }),
    z.object({ status: z.literal('accepted'), requestId: Id, startsAt: When, endsAt: When }),
  ])
  .meta({ id: 'HubMyRequest' });

export const RankComponents = z
  .object({
    /** 0.75 × weakTopicCoverage + 0.25 × interestOverlap (weights in config). */
    match: Unit,
    weakTopicCoverage: Unit,
    interestOverlap: Unit,
    /** Open slots in the next 7 days ÷ 4, capped at 1. */
    availability: Unit,
    /** Current mentees ÷ capacity (1 when capacity is 0). */
    load: Unit,
  })
  .meta({ id: 'HubRankComponents' });

export const MentorCard = z
  .object({
    rank: z.number().int().positive(),
    mentorId: Id,
    name: z.string(),
    department: z.string().nullable(),
    expertise: z.array(z.string()),
    capacity: Count,
    capacityLeft: Count,
    /** 0.6 × match + 0.2 × availability + 0.2 × (1 − load). */
    score: Unit,
    components: RankComponents,
    /** Open slots starting in the next 7 days. */
    slotsThisWeek: Count,
    nextSlots: z.array(Slot).max(3),
    /** Names of the caller's three weakest topics this mentor covers. */
    coveredTopics: z.array(z.string()),
    reason: z.string(),
    myRequest: MyRequest,
  })
  .meta({ id: 'HubMentorCard' });

export const WeakTopic = z
  .object({ topicId: TopicId, name: z.string(), tag: z.string(), weakness: Unit })
  .meta({ id: 'HubWeakTopic' });

export const MentorList = page(MentorCard)
  .extend({ weakTopics: z.array(WeakTopic).max(3) })
  .meta({ id: 'HubMentorList' });

export const MentorProfile = z
  .object({
    mentorId: Id,
    name: z.string(),
    department: z.string().nullable(),
    expertise: z.array(z.string()),
    capacity: Count,
    capacityLeft: Count,
    slotsThisWeek: Count,
    /** Every open slot in the next 7 days, soonest first. */
    openSlots: z.array(Slot),
  })
  .meta({ id: 'HubMentorProfile' });

export const AdminMentorRow = z
  .object({
    rank: z.number().int().positive(),
    mentorId: Id,
    name: z.string(),
    department: z.string().nullable(),
    expertise: z.array(z.string()),
    capacity: Count,
    /** Current mentees (accepted, not completed). */
    mentees: Count,
    score: Unit,
    components: RankComponents,
    reason: z.string(),
    slotsThisWeek: Count,
    requestsLast30Days: Count,
  })
  .meta({ id: 'HubAdminMentorRow' });

export const AdminMentorList = page(AdminMentorRow)
  .extend({ weakTopics: z.array(WeakTopic).max(3) })
  .meta({ id: 'HubAdminMentorList' });

// ── Mentorship requests ─────────────────────────────────────────────────────────────────

export const CreateMentorshipRequest = z
  .object({ mentorId: Id, slotId: Id.optional(), note: Text(500).optional() })
  .strict()
  .meta({ id: 'HubCreateMentorshipRequest' });

export const AcceptRequest = z
  .object({ slotId: Id.optional() })
  .strict()
  .meta({ id: 'HubAcceptRequest' });

export const MentorshipRequest = z
  .object({
    id: Id,
    status: RequestStatus,
    note: z.string().nullable(),
    createdAt: When,
    decidedAt: When.nullable(),
    /** The requested slot while pending; the booked slot once accepted. */
    slot: Slot.nullable(),
    mentor: z.object({ id: Id, name: z.string(), department: z.string().nullable() }),
    /**
     * The full card for the student and admins, and for the mentor while the request is
     * pending or accepted (or completed within 14 days); otherwise the name only (P8, P7-006).
     */
    student: z.union([StudentCard, z.object({ id: Id, name: z.string() })]),
    /**
     * Accepted sessions at a stop a car can reach: opens Rides to arrive 15 minutes early,
     * `/rides?to=<stopId>&date=YYYY-MM-DD&arriveBy=HH:MM` (IST). Null otherwise.
     */
    rideLink: z.object({ href: InternalHref }).nullable(),
  })
  .meta({ id: 'HubMentorshipRequest' });

export const IncomingQuery = z
  .object({ ...PageFields, status: RequestStatus.optional() })
  .strict()
  .meta({ id: 'HubIncomingQuery' });

// ── Resources ───────────────────────────────────────────────────────────────────────────

export const Subject = z.object({ code: SubjectCode, name: z.string() }).meta({ id: 'HubSubject' });

export const CreateResourceRequest = z
  .object({
    /** From `POST /api/files/hub.resource`. */
    fileId: Id,
    title: z.string().trim().min(3).max(160),
    description: z.string().trim().min(1).max(1000).optional(),
    subject: SubjectCode,
    type: ResourceType,
    semester: z.number().int().min(1).max(8).optional(),
    examYear: z.number().int().min(1990).max(2100).optional(),
  })
  .strict()
  .meta({ id: 'HubCreateResourceRequest' });

export const Resource = z
  .object({
    id: Id,
    /** Download with `GET /api/files/{fileId}`. */
    fileId: Id,
    title: z.string(),
    description: z.string().nullable(),
    subject: SubjectCode,
    type: ResourceType,
    semester: z.number().int().nullable(),
    examYear: z.number().int().nullable(),
    uploader: z.object({ id: Id, name: z.string() }),
    sizeBytes: Count,
    mimeType: z.string(),
    createdAt: When,
    deletedAt: When.nullable(),
    /** The caller uploaded it or is an admin. */
    canDelete: z.boolean(),
  })
  .meta({ id: 'HubResource' });

const ResourceFilters = {
  ...PageFields,
  /** Words in the title, description or subject (prefix match), or part of the uploader's name. */
  q: z.string().trim().max(100).optional(),
  subject: SubjectCode.optional(),
  type: ResourceType.optional(),
  semester: z.coerce.number().int().min(1).max(8).optional(),
};
export const ResourceQuery = z.object(ResourceFilters).strict().meta({ id: 'HubResourceQuery' });
export const AdminResourceQuery = z
  .object({ ...ResourceFilters, status: z.enum(['active', 'deleted', 'all']).default('all') })
  .strict()
  .meta({ id: 'HubAdminResourceQuery' });

export const pages = {
  slots: page(MySlot).meta({ id: 'HubSlotPage' }),
  requests: page(MentorshipRequest).meta({ id: 'HubRequestPage' }),
  resources: page(Resource).meta({ id: 'HubResourcePage' }),
};

export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequest>;
export type HubProfile = z.infer<typeof HubProfile>;
export type Readiness = z.infer<typeof Readiness>;
export type StudentCard = z.infer<typeof StudentCard>;
export type TopicProgress = z.infer<typeof TopicProgress>;
export type PrepView = z.infer<typeof PrepView>;
export type WeekGoal = z.infer<typeof WeekGoal>;
export type Slot = z.infer<typeof Slot>;
export type MySlot = z.infer<typeof MySlot>;
export type MyRequest = z.infer<typeof MyRequest>;
export type RankComponents = z.infer<typeof RankComponents>;
export type MentorCard = z.infer<typeof MentorCard>;
export type MentorList = z.infer<typeof MentorList>;
export type MentorProfile = z.infer<typeof MentorProfile>;
export type AdminMentorRow = z.infer<typeof AdminMentorRow>;
export type AdminMentorList = z.infer<typeof AdminMentorList>;
export type MentorshipRequest = z.infer<typeof MentorshipRequest>;
export type Resource = z.infer<typeof Resource>;
export type Track = z.infer<typeof Track>;
export type ResourceType = z.infer<typeof ResourceType>;
export type RequestStatus = z.infer<typeof RequestStatus>;

/** Read-only functions for other modules (`platform.modules.get('hub')`). */
export * as pub from './public.js';
