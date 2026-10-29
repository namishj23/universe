import type { Prisma, PrismaClient } from '../../apps/api/src/generated/prisma/client.js';
import type { Db } from '../../apps/api/src/platform/db.js';

// `npm run demo:reset`: empties every module table and the activity feed, then runs the seed
// again, so the demo week starts from now. Never touches users, sessions, the login throttle,
// the audit log (append-only) or the files table (module files are only soft-deleted, so the
// hourly sweep removes their bytes). Local databases only.

/** Every hub, rides and wellbeing table, children before parents (one transaction). */
export const MODULE_TABLES = [
  'HubMentorshipRequest',
  'HubMentorSlot',
  'HubProgressEvent',
  'HubTopicProgress',
  'HubWeeklyGoal',
  'HubResource',
  'HubProfile',
  'HubTopic',
  'HubSubject',
  'RidesChatMessage',
  'RidesVehicleFeedback',
  'RidesSafetyReport',
  'RidesDriverTrip',
  'RidesOfferBooking',
  'RidesGroupMember',
  'RidesRequest',
  'RidesOffer',
  'RidesGroup',
  'RidesDriverDocument',
  'RidesVehicleInspection',
  'RidesDriver',
  'RidesNotice',
  'RidesVehicle',
  'RidesProfile',
  'RidesRouteEdge',
  'RidesNode',
  'WbDailyTotal',
  'WbWeeklySummary',
  'WbSettings',
] as const satisfies readonly Prisma.ModelName[];

/** Prefixes of the tables demo:reset owns (the test checks MODULE_TABLES lists all of them). */
export const MODULE_PREFIXES = ['Hub', 'Rides', 'Wb'] as const;

const MODULE_IDS = ['hub', 'rides', 'wellbeing'];

interface Table {
  count(): Promise<number>;
  deleteMany(): Promise<{ count: number }>;
}
const table = (db: Db, name: (typeof MODULE_TABLES)[number]) =>
  db[`${name[0]!.toLowerCase()}${name.slice(1)}` as Uncapitalize<typeof name>] as unknown as Table;

/** Refuses anything but a local database, with the right name for NODE_ENV. */
export function resetRefusal(databaseUrl: string | undefined, nodeEnv: string | undefined) {
  let url: URL;
  try {
    url = new URL(databaseUrl ?? '');
  } catch {
    return 'DATABASE_URL is missing or not a URL.';
  }
  const name = decodeURIComponent(url.pathname.slice(1));
  if (!['localhost', '127.0.0.1'].includes(url.hostname))
    return `Refusing: database host is ${url.hostname}, not localhost or 127.0.0.1.`;
  const allowed =
    (nodeEnv === 'development' && name === 'universe') ||
    (nodeEnv === 'test' && name === 'universe_test');
  if (!allowed)
    return `Refusing: NODE_ENV=${nodeEnv ?? '(unset)'} with database "${name}" (allowed: development + universe, test + universe_test).`;
  return null;
}

/** What a reset would delete: rows per table, the activity feed and live module files. */
export async function resetPlan(db: Db) {
  const counts = await Promise.all(MODULE_TABLES.map((t) => table(db, t).count()));
  return {
    tables: MODULE_TABLES.map((name, i) => ({ name, rows: counts[i] ?? 0 })),
    activityEvents: await db.activityEvent.count(),
    files: await db.file.count({ where: { module: { in: MODULE_IDS }, deletedAt: null } }),
  };
}

/** Deletes every module table's rows and the activity feed in one transaction. */
export async function resetDemoData(db: PrismaClient) {
  await db.$transaction(async (tx) => {
    for (const name of MODULE_TABLES) await table(tx, name).deleteMany();
    await tx.activityEvent.deleteMany();
    await tx.file.updateMany({
      where: { module: { in: MODULE_IDS }, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  });
}
