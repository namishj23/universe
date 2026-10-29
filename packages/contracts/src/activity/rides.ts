import { z } from 'zod';

// Rides activity events (Person 1). Payloads carry ids and display text only: never a
// rider's gender, preferences or rider code.
const group = { groupId: z.uuid() };
const ride = { ...group, pickupName: z.string(), pickupTime: z.iso.datetime({ offset: true }) };

export const ridesActivity = {
  'rides.member_joined': z.object({ ...ride, memberName: z.string() }).strict(),
  'rides.group_confirmed': z.object(ride).strict(),
  'rides.driver_assigned': z
    .object({ ...ride, driverName: z.string(), plateNumber: z.string() })
    .strict(),
  'rides.member_left': z.object({ ...ride, memberName: z.string() }).strict(),
  'rides.ride_cancelled': z.object({ ...ride, reason: z.string().nullable() }).strict(),
  'rides.report_resolved': z
    .object({ reportId: z.uuid(), status: z.enum(['resolved', 'dismissed']) })
    .strict(),
  'rides.suspended': z.object({ reason: z.string() }).strict(),
  'rides.unsuspended': z.object({}).strict(),
  'rides.notice_posted': z
    .object({ noticeId: z.uuid(), message: z.string(), level: z.enum(['info', 'warning']) })
    .strict(),
  // To drivers.
  'rides.ride_offered': z.object(ride).strict(),
  'rides.rider_boarded': z.object({ ...ride, riderFirstName: z.string() }).strict(),
  'rides.trip_completed': z
    .object({ ...ride, payoutPaise: z.number().int().nonnegative() })
    .strict(),
  'rides.document_reviewed': z
    .object({
      documentId: z.uuid(),
      type: z.enum(['licence', 'inspection_certificate']),
      status: z.enum(['verified', 'rejected']),
    })
    .strict(),
  // To riders, about their driver.
  'rides.driver_accepted': z.object({ ...ride, driverName: z.string() }).strict(),
  'rides.driver_heading': z.object({ ...ride, driverName: z.string() }).strict(),
} as const;
