import { z } from 'zod';

// Student Hub admin actions (Person 1). Metadata holds no personal data.
export const hubAudit = {
  'hub.resource_deleted': z
    .object({
      subject: z.string().max(10),
      type: z.enum(['notes', 'question_paper', 'study_material', 'cheat_sheet']),
      ownResource: z.boolean(),
    })
    .strict(),
} as const;
