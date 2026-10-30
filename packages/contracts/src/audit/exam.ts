import { z } from 'zod';

// Exam Review audit actions, recorded for the exam service through POST /internal/exam/audit.
// Metadata is small and holds ids, codes, numbers and flags only: a value with spaces (a
// reviewer's note, a name) is refused, so no personal data beyond ids reaches the audit log.
const Value = z.union([
  z.string().regex(/^[A-Za-z0-9_.:-]{0,64}$/),
  z.number(),
  z.boolean(),
  z.null(),
]);
export const ExamAuditMeta = z
  .record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/), Value)
  .refine((m) => Object.keys(m).length <= 20, 'at most 20 keys');

export const EXAM_AUDIT_ACTIONS = [
  'exam.clip_uploaded',
  'exam.clip_deleted',
  'exam.flag_reviewed',
  'exam.flag_reopened',
  'exam.live_session_started',
  'exam.live_session_stopped',
] as const;
export const ExamAuditAction = z.enum(EXAM_AUDIT_ACTIONS);

export const examAudit = Object.fromEntries(EXAM_AUDIT_ACTIONS.map((a) => [a, ExamAuditMeta])) as {
  readonly [A in (typeof EXAM_AUDIT_ACTIONS)[number]]: typeof ExamAuditMeta;
};
