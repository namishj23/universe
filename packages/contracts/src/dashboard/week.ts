import { z } from 'zod';
import { ModuleId } from '../modules.js';

// Owner: Person 1 (platform). The dashboard's week strip: `GET /api/dashboard/week`.

/** A calendar date, `YYYY-MM-DD`, that really exists (no 31 November). */
export const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'Not a calendar date');

export const WeekQuery = z.object({ from: IsoDate.optional() }).strict();
export type WeekQuery = z.infer<typeof WeekQuery>;

/** The `X-Timezone` request header: an IANA zone name such as `Asia/Kolkata`. */
export const TimeZoneHeader = z
  .string()
  .min(1)
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'Not a time zone');

/** Shown under an item; the tone picks the status colour. */
export const WeekStatus = z
  .object({ label: z.string().min(1).max(40), tone: z.enum(['ok', 'warn', 'neutral']) })
  .strict();
export type WeekStatus = z.infer<typeof WeekStatus>;

/** A path inside the app (`/rides/offers/…`): never another origin. */
export const InternalHref = z
  .string()
  .max(300)
  .regex(/^\/(?!\/)[^\\]*$/, 'Must be an internal path');

/**
 * What a module's `weekItems` provider returns, one entry per dated item. The platform adds
 * the module id, puts each item on its day in the user's time zone and formats the time.
 */
export const WeekProviderItem = z
  .object({
    at: z.iso.datetime({ offset: true }),
    allDay: z.boolean().default(false),
    title: z.string().min(1).max(120),
    status: WeekStatus.optional(),
    /** Unconfirmed items (a ride still searching, a tentative session) are drawn dashed. */
    confirmed: z.boolean(),
    href: InternalHref,
  })
  .strict();
export type WeekProviderItem = z.input<typeof WeekProviderItem>;
export const WeekProviderOutput = z.array(WeekProviderItem).max(50);

const weekItemBase = {
  module: ModuleId,
  title: z.string(),
  status: WeekStatus.optional(),
  confirmed: z.boolean(),
  href: InternalHref,
};
export const WeekItem = z
  .union([
    z.object({ ...weekItemBase, time: z.string().regex(/^\d{2}:\d{2}$/) }).strict(),
    z.object({ ...weekItemBase, allDay: z.literal(true) }).strict(),
  ])
  .meta({ id: 'WeekItem' });
export type WeekItem = z.infer<typeof WeekItem>;

export const WeekDay = z.object({ date: IsoDate, items: z.array(WeekItem) });
export type WeekDay = z.infer<typeof WeekDay>;

export const WeekResponse = z
  .object({
    from: IsoDate,
    timeZone: z.string(),
    days: z.array(WeekDay).length(7),
    /** One entry per visible module that has a provider; a failure never fails the response. */
    modules: z.array(z.object({ id: ModuleId, status: z.enum(['ok', 'error', 'timeout']) })),
  })
  .meta({ id: 'WeekResponse' });
export type WeekResponse = z.infer<typeof WeekResponse>;
