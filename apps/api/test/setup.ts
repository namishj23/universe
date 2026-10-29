import { afterAll, beforeAll } from 'vitest';
import { prisma } from '../src/platform/db.js';

// Every test file starts from empty tables.
beforeAll(async () => {
  await prisma.$executeRaw`
    DO $$
    DECLARE tables text;
    BEGIN
      SELECT string_agg(format('%I', tablename), ', ') INTO tables
      FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations';
      IF tables IS NOT NULL THEN EXECUTE 'TRUNCATE ' || tables || ' CASCADE'; END IF;
    END $$`;
});

afterAll(async () => {
  await prisma.$disconnect();
});
