import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addDays,
  attribute,
  dailyTotals,
  DEFAULT_RULES,
  sanitiseEvents,
  type CleanEvent,
  type FocusSession,
  type Rule,
} from '@universe/wellbeing-core';
import type { wellbeing as W } from '@universe/contracts';
import {
  EMPTY,
  isSession,
  memoryStore,
  openLocalStore,
  type LocalData,
  type LocalStore,
} from './local';

/** At most this many sanitised events stay on the device (oldest go first). */
// ponytail: whole arrays per key; a per-event object store when devices keep months of events.
const MAX_EVENTS = 50_000;
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

export interface Device {
  ready: boolean;
  mode: LocalStore['mode'];
  data: LocalData;
  rules: readonly Rule[];
  update: (patch: Partial<LocalData>) => Promise<void>;
  clear: () => Promise<void>;
}

/** The signed-in user's local store, loaded once per user; write failures fall back to memory. */
export function useDevice(userId: string): Device {
  const store = useRef<LocalStore>(memoryStore());
  const [mode, setMode] = useState<LocalStore['mode']>('memory');
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<LocalData>(EMPTY);
  const latest = useRef<LocalData>(EMPTY);

  useEffect(() => {
    let live = true;
    void (async () => {
      const opened = await openLocalStore(userId);
      const loaded = await opened.load().catch(() => EMPTY);
      if (!live) return;
      store.current = opened;
      latest.current = loaded;
      setMode(opened.mode);
      setData(loaded);
      setReady(true);
    })();
    return () => {
      live = false;
    };
  }, [userId]);

  const update = useCallback(async (patch: Partial<LocalData>) => {
    latest.current = { ...latest.current, ...patch };
    setData(latest.current);
    try {
      await store.current.save(patch);
    } catch {
      // The device store failed mid-use: keep going in memory, with everything we hold.
      const memory = memoryStore();
      await memory.save(latest.current);
      store.current = memory;
      setMode('memory');
    }
  }, []);

  const clear = useCallback(async () => {
    latest.current = EMPTY;
    setData(EMPTY);
    await store.current.clear().catch(() => undefined);
  }, []);

  return { ready, mode, data, rules: data.rules ?? DEFAULT_RULES, update, clear };
}

/** Events sanitised on arrival; only `{ at, kind, domain? }` is ever kept. */
export function addEvents(data: LocalData, raw: readonly unknown[], now = new Date()) {
  const { events, rejected } = sanitiseEvents(raw, now);
  const all = [...data.events, ...events];
  return {
    events: all.length > MAX_EVENTS ? all.slice(all.length - MAX_EVENTS) : all,
    added: events.length,
    rejected: rejected.length,
  };
}

// A bad timestamp stays as it is, so the sanitiser rejects it (never throws here).
const shift = (iso: string, ms: number) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t + ms).toISOString() : iso;
};
const shiftSession = (s: FocusSession, ms: number): FocusSession => ({
  startedAt: shift(s.startedAt, ms),
  ...(s.endedAt && { endedAt: shift(s.endedAt, ms) }),
  pauses: s.pauses.map((p) => ({ from: shift(p.from, ms), ...(p.to && { to: shift(p.to, ms) }) })),
});

interface ImportDoc {
  events: unknown[];
  session: FocusSession | null;
}

/** A sample day's file or the user's own: an array of events, or `{ events, session? }`. */
export function readImport(json: unknown): ImportDoc | null {
  if (Array.isArray(json)) return { events: json, session: null };
  if (typeof json !== 'object' || json === null) return null;
  const { events, session } = json as Record<string, unknown>;
  if (!Array.isArray(events)) return null;
  return { events, session: isSession(session, true) ? session : null };
}

/**
 * Adds an import to the device. A sample day is moved so it ends now (its events then count
 * toward today); a user's file keeps its times. Without a session, one spans its events.
 */
export function applyImport(
  data: LocalData,
  doc: ImportDoc,
  { rebaseFrom, now = new Date() }: { rebaseFrom?: string; now?: Date } = {},
) {
  const delta = rebaseFrom ? now.getTime() - Date.parse(rebaseFrom) : 0;
  const raw = delta
    ? doc.events.map((e) =>
        typeof e === 'object' && e !== null && typeof (e as { at?: unknown }).at === 'string'
          ? { ...e, at: shift((e as { at: string }).at, delta) }
          : e,
      )
    : doc.events;
  const { events, added, rejected } = addEvents(data, raw, now);
  const fresh = events.slice(events.length - added);
  let session = doc.session && delta ? shiftSession(doc.session, delta) : doc.session;
  if (!session && fresh.length) {
    const times = fresh.map((e: CleanEvent) => Date.parse(e.at));
    session = {
      startedAt: new Date(Math.min(...times)).toISOString(),
      endedAt: new Date(Math.max(...times) + 60_000).toISOString(),
      pauses: [],
    };
  }
  const sessions = session && added ? [...data.sessions, session] : data.sessions;
  return { patch: { events, sessions }, added, rejected };
}

/**
 * Today's and past days' totals from every finished session on this device, for the counted
 * categories, inside the server's retention and never after today. Batches of ≤ 31 days.
 */
export function totalsBatches(
  data: LocalData,
  rules: readonly Rule[],
  settings: Pick<W.Settings, 'categories' | 'retentionDays'>,
  today: string,
  now = new Date(),
): W.TotalRow[][] {
  const slices = data.sessions.flatMap((s) => attribute(s, data.events, rules, { now }));
  const rows = dailyTotals(slices, {
    categories: settings.categories,
    minDate: addDays(today, -settings.retentionDays),
    maxDate: today,
  });
  const dates = [...new Set(rows.map((r) => r.date))];
  const batches: W.TotalRow[][] = [];
  for (let i = 0; i < dates.length; i += 31) {
    const chunk = new Set(dates.slice(i, i + 31));
    batches.push(
      rows
        .filter((r) => chunk.has(r.date))
        .map(({ date, category, minutes }) => ({ date, category, minutes })),
    );
  }
  return batches;
}
