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

export async function isLocked(keyHash: string): Promise<boolean> {
  const row = await prisma.loginThrottle.findUnique({
    where: { keyHash },
    select: { lockedUntil: true },
  });
  return !!row?.lockedUntil && row.lockedUntil.getTime() > Date.now();
}

/** Counts a failure (atomic upsert); the fifth locks the key for 15 minutes and resets the count. */
export async function recordFailure(tx: Db, keyHash: string): Promise<void> {
  const { failedCount } = await tx.loginThrottle.upsert({
    where: { keyHash },
    create: { keyHash, failedCount: 1 },
    update: { failedCount: { increment: 1 } },
    select: { failedCount: true },
  });
  if (failedCount >= MAX_FAILURES)
    await tx.loginThrottle.update({
      where: { keyHash },
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
