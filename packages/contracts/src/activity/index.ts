import { z } from 'zod';
import { Role } from '../role.js';
import { hubActivity } from './hub.js';
import { platformActivity } from './platform.js';
import { ridesActivity } from './rides.js';

export const ActivityModule = z.enum([
  'platform',
  'hub',
  'rides',
  'wellbeing',
  'observatory',
  'exam',
]);
export type ActivityModule = z.infer<typeof ActivityModule>;

/**
 * Every activity type and its payload schema. Each module owner adds
 * `activity/<module>.ts` and spreads it in here. Type names start with
 * the module name (`rides.matched`), which `emit()` checks.
 */
export const activityRegistry = {
  ...platformActivity,
  ...ridesActivity,
  ...hubActivity,
} as const;

export type ActivityType = keyof typeof activityRegistry;
export type ActivityPayload<T extends ActivityType> = z.infer<(typeof activityRegistry)[T]>;

export const ActivityEvent = z
  .object({
    id: z.uuid(),
    module: ActivityModule,
    type: z.string(),
    payload: z.unknown(),
    actor: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    readAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'ActivityEvent' });
export type ActivityEvent = z.infer<typeof ActivityEvent>;

export const UnreadCount = z.object({ count: z.number().int().nonnegative() });
export type UnreadCount = z.infer<typeof UnreadCount>;

export const AnnouncementRequest = z
  .object({
    message: z.string().trim().min(1).max(500),
    roles: z.array(Role).min(1).max(Role.options.length).optional(),
  })
  .strict();
export type AnnouncementRequest = z.infer<typeof AnnouncementRequest>;

export const AnnouncementResponse = z.object({ recipients: z.number().int().nonnegative() });
export type AnnouncementResponse = z.infer<typeof AnnouncementResponse>;
