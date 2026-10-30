import type { z } from 'zod';
import { activityRegistry, RidesDashboardSummary, type ActivityType } from '@universe/contracts';
import type { CardContent, WebModule } from '../../shell/modules';
import { clock, weekdayTime } from '../../shell/format';

const rupees = (paise: number) => `₹${Math.round(paise / 100).toLocaleString('en-IN')}`;

type Payloads = { [T in ActivityType as T extends `rides.${string}` ? T : never]: T };
type Text = { [T in keyof Payloads]: (p: z.infer<(typeof activityRegistry)[T]>) => string };

/** Plain text after the actor's name (the inbox renders it as text, never HTML). */
const text: Text = {
  'rides.member_joined': (p) =>
    `${p.memberName} joined your ride from ${p.pickupName}, ${weekdayTime(p.pickupTime)}.`,
  'rides.group_confirmed': (p) =>
    `Your ride from ${p.pickupName} is confirmed for ${weekdayTime(p.pickupTime)}.`,
  'rides.driver_assigned': (p) =>
    `${p.driverName} (${p.plateNumber}) is driving your ${clock(p.pickupTime)} ride.`,
  'rides.member_left': (p) => `${p.memberName} left your ride from ${p.pickupName}.`,
  'rides.ride_cancelled': (p) =>
    `Your ${weekdayTime(p.pickupTime)} ride from ${p.pickupName} was cancelled${p.reason ? `: ${p.reason}` : '.'}`,
  'rides.report_resolved': (p) => `Your safety report was ${p.status}.`,
  'rides.suspended': (p) => `Your rides access is suspended: ${p.reason}`,
  'rides.unsuspended': () => 'Your rides access is restored.',
  'rides.notice_posted': (p) => p.message,
  'rides.ride_offered': (p) =>
    `New ride offer: pickup at ${p.pickupName}, ${weekdayTime(p.pickupTime)}.`,
  'rides.rider_boarded': (p) => `${p.riderFirstName} boarded at ${p.pickupName}.`,
  'rides.trip_completed': (p) =>
    `Trip from ${p.pickupName} completed. Payout ${rupees(p.payoutPaise)}.`,
  'rides.document_reviewed': (p) =>
    `Your ${p.type === 'licence' ? 'licence' : 'inspection certificate'} was ${p.status}.`,
  'rides.driver_accepted': (p) => `${p.driverName} accepted your ${clock(p.pickupTime)} ride.`,
  'rides.driver_heading': (p) => `${p.driverName} is on the way to ${p.pickupName}.`,
  'rides.seat_requested': (p) => `asked to join your ${weekdayTime(p.departAt)} ride.`,
  'rides.seat_accepted': (p) => `accepted you on their ${weekdayTime(p.departAt)} ride.`,
  'rides.seat_declined': (p) => `couldn't take you on their ${weekdayTime(p.departAt)} ride.`,
  'rides.offer_cancelled': (p) =>
    `cancelled their ${weekdayTime(p.departAt)} ride from ${p.originName}.`,
  'rides.booking_cancelled': (p) => `cancelled their seat on your ${weekdayTime(p.departAt)} ride.`,
  'rides.offer_departing': (p) => `Your ${clock(p.departAt)} ride from ${p.originName} is leaving.`,
  'rides.carpool_reviewed': (p) =>
    `Your carpool driver application was ${p.status}${p.note ? `: ${p.note}` : '.'}`,
};

// Each formatter only sees a payload its contract accepts; anything else falls back.
const activityText = Object.fromEntries(
  Object.entries(text).map(([type, format]) => [
    type,
    (payload: unknown) =>
      (format as (p: unknown) => string)(activityRegistry[type as keyof Payloads].parse(payload)),
  ]),
);

function dashboardCard(data: unknown): CardContent | null {
  const parsed = RidesDashboardSummary.safeParse(data);
  if (!parsed.success) return null;
  const d = parsed.data;
  if (d.kind === 'driver')
    return {
      big: String(d.tripsToday),
      text: `Trips today, ${rupees(d.payoutTodayPaise)} payout.`,
      status: d.online ? 'ONLINE' : 'OFFLINE',
      tone: d.online ? 'ok' : 'neutral',
    };
  if (d.upcomingRide)
    return {
      big: clock(d.upcomingRide.pickupTime),
      text: `${weekdayTime(d.upcomingRide.pickupTime).split(' ')[0]} ride, ${d.upcomingRide.pickupName} → ${d.upcomingRide.dropName}.`,
      status: `${d.upcomingRide.groupSize} SHARING`,
      tone: 'ok',
    };
  return {
    big: rupees(d.savedPaise),
    text: `Saved over ${d.ridesCompleted} shared rides, estimate.`,
  };
}

const offers = ['rides', 'offers'] as const;
const bookings = ['rides', 'bookings'] as const;
const matches = ['rides', 'matches'] as const;
const groups = ['rides', 'groups'] as const;
/** Live updates: stored rides events refresh the screens they change (see api.ts keys). */
const invalidates: WebModule['invalidates'] = {
  'rides.seat_requested': [offers],
  'rides.booking_cancelled': [offers],
  'rides.seat_accepted': [bookings, matches, offers],
  'rides.seat_declined': [bookings, matches, offers],
  'rides.offer_cancelled': [bookings, matches, offers],
  'rides.offer_departing': [bookings, offers],
  'rides.member_joined': [groups, matches],
  'rides.member_left': [groups, matches],
  'rides.group_confirmed': [groups],
  'rides.driver_assigned': [groups],
  'rides.driver_accepted': [groups],
  'rides.driver_heading': [groups],
  'rides.ride_cancelled': [groups, matches],
  'rides.rider_boarded': [groups],
  'rides.trip_completed': [groups, ['rides', 'stats']],
};

const rides: WebModule = { activityText, dashboardCard, invalidates };
export default rides;
