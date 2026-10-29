import { z } from 'zod';

export const Role = z.enum(['student', 'mentor', 'invigilator', 'admin']);
export type Role = z.infer<typeof Role>;
