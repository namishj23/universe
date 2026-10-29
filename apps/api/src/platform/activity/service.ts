import {
  activityRegistry,
  type ActivityEvent,
  type ActivityModule,
  type ActivityPayload,
  type ActivityType,
} from '@universe/contracts';
import type { Prisma } from '../../generated/prisma/client.js';
import { prisma, type Db } from '../db.js';
import { logger } from '../logger.js';
import { connectedUserIds, sendActivity, sendToUser } from './broker.js';

export interface EmitInput<T extends ActivityType> {
  recipients: string | readonly string[];
  actorId?: string | null;
  module: ActivityModule;
  type: T;
  payload: ActivityPayload<T>;
}

export interface RecordedActivity {
  recipientId: string;
  event: ActivityEvent;
}

export type Emit = <T extends ActivityType>(input: EmitInput<T>) => Promise<RecordedActivity[]>;

const CHUNK = 1_000;
export const actorSelect = { actor: { select: { id: true, name: true } } } as const;

type Row = Prisma.ActivityEventGetPayload<{ include: typeof actorSelect }>;

export const toActivityEvent = (row: Row): ActivityEvent => ({
  id: row.id,
  module: row.module,
  type: row.type,
  payload: row.payload,
  actor: row.actor,
  readAt: row.readAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
});

/**
 * Validates and inserts events (batched, 1,000 rows per INSERT) without pushing them anywhere.
 * Modules use `transaction()` or `emit()` instead; this is for the seed and for `transaction()`.
 */
export async function recordActivity<T extends ActivityType>(
  db: Db,
  input: EmitInput<T>,
): Promise<RecordedActivity[]> {
  const schema = (activityRegistry as Record<string, (typeof activityRegistry)[ActivityType]>)[
    input.type
  ];
  if (!schema) throw new Error(`Unknown activity type: ${input.type}`);
  if (!input.type.startsWith(`${input.module}.`))
    throw new Error(`Activity type ${input.type} does not belong to module ${input.module}`);
  const payload = schema.parse(input.payload);

  const recipients = [
    ...new Set(typeof input.recipients === 'string' ? [input.recipients] : input.recipients),
  ];
  const recorded: RecordedActivity[] = [];
  for (let i = 0; i < recipients.length; i += CHUNK) {
    const rows = await db.activityEvent.createManyAndReturn({
      data: recipients.slice(i, i + CHUNK).map((recipientId) => ({
        recipientId,
        actorId: input.actorId ?? null,
        module: input.module,
        type: input.type,
        payload,
      })),
      include: actorSelect,
    });
    for (const row of rows)
      recorded.push({ recipientId: row.recipientId, event: toActivityEvent(row) });
  }
  return recorded;
}

/** Pushes the current unread count to every open stream of these users (one query). */
export async function pushUnreadCounts(userIds: Iterable<string>): Promise<void> {
  const connected = connectedUserIds(userIds);
  if (connected.length === 0) return;
  const counts = await prisma.activityEvent.groupBy({
    by: ['recipientId'],
    where: { recipientId: { in: connected }, readAt: null },
    _count: { _all: true },
  });
  const byUser = new Map(counts.map((c) => [c.recipientId, c._count._all]));
  for (const id of connected) sendToUser(id, 'unread-count', { count: byUser.get(id) ?? 0 });
}

async function publish(recorded: RecordedActivity[]): Promise<void> {
  for (const { recipientId, event } of recorded) sendActivity(recipientId, event);
  await pushUnreadCounts(recorded.map((r) => r.recipientId));
}

/**
 * Runs `fn` in one database transaction. Events emitted through the `emit` it receives are
 * inserted in that transaction and pushed to live streams only after it commits; if `fn`
 * throws, the transaction rolls back and nothing is pushed.
 *
 *   await transaction(async (tx, emit) => {
 *     await tx.ride.update(...);
 *     await emit({ recipients, actorId, module: 'rides', type: 'rides.matched', payload });
 *   });
 */
export async function transaction<R>(
  fn: (tx: Prisma.TransactionClient, emit: Emit) => Promise<R>,
): Promise<R> {
  const pending: RecordedActivity[] = [];
  const result = await prisma.$transaction((tx) =>
    fn(tx, async (input) => {
      const recorded = await recordActivity(tx, input);
      pending.push(...recorded);
      return recorded;
    }),
  );
  // Committed: the events are stored. A failed push only affects live delivery.
  await publish(pending).catch((err: unknown) => logger.error({ err }, 'activity push failed'));
  return result;
}

/** Records and pushes events when there are no other writes to group them with. */
export const emit: Emit = (input) => transaction((_tx, e) => e(input));
