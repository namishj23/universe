// User-controlled focus sessions as pure functions: each returns a new session or a typed error.

export interface Pause {
  from: string;
  to?: string;
}

export interface FocusSession {
  startedAt: string;
  endedAt?: string;
  pauses: Pause[];
}

export type SessionError =
  'already_stopped' | 'already_paused' | 'not_paused' | 'time_before_last_change';

export type SessionResult =
  { ok: true; session: FocusSession } | { ok: false; error: SessionError };

export const isPaused = (s: FocusSession) => s.pauses.some((p) => p.to === undefined);

/** The latest instant recorded in the session; a new change may not come before it. */
const lastChange = (s: FocusSession) =>
  Math.max(
    Date.parse(s.startedAt),
    ...s.pauses.flatMap((p) => [Date.parse(p.from), p.to ? Date.parse(p.to) : -Infinity]),
  );

function guard(s: FocusSession, now: Date): SessionError | null {
  if (s.endedAt !== undefined) return 'already_stopped';
  if (now.getTime() < lastChange(s)) return 'time_before_last_change';
  return null;
}

export const startSession = (now: Date): FocusSession => ({
  startedAt: now.toISOString(),
  pauses: [],
});

export function pauseSession(s: FocusSession, now: Date): SessionResult {
  const error = guard(s, now) ?? (isPaused(s) ? 'already_paused' : null);
  if (error) return { ok: false, error };
  return { ok: true, session: { ...s, pauses: [...s.pauses, { from: now.toISOString() }] } };
}

const closePauses = (s: FocusSession, at: string): Pause[] =>
  s.pauses.map((p) => (p.to === undefined ? { from: p.from, to: at } : p));

export function resumeSession(s: FocusSession, now: Date): SessionResult {
  const error = guard(s, now) ?? (isPaused(s) ? null : 'not_paused');
  if (error) return { ok: false, error };
  return { ok: true, session: { ...s, pauses: closePauses(s, now.toISOString()) } };
}

/** Stopping a paused session closes the pause at the same instant. */
export function stopSession(s: FocusSession, now: Date): SessionResult {
  const error = guard(s, now);
  if (error) return { ok: false, error };
  const at = now.toISOString();
  return { ok: true, session: { ...s, endedAt: at, pauses: closePauses(s, at) } };
}
