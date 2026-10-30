import { z } from 'zod';
import { Actor } from '../actor.js';

// Module B · Rides: read-only functions other modules may call through
// `platform.modules.get('rides')`. Stop ids are name-derived, so z.guid().

const StopId = z.guid();

export const PublicStop = z
  .object({
    id: StopId,
    name: z.string(),
    shortName: z.string(),
    area: z.enum(['campus', 'city']),
    /** A car or auto can pick up or drop here (inside campus some stops are walk-only). */
    drivable: z.boolean(),
  })
  .strict();
export type PublicStop = z.infer<typeof PublicStop>;

export const FindStopInput = z.object({ actor: Actor, stopId: StopId }).strict();
export const FindStopOutput = PublicStop.nullable();

/** Name, short name or id, case-insensitive; at most 10 stops, best first. */
export const SearchStopsInput = z
  .object({ actor: Actor, q: z.string().trim().min(1).max(60) })
  .strict();
export const SearchStopsOutput = z.array(PublicStop).max(10);

export const UpcomingInput = z
  .object({ actor: Actor, from: z.date(), to: z.date() })
  .strict()
  .refine((x) => x.to > x.from, { message: 'to must be after from', path: ['to'] });

/** One of the actor's own rides in the window. */
export const UpcomingRide = z
  .object({
    /** booking: a seat in someone's car; offer: the actor drives; request: still searching; group: a pooled auto. */
    kind: z.enum(['booking', 'offer', 'request', 'group']),
    id: z.uuid(),
    /** The offer a booking belongs to. */
    offerId: z.uuid().nullable(),
    /** The actor's pickup (rider) or departure (driver). */
    at: z.date(),
    from: PublicStop,
    to: PublicStop,
    status: z.enum(['confirmed', 'requested', 'searching', 'driving', 'forming']),
    /** Offers: seats taken on the busiest stretch, and seats offered. */
    seats: z.object({ taken: z.number().int().nonnegative(), total: z.number().int() }).nullable(),
    /** Bookings: the driver's name. */
    driverName: z.string().nullable(),
  })
  .strict();
export type UpcomingRide = z.infer<typeof UpcomingRide>;
export const UpcomingOutput = z.array(UpcomingRide).max(100);
