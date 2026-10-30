import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import type { Prisma } from '../generated/prisma/client.js';
import { env } from '../config/env.js';

export const prisma = new PrismaClient({
  // Every connection's session is UTC. The pg adapter sends a Date as a wall-clock time with no
  // offset, so under any other session time zone (Homebrew's default is the Mac's, IST) every
  // timestamp was stored shifted and SQL-side time maths was wrong (P7-001).
  adapter: new PrismaPg({ connectionString: env.DATABASE_URL, options: '-c TimeZone=UTC' }),
  // Tests count queries to prove list endpoints make no N+1 calls; nothing else listens.
  log: env.NODE_ENV === 'test' ? [{ emit: 'event', level: 'query' }] : [],
});

/** The root client or an interactive-transaction client. */
export type Db = PrismaClient | Prisma.TransactionClient;
