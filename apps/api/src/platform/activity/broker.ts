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

// Long-lived non-SSE responses (for example a proxied MJPEG stream), closed with the SSE ones.
const tracked = new Map<string, Set<Stream>>();

/** The longest a tracked response may stay open, whatever the caller asks for. */
export const MAX_TRACKED_MS = 2 * 60 * 60 * 1000;

/**
 * Tracks a long-lived response of this user and session: it is destroyed on that session's
 * logout, the user's deactivation, shutdown, or after `maxMs` (at most 2 hours).
 */
export function trackResponse(
  userId: string,
  sessionId: string,
  res: { destroy(): unknown; once(event: 'close', fn: () => void): unknown },
  maxMs = MAX_TRACKED_MS,
): void {
  let set = tracked.get(userId);
  if (!set) tracked.set(userId, (set = new Set()));
  const timer = setTimeout(() => entry.close(), Math.min(maxMs, MAX_TRACKED_MS));
  timer.unref();
  let closed = false;
  const entry: Stream = {
    sessionId,
    send() {},
    close() {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      const own = tracked.get(userId);
      own?.delete(entry);
      if (own?.size === 0) tracked.delete(userId);
      res.destroy();
    },
  };
  set.add(entry);
  res.once('close', () => entry.close());
}

/**
 * Closes a user's open streams: all of them, all but one session's (`except`), or only one
 * session's (`only`, on logout).
 */
export function closeUserStreams(
  userId: string,
  filter: { except?: string; only?: string } = {},
): void {
  for (const stream of [...(streams.get(userId) ?? []), ...(tracked.get(userId) ?? [])])
    if (
      stream.sessionId !== filter.except &&
      (filter.only === undefined || stream.sessionId === filter.only)
    )
      stream.close();
}

export function closeAllStreams(): void {
  for (const map of [streams, tracked])
    for (const set of [...map.values()]) for (const stream of [...set]) stream.close();
}
