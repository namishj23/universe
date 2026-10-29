import { z } from 'zod';

/** Keyset cursor over (createdAt, id): base64url of `ISO|uuid`. Opaque to clients. */
const Cursor = z.tuple([z.iso.datetime(), z.uuid()]);

export const encodeCursor = (row: { createdAt: Date | string; id: string }) =>
  Buffer.from(
    `${typeof row.createdAt === 'string' ? row.createdAt : row.createdAt.toISOString()}|${row.id}`,
  ).toString('base64url');

export function decodeCursor(cursor: string) {
  const [createdAt, id] = Cursor.parse(Buffer.from(cursor, 'base64url').toString().split('|'));
  return { createdAt: new Date(createdAt), id };
}

export const newestFirst = [{ createdAt: 'desc' }, { id: 'desc' }] as const;

/**
 * `WHERE` for the page after `cursor`, newest first. The redundant `lte` bound lets PostgreSQL
 * seek a `(…, created_at DESC, id DESC)` index instead of filtering from the newest row.
 */
export function olderThan(cursor: string | undefined) {
  if (!cursor) return {};
  const after = decodeCursor(cursor);
  return {
    createdAt: { lte: after.createdAt },
    OR: [
      { createdAt: { lt: after.createdAt } },
      { createdAt: after.createdAt, id: { lt: after.id } },
    ],
  };
}

/** Splits `limit + 1` rows into a page and its next cursor. */
export function toPage<R extends { createdAt: Date; id: string }, T>(
  rows: R[],
  limit: number,
  map: (row: R) => T,
) {
  const last = rows.length > limit ? rows[limit - 1] : undefined;
  return { items: rows.slice(0, limit).map(map), nextCursor: last ? encodeCursor(last) : null };
}
