import { z } from 'zod';

// Wellbeing activity (Person 1). Fixed text only: never minutes, categories or dates.
export const WEEKLY_SUMMARY_TEXT = 'Your weekly summary is ready. Only you can see it.';

export const wellbeingActivity = {
  'wellbeing.weekly_summary': z.object({ message: z.literal(WEEKLY_SUMMARY_TEXT) }).strict(),
} as const;
