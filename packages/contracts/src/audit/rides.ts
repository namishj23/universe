import { z } from 'zod';

// Rides admin actions (Person 1). Metadata never holds personal data: ids, states and the
// admin's own free-text reason only.
const reason = z.string().max(300).nullable();
const change = <T extends z.ZodType>(t: T) => z.object({ from: t, to: t }).strict();

export const ridesAudit = {
  'rides.driver_document_reviewed': z
    .object({
      type: z.enum(['licence', 'inspection_certificate']),
      status: z.enum(['verified', 'rejected']),
    })
    .strict(),
  'rides.ride_cancelled': z.object({ riders: z.number().int().nonnegative(), reason }).strict(),
  'rides.driver_unassigned': z.object({ vehicleId: z.uuid(), reason }).strict(),
  'rides.rider_suspended': z.object({ reason }).strict(),
  'rides.rider_unsuspended': z.object({}).strict(),
  'rides.report_resolved': z.object({ status: z.enum(['resolved', 'dismissed']) }).strict(),
  'rides.notice_posted': z.object({ level: z.enum(['info', 'warning']) }).strict(),
  'rides.notice_deleted': z.object({}).strict(),
  'rides.vehicle_status_changed': z
    .object({ status: change(z.enum(['active', 'suspended'])), reason })
    .strict(),
  'rides.vehicle_documents_updated': z
    .object({ fields: z.array(z.string().max(40)).max(10) })
    .strict(),
  'rides.vehicle_serviced': z.object({ servicedOn: z.iso.datetime() }).strict(),
  'rides.inspection_reviewed': z.object({ status: z.enum(['approved', 'rejected']) }).strict(),
} as const;
