import { describe, expect, it } from 'vitest';
import {
  computeMetrics,
  pauseSession,
  resumeSession,
  startSession,
  stopSession,
  type FocusSession,
  type SessionResult,
} from '../src/index.js';

const t = (min: number) => new Date(Date.UTC(2026, 9, 30, 4, min));
const ok = (r: SessionResult): FocusSession => {
  if (!r.ok) throw new Error(r.error);
  return r.session;
};

describe('focus session state machine', () => {
  it('runs start → pause → resume → stop', () => {
    const s0 = startSession(t(0));
    const s1 = ok(pauseSession(s0, t(10)));
    const s2 = ok(resumeSession(s1, t(15)));
    const s3 = ok(stopSession(s2, t(30)));
    expect(s3).toEqual({
      startedAt: t(0).toISOString(),
      endedAt: t(30).toISOString(),
      pauses: [{ from: t(10).toISOString(), to: t(15).toISOString() }],
    });
    expect(s0.pauses).toEqual([]); // inputs are never mutated
  });

  it('stopping while paused closes the pause', () => {
    const s = ok(stopSession(ok(pauseSession(startSession(t(0)), t(5))), t(9)));
    expect(s.pauses).toEqual([{ from: t(5).toISOString(), to: t(9).toISOString() }]);
  });

  it('refuses invalid transitions with a typed error', () => {
    const running = startSession(t(0));
    const paused = ok(pauseSession(running, t(1)));
    const stopped = ok(stopSession(running, t(2)));
    expect(resumeSession(running, t(3))).toEqual({ ok: false, error: 'not_paused' });
    expect(pauseSession(paused, t(3))).toEqual({ ok: false, error: 'already_paused' });
    expect(pauseSession(stopped, t(3))).toEqual({ ok: false, error: 'already_stopped' });
    expect(resumeSession(stopped, t(3))).toEqual({ ok: false, error: 'already_stopped' });
    expect(stopSession(stopped, t(3))).toEqual({ ok: false, error: 'already_stopped' });
    expect(pauseSession(ok(resumeSession(paused, t(4))), t(3))).toEqual({
      ok: false,
      error: 'time_before_last_change',
    });
  });

  it('measures an open session and an open pause up to now', () => {
    const open = ok(pauseSession(startSession(t(0)), t(20)));
    const m = computeMetrics(open, [], [], { now: t(30) });
    expect(m.sessionMs).toBe(30 * 60_000);
    expect(m.pausedMs).toBe(10 * 60_000);
    // No events: only the start opens an activity window, capped at 5 minutes.
    expect(m.activeMs).toBe(5 * 60_000);
    expect(m.idleMs).toBe(15 * 60_000);
  });
});
