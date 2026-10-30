import type { PublicUser } from '@universe/contracts';
import type { Platform } from '../../platform/modules/index.js';
import { config } from './config.js';

/** The interactive-transaction client `platform.transaction` hands to its callback. */
export type Tx = Parameters<Parameters<Platform['transaction']>[0]>[0];
export type Emit = Parameters<Parameters<Platform['transaction']>[0]>[1];
export type Db = Platform['prisma'] | Tx;
export type User = PublicUser;

export function errors(p: Platform) {
  const fail = (status: number, code: string, message: string) =>
    new p.http.ApiError(status, code, message);
  return {
    fail,
    notFound: (message = 'Not found') => fail(404, 'NOT_FOUND', message),
    bad: (message: string) => fail(400, 'BAD_REQUEST', message),
    forbidden: (message: string, code = 'FORBIDDEN') => fail(403, code, message),
    conflict: (code: string, message: string) => fail(409, code, message),
  };
}

/** Creates the caller's hub profile on first use (concurrent calls are safe). */
export async function ensureProfile(db: Db, userId: string): Promise<void> {
  await db.$executeRaw`
    INSERT INTO hub_profiles (user_id, updated_at) VALUES (${userId}::uuid, now())
    ON CONFLICT (user_id) DO NOTHING`;
}

/** Listed as a mentor: role mentor, or a student peer mentor with a non-empty expertise list. */
export const isMentor = (
  role: string,
  profile: { isPeerMentor: boolean; mentorExpertise: readonly string[] } | null | undefined,
) =>
  role === 'mentor' ||
  (role === 'student' && !!profile?.isPeerMentor && profile.mentorExpertise.length > 0);

export const iso = (d: Date) => d.toISOString();
export const isoOrNull = (d: Date | null | undefined) => (d ? d.toISOString() : null);
export const percent = (solved: number, total: number) =>
  total > 0 ? Math.round((solved / total) * 100) : 0;

export const toSlot = (s: {
  id: string;
  startsAt: Date;
  endsAt: Date;
  locationLabel: string | null;
  locationStopId: string | null;
  status: string;
}) => ({
  id: s.id,
  startsAt: iso(s.startsAt),
  endsAt: iso(s.endsAt),
  locationLabel: s.locationLabel,
  locationStopId: s.locationStopId,
  status: s.status as 'open' | 'booked' | 'cancelled',
});

/** Case-insensitive de-duplication that keeps the first spelling. */
export const uniqueTags = (items: readonly string[]) => {
  const seen = new Set<string>();
  return items.filter((x) => {
    const k = x.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

/** A PostgreSQL constraint error by name (Prisma wraps the driver error differently per kind). */
export function violates(err: unknown, constraint: string): boolean {
  const seen = new Set<unknown>();
  const walk = (e: unknown): boolean => {
    if (!e || typeof e !== 'object' || seen.has(e)) return false;
    seen.add(e);
    const o = e as Record<string, unknown>;
    if (typeof o.message === 'string' && o.message.includes(constraint)) return true;
    return walk(o.meta) || walk(o.cause) || walk(o.driverAdapterError) || walk(o.originalError);
  };
  return walk(err);
}

/**
 * Whether a mentor may see the student's live card through this request (P7-006): while it is
 * pending or accepted, or for 14 days after the session was completed. Closed requests show
 * the student's name only.
 */
export const cardVisibleWhere = (now = new Date()) => ({
  OR: [
    { status: { in: ['pending', 'accepted'] } },
    {
      status: 'completed',
      completedAt: { gte: new Date(now.getTime() - config.cardDaysAfterCompletion * 86_400_000) },
    },
  ],
});
export const cardVisible = (
  r: { status: string; completedAt: Date | null },
  now = Date.now(),
): boolean =>
  r.status === 'pending' ||
  r.status === 'accepted' ||
  (r.status === 'completed' &&
    r.completedAt !== null &&
    r.completedAt.getTime() >= now - config.cardDaysAfterCompletion * 86_400_000);
