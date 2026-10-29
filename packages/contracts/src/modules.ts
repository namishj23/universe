import { z } from 'zod';

/** Every module that can mount an API. Each one lives in `apps/api/src/modules/<id>/`. */
export const ModuleId = z.enum(['hub', 'rides', 'wellbeing', 'observatory', 'exam']);
export type ModuleId = z.infer<typeof ModuleId>;

/** One entry of `GET /api/modules`: what the UI's navigation shows for the signed-in role. */
export const ModuleInfo = z
  .object({ id: ModuleId, label: z.string(), order: z.number().int(), basePath: z.string() })
  .meta({ id: 'ModuleInfo' });
export type ModuleInfo = z.infer<typeof ModuleInfo>;
