import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import type { Prisma } from '../generated/prisma/client.js';
import { env } from '../config/env.js';

export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
  // Tests count queries to prove list endpoints make no N+1 calls; nothing else listens.
  log: env.NODE_ENV === 'test' ? [{ emit: 'event', level: 'query' }] : [],
});

/** The root client or an interactive-transaction client. */
export type Db = PrismaClient | Prisma.TransactionClient;
