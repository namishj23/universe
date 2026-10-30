import { z } from 'zod';

// Module D · Digital Wellbeing (Person 1). The server only ever sees one total in minutes per
// category per day, plus the user's settings. No URLs, domains, titles or session timelines:
// those stay in the browser (`@universe/wellbeing-core`). Request schemas are strict.

const When = z.iso.datetime({ offset: true });
const Day = z.iso.date();
const Count = z.number().int().nonnegative();

/** Must match `CATEGORIES` in `@universe/wellbeing-core` (a test checks). */
export const Category = z.enum(['study', 'communication', 'social', 'entertainment', 'other']);
export type Category = z.infer<typeof Category>;
export const TrackingState = z.enum(['on', 'paused', 'off']);
export type TrackingState = z.infer<typeof TrackingState>;
export const Minutes = z.number().int().min(0).max(1440);
export const RETENTION_DAYS = { min: 7, max: 365, default: 90 } as const;
export const MAX_UPLOAD_DAYS = 31;

export const NoQuery = z.object({}).strict();

export const Settings = z
  .object({
    tracking: TrackingState,
    pausedSince: When.nullable(),
    /** Categories that are counted; the others show "off". */
    categories: z.array(Category),
    retentionDays: z.number().int().min(RETENTION_DAYS.min).max(RETENTION_DAYS.max),
    /** May the Student Hub show my study minutes this week (to me only)? */
    shareStudyWithHub: z.boolean(),
    updatedAt: When,
  })
  .meta({ id: 'WellbeingSettings' });
export type Settings = z.infer<typeof Settings>;

const distinct = <T>(xs: readonly T[]) => new Set(xs).size === xs.length;

/** Partial update; omitted fields keep their value. Turning a category off keeps its rows. */
export const UpdateSettingsRequest = z
  .object({
    categories: z.array(Category).max(5).refine(distinct, 'Categories must be distinct').optional(),
    retentionDays: z.number().int().min(RETENTION_DAYS.min).max(RETENTION_DAYS.max).optional(),
    shareStudyWithHub: z.boolean().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Send at least one setting');
export type UpdateSettingsRequest = z.infer<typeof UpdateSettingsRequest>;

export const TrackingRequest = z.object({ state: TrackingState }).strict();
export type TrackingRequest = z.infer<typeof TrackingRequest>;

export const TotalRow = z
  .object({ date: Day, category: Category, minutes: Minutes })
  .strict()
  .meta({ id: 'WellbeingTotal' });
export type TotalRow = z.infer<typeof TotalRow>;

/** Up to 31 days × 5 categories; each (date, category) at most once. */
export const UploadTotalsRequest = z
  .object({
    rows: z
      .array(TotalRow)
      .min(1)
      .max(MAX_UPLOAD_DAYS * 5),
  })
  .strict()
  .refine((b) => distinct(b.rows.map((r) => `${r.date}|${r.category}`)), {
    message: 'Each date and category may appear once',
    path: ['rows'],
  })
  .refine((b) => new Set(b.rows.map((r) => r.date)).size <= MAX_UPLOAD_DAYS, {
    message: `At most ${MAX_UPLOAD_DAYS} days per upload`,
    path: ['rows'],
  });
export type UploadTotalsRequest = z.infer<typeof UploadTotalsRequest>;

export const UploadTotalsResponse = z.object({ stored: Count });

export const SummaryQuery = z
  .object({ days: z.coerce.number().int().min(7).max(31).default(7) })
  .strict();

export const Summary = z
  .object({
    /** Today in Asia/Kolkata. */
    today: Day,
    /** Sum of today's rows for counted categories. */
    todayMinutes: Count,
    /** Every category in a fixed order; `counted: false` shows "off". */
    categories: z.array(z.object({ category: Category, minutes: Count, counted: z.boolean() })),
    /** Today and the previous `days − 1` days, oldest first (counted categories). */
    series: z.array(z.object({ date: Day, minutes: Count })),
    /** Mean of the previous days that have stored rows, rounded; absent when there are none. */
    average: Count.optional(),
    /** round(|1 − today ÷ average| × 100); absent when there is no average. */
    percentVsAverage: Count.optional(),
    direction: z.enum(['under', 'over']).optional(),
    /** Every stored row, whatever its category. */
    recordCount: Count,
    tracking: TrackingState,
    pausedSince: When.nullable(),
  })
  .meta({ id: 'WellbeingSummary' });
export type Summary = z.infer<typeof Summary>;

export const RecordsQuery = z
  .object({
    cursor: z.string().min(1).max(100).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export const RecordsPage = z
  .object({ items: z.array(TotalRow), nextCursor: z.string().nullable(), total: Count })
  .meta({ id: 'WellbeingRecordsPage' });

export const RecordParams = z.object({ date: Day, category: Category }).strict();

export const RangeQuery = z
  .object({ from: Day, to: Day })
  .strict()
  .refine((q) => q.from <= q.to, { message: '`from` must not be after `to`', path: ['from'] });

export const Deleted = z.object({ deleted: Count });

export const ExportDocument = z
  .object({
    schemaVersion: z.literal(1),
    generatedAt: When,
    recordCount: Count,
    settings: Settings,
    records: z.array(TotalRow),
  })
  .meta({ id: 'WellbeingExport' });
export type ExportDocument = z.infer<typeof ExportDocument>;

/** Typed confirmation, so delete-everything can't fire by accident. */
export const DeleteDataRequest = z.object({ confirm: z.literal('DELETE') }).strict();
