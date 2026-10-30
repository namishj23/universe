import { z } from 'zod';
import { ExamActivityType } from '../activity/exam.js';
import { ExamAuditAction, ExamAuditMeta } from '../audit/exam.js';

// Module E: the platform fronts the exam service (docs/integration/exam-service.md). These are
// the bodies of the service → platform internal routes, and the proxied paths for the docs.
const Key = z.string().regex(/^[A-Za-z0-9_.:-]{8,200}$/);

export const ExamActivityRequest = z
  .object({
    idempotencyKey: Key,
    type: ExamActivityType,
    recipients: z.union([
      z.object({ role: z.literal('invigilator') }).strict(),
      z.object({ userIds: z.array(z.uuid()).min(1).max(100) }).strict(),
    ]),
    params: z.record(z.string(), z.unknown()),
  })
  .strict();
export type ExamActivityRequest = z.infer<typeof ExamActivityRequest>;

export const ExamAuditRequest = z
  .object({
    idempotencyKey: Key,
    actorUserId: z.uuid(),
    action: ExamAuditAction,
    targetType: z.string().regex(/^[a-z_]{1,40}$/),
    targetId: z.uuid(),
    meta: ExamAuditMeta.default({}),
  })
  .strict();
export type ExamAuditRequest = z.infer<typeof ExamAuditRequest>;

export const ExamPushRequest = z
  .object({
    idempotencyKey: Key.optional(),
    userId: z.uuid(),
    event: z.literal('exam.job_progress'),
    data: z
      .object({
        jobId: z.uuid(),
        progress: z.number().min(0).max(100),
        status: z.string().regex(/^[a-z_]{1,20}$/),
      })
      .strict(),
  })
  .strict();
export type ExamPushRequest = z.infer<typeof ExamPushRequest>;

/** Paths the platform forwards to the exam service (relative to `/api/exam`), for the docs. */
export const EXAM_GATEWAY_PATHS: readonly { method: string; path: string; summary: string }[] = [
  { method: 'GET', path: '/exams', summary: 'List exams or rooms' },
  {
    method: 'POST',
    path: '/clips',
    summary: 'Upload a clip (multipart, ≤ 200 MB); 202 {clipId, jobId}',
  },
  { method: 'GET', path: '/clips', summary: 'List clips with job status' },
  { method: 'GET', path: '/clips/{id}', summary: 'Clip detail with job progress' },
  { method: 'GET', path: '/clips/{id}/video', summary: 'The clip (Range, 206)' },
  { method: 'GET', path: '/flags', summary: 'Flags for human review, with counts per status' },
  { method: 'GET', path: '/flags/{id}', summary: 'Flag detail with explanation and history' },
  { method: 'GET', path: '/flags/{id}/snapshot', summary: 'The JPEG snapshot' },
  {
    method: 'POST',
    path: '/flags/{id}/review',
    summary: 'Record a decision (dismiss | follow_up) with a note',
  },
  { method: 'POST', path: '/flags/{id}/reopen', summary: 'Back to open, with a note' },
  { method: 'GET', path: '/dashboard-summary', summary: 'Open flags and last processed time' },
  { method: 'POST', path: '/live/sessions', summary: 'Start a live session (needs consent: true)' },
  { method: 'POST', path: '/live/sessions/{id}/stop', summary: 'Stop a live session' },
  { method: 'GET', path: '/live/sessions/{id}/stream', summary: 'MJPEG stream (tracked, ≤ 2 h)' },
];
