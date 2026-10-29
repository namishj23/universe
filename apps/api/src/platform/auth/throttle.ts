import { createHmac } from 'node:crypto';
import { env } from '../../config/env.js';
import { prisma, type Db } from '../db.js';

const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60_000;
const KEEP_MS = 24 * 3_600_000;
const key = Buffer.from(env.EMAIL_HMAC_SECRET, 'base64');

/** HMAC-SHA256 of the lowercased email, hex. Keys login_throttle and failed-login audit entries. */
export const emailHmac = (email: string) =>
  createHmac('sha256', key).update(email.toLowerCase()).digest('hex');

/**
 * Reserves one attempt before the password is checked, so a burst of parallel requests cannot
 * all be verified: the row is locked while the count is read and raised. Returns false when the
 * key is locked; the attempt after the fifth reserved one also locks it.
 */
export function reserveAttempt(keyHash: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    // ON CONFLICT, not Prisma's upsert: parallel first attempts would race on the insert.
    await tx.$executeRaw`
      INSERT INTO login_throttle (key_hash) VALUES (${keyHash}) ON CONFLICT (key_hash) DO NOTHING`;
    const [row] = await tx.$queryRaw<{ failed_count: number; locked_until: Date | null }[]>`
      SELECT failed_count, locked_until FROM login_throttle WHERE key_hash = ${keyHash} FOR UPDATE`;
    if (row?.locked_until && row.locked_until.getTime() > Date.now()) return false;
    if ((row?.failed_count ?? 0) >= MAX_FAILURES) {
      await lock(tx, keyHash);
      return false;
    }
    await tx.loginThrottle.update({
      where: { keyHash },
      data: { failedCount: { increment: 1 } },
    });
    return true;
  });
}

const lock = (tx: Db, keyHash: string) =>
  tx.loginThrottle.update({
    where: { keyHash },
    data: { failedCount: 0, lockedUntil: new Date(Date.now() + LOCK_MS) },
  });

/** A reserved attempt failed: the fifth failure locks the key for 15 minutes and resets the count. */
export async function recordFailure(tx: Db, keyHash: string): Promise<void> {
  await tx.loginThrottle.updateMany({
    where: { keyHash, failedCount: { gte: MAX_FAILURES } },
    data: { failedCount: 0, lockedUntil: new Date(Date.now() + LOCK_MS) },
  });
}

export const clearFailures = (tx: Db, keyHash: string) =>
  tx.loginThrottle.deleteMany({ where: { keyHash } });

/** Rows untouched for 24 hours hold no live lock (locks last 15 minutes). */
export async function purgeStaleThrottle(): Promise<number> {
  const { count } = await prisma.loginThrottle.deleteMany({
    where: { updatedAt: { lt: new Date(Date.now() - KEEP_MS) } },
  });
  return count;
}
