import { z } from 'zod';

// Exam Review activity events (Person 1). The exam service sends only ids, counts and a seat
// label; the platform owns every sentence (EXAM_ACTIVITY_TEXT), so no free text from the service
// reaches an inbox. Flags are observed events for human review: never a verdict.
const SeatLabel = z.string().regex(/^[A-Za-z0-9-]{1,12}$/, 'a seat label such as B-12');

export const examActivityParams = {
  // To invigilators.
  'exam.flag_created': z
    .object({
      flagId: z.uuid(),
      clipId: z.uuid(),
      examId: z.uuid(),
      seatLabel: SeatLabel.optional(),
    })
    .strict(),
  'exam.flag_reviewed': z
    .object({ flagId: z.uuid(), decision: z.enum(['dismiss', 'follow_up']) })
    .strict(),
  'exam.clip_processed': z
    .object({ clipId: z.uuid(), examId: z.uuid(), flagCount: z.number().int().min(0).max(10_000) })
    .strict(),
} as const;
export type ExamActivityType = keyof typeof examActivityParams;
export const ExamActivityType = z.enum(
  Object.keys(examActivityParams) as [ExamActivityType, ...ExamActivityType[]],
);

type Params<T extends ExamActivityType> = z.infer<(typeof examActivityParams)[T]>;

/** The fixed sentence for each type (stored as the payload's `message`). */
export const EXAM_ACTIVITY_TEXT: { [T in ExamActivityType]: (p: Params<T>) => string } = {
  'exam.flag_created': (p) =>
    `New flag for human review${p.seatLabel ? ` at seat ${p.seatLabel}` : ''}.`,
  'exam.flag_reviewed': (p) =>
    p.decision === 'dismiss'
      ? 'A flag was dismissed after review.'
      : 'A flag was marked for follow-up.',
  'exam.clip_processed': (p) =>
    `A clip finished processing: ${p.flagCount} ${p.flagCount === 1 ? 'flag' : 'flags'} for human review.`,
};

export const examActivity = {
  'exam.flag_created': examActivityParams['exam.flag_created'].extend({ message: z.string() }),
  'exam.flag_reviewed': examActivityParams['exam.flag_reviewed'].extend({ message: z.string() }),
  'exam.clip_processed': examActivityParams['exam.clip_processed'].extend({ message: z.string() }),
} as const;
