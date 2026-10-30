// Idempotency-Key support for one API instance: the first request with a key runs; a repeat
// from the same user within the TTL gets the same result (and waits for it if still running),
// so a double-click never counts twice. Failures forget the key so the client can retry.
// ponytail: in-process map; several API instances need a shared store (Redis or a table).

const KEY = /^[A-Za-z0-9_.:-]{1,100}$/;

export const validIdempotencyKey = (key: string) => KEY.test(key);

export function idempotencyStore(ttlMs: number, maxKeys: number, clock = () => Date.now()) {
  const entries = new Map<string, { expires: number; result: Promise<unknown> }>();

  // Insertion order = expiry order (one TTL), so expired entries are always at the front.
  const prune = (now: number) => {
    for (const [key, e] of entries) {
      if (e.expires > now && entries.size <= maxKeys) break;
      entries.delete(key);
    }
  };

  return {
    async run<T>(key: string, fn: () => Promise<T>): Promise<{ value: T; replayed: boolean }> {
      const now = clock();
      prune(now);
      const hit = entries.get(key);
      if (hit && hit.expires > now) return { value: (await hit.result) as T, replayed: true };
      const result = fn();
      entries.set(key, { expires: now + ttlMs, result });
      try {
        return { value: await result, replayed: false };
      } catch (err) {
        if (entries.get(key)?.result === result) entries.delete(key);
        throw err;
      }
    },
    size: () => entries.size,
  };
}
