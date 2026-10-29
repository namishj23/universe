import { Router } from 'express';
import { prisma } from './db.js';
import { ApiError, asyncHandler } from './http.js';

export const healthRoutes = Router();

healthRoutes.get('/live', (_req, res) => {
  res.json({ status: 'ok' });
});

healthRoutes.get(
  '/ready',
  asyncHandler(async (_req, res) => {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), 2_000);
    });
    try {
      await Promise.race([prisma.$queryRaw`SELECT 1`, timeout]);
    } catch {
      throw new ApiError(503, 'NOT_READY', 'Database is not reachable');
    } finally {
      clearTimeout(timer);
    }
    res.json({ status: 'ok' });
  }),
);
