import {
  sanitiseEvents,
  validateRules,
  type CleanEvent,
  type FocusSession,
  type Rule,
} from '@universe/wellbeing-core';

/**
 * This device's wellbeing store: sanitised events, focus sessions, the running session and the
 * rules. One IndexedDB database per user (`uv-wellbeing-<userId>`), one key-value object store.
 * Never localStorage, never the server. If IndexedDB is missing, blocked or failing, the data
 * lives in memory for this tab instead and `mode` says so (the screen shows a one-line notice).
 */
export interface LocalData {
  events: CleanEvent[];
  sessions: FocusSession[];
  current: FocusSession | null;
  rules: Rule[] | null;
}
export const EMPTY: LocalData = { events: [], sessions: [], current: null, rules: null };

export interface LocalStore {
  mode: 'device' | 'memory';
  load: () => Promise<LocalData>;
  /** Writes the given keys in one transaction. */
  save: (patch: Partial<LocalData>) => Promise<void>;
  clear: () => Promise<void>;
}

const STORE = 'kv';
const isTime = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));

/** A stored or imported focus session; `ended` requires a stop time and closed pauses. */
export function isSession(v: unknown, ended: boolean): v is FocusSession {
  if (typeof v !== 'object' || v === null) return false;
  const { startedAt, endedAt, pauses } = v as Record<string, unknown>;
  return (
    isTime(startedAt) &&
    (ended ? isTime(endedAt) : endedAt === undefined) &&
    Array.isArray(pauses) &&
    pauses.every((p: unknown) => {
      if (typeof p !== 'object' || p === null) return false;
      const { from, to } = p as Record<string, unknown>;
      return isTime(from) && (isTime(to) || (!ended && to === undefined));
    })
  );
}
const done = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });

function openDb(name: string) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
}

export function memoryStore(): LocalStore {
  let data: LocalData = { ...EMPTY };
  return {
    mode: 'memory',
    load: () => Promise.resolve({ ...data }),
    save: (patch) => {
      data = { ...data, ...patch };
      return Promise.resolve();
    },
    clear: () => {
      data = { ...EMPTY };
      return Promise.resolve();
    },
  };
}

/** Opens the user's store, or falls back to memory (never throws). */
export async function openLocalStore(userId: string): Promise<LocalStore> {
  if (typeof indexedDB === 'undefined') return memoryStore();
  let db: IDBDatabase;
  try {
    db = await openDb(`uv-wellbeing-${userId}`);
  } catch {
    return memoryStore();
  }
  const tx = (mode: IDBTransactionMode) => db.transaction(STORE, mode).objectStore(STORE);
  const store: LocalStore = {
    mode: 'device',
    load: async () => {
      const get = (k: keyof LocalData) => done<unknown>(tx('readonly').get(k));
      const [events, sessions, current, rules] = await Promise.all([
        get('events'),
        get('sessions'),
        get('current'),
        get('rules'),
      ]);
      // Re-checked on load: what reaches the screen is always clean, whatever is on disk.
      const valid = Array.isArray(rules) ? validateRules(rules) : null;
      return {
        events: Array.isArray(events) ? sanitiseEvents(events).events : [],
        sessions: Array.isArray(sessions)
          ? sessions.filter((x: unknown) => isSession(x, true))
          : [],
        current: isSession(current, false) ? current : null,
        rules: valid?.ok ? valid.rules : null,
      };
    },
    save: (patch) =>
      new Promise<void>((resolve, reject) => {
        const t = db.transaction(STORE, 'readwrite');
        for (const [key, value] of Object.entries(patch)) t.objectStore(STORE).put(value, key);
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error ?? new Error('IndexedDB write failed'));
        t.onabort = () => reject(t.error ?? new Error('IndexedDB write aborted'));
      }),
    clear: async () => {
      await done(tx('readwrite').clear());
    },
  };
  try {
    await store.load();
    return store;
  } catch {
    db.close();
    return memoryStore();
  }
}
