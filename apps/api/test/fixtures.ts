import { Router } from 'express';
import type { ModuleDefinition } from '../src/platform/modules/index.js';

const pingRouter = () => {
  const router = Router();
  router.get('/ping', (_req, res) => {
    res.json({ ok: true });
  });
  return router;
};

/**
 * Stand-ins for modules whose folders do not exist yet (observatory and exam belong to
 * Person 2), with the roles from the agreed table.
 */
export const fixtureModules = (): ModuleDefinition[] => [
  { id: 'observatory', label: 'Observatory', order: 40, roles: ['admin'], router: pingRouter() },
  {
    id: 'exam',
    label: 'Exam Monitoring',
    order: 50,
    roles: ['invigilator', 'admin'],
    router: pingRouter(),
  },
];
