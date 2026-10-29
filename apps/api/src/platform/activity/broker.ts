import type { ActivityEvent } from '@universe/contracts';

export interface Stream {
  /** The session that opened the stream, so signing a session out can close its streams. */
  readonly sessionId: string;
  send(event: string, data: unknown, id?: string): void;
  close(): void;
}

export const MAX_STREAMS_PER_USER = 5;

// ponytail: in-process only; a multi-instance deployment needs PostgreSQL LISTEN/NOTIFY or Redis pub/sub.
const streams = new Map<string, Set<Stream>>();

/** Registers a stream; when the user already has the maximum, the oldest is closed. */
export function addStream(userId: string, stream: Stream): void {
  let set = streams.get(userId);
  if (!set) streams.set(userId, (set = new Set()));
  if (set.size >= MAX_STREAMS_PER_USER) set.values().next().value?.close();
  set.add(stream);
}

export function removeStream(userId: string, stream: Stream): void {
  const set = streams.get(userId);
  if (!set) return;
  set.delete(stream);
  if (set.size === 0) streams.delete(userId);
}

export const connectedUserIds = (userIds: Iterable<string>) =>
  [...new Set(userIds)].filter((id) => streams.has(id));

export function sendToUser(userId: string, event: string, data: unknown, id?: string): void {
  for (const stream of streams.get(userId) ?? []) stream.send(event, data, id);
}

/** `<module>.<name>`: never `activity` or `unread-count`, which the platform owns. */
const EPHEMERAL_EVENT = /^[a-z]+\.[a-z_]+$/;

/**
 * Pushes a named event that is not stored (for example `rides.chat`) to these users' open
 * streams. Offline users miss it, so it must only duplicate data they can fetch again.
 */
export function pushEvent(userIds: Iterable<string>, name: string, data: unknown): void {
  if (!EPHEMERAL_EVENT.test(name)) throw new Error(`Invalid event name: ${name}`);
  for (const id of new Set(userIds)) sendToUser(id, name, data);
}

export const sendActivity = (userId: string, event: ActivityEvent) =>
  sendToUser(userId, 'activity', event, event.id);

/** Closes a user's open streams (all of them, or all but one session's). */
export function closeUserStreams(userId: string, exceptSessionId?: string): void {
  for (const stream of [...(streams.get(userId) ?? [])])
    if (stream.sessionId !== exceptSessionId) stream.close();
}

export function closeAllStreams(): void {
  for (const set of [...streams.values()]) for (const stream of [...set]) stream.close();
}
