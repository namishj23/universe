import { z } from 'zod';

// Owner: Person 1. A driver sees their own working day; everyone else their rides.
const Paise = z.number().int().nonnegative();

export const RidesRiderSummary = z
  .object({
    kind: z.literal('rider'),
    upcomingRide: z
      .object({
        groupId: z.uuid(),
        pickupName: z.string(),
        dropName: z.string(),
        pickupTime: z.iso.datetime(),
        groupSize: z.number().int().positive(),
      })
      .nullable(),
    ridesCompleted: z.number().int().nonnegative(),
    /** Metres ridden in a vehicle shared with at least one other rider. */
    sharedDistanceM: z.number().int().nonnegative(),
    /** Solo fare minus fare share over completed rides, never negative per ride. */
    savedPaise: Paise,
  })
  .strict();

export const RidesDriverSummary = z
  .object({
    kind: z.literal('driver'),
    online: z.boolean(),
    documentStatus: z.enum(['valid', 'expiring_soon', 'missing']),
    tripsToday: z.number().int().nonnegative(),
    payoutTodayPaise: Paise,
  })
  .strict();

export const RidesDashboardSummary = z
  .discriminatedUnion('kind', [RidesRiderSummary, RidesDriverSummary])
  .meta({ id: 'RidesDashboardSummary' });
