import { z } from 'zod';

export const FileRecord = z
  .object({
    id: z.uuid(),
    ownerId: z.uuid(),
    module: z.string(),
    purpose: z.string(),
    originalName: z.string(),
    mimeType: z.string(),
    sizeBytes: z.number().int().nonnegative(),
    sha256: z.string(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'FileRecord' });
export type FileRecord = z.infer<typeof FileRecord>;
