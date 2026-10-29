import { z } from 'zod';
import { Role } from './role.js';

/**
 * Who a cross-module call is made for: the signed-in user of the request being served. The
 * module answering decides what this actor may see (`platform.modules.get(id)`).
 */
export const Actor = z.object({ id: z.uuid(), role: Role }).strip();
export type Actor = z.infer<typeof Actor>;
