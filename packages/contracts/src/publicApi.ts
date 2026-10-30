import type { z } from 'zod';
import * as hub from './hub/public.js';
import type { ModuleId } from './modules.js';
import * as rides from './rides/public.js';
import * as wellbeing from './wellbeing/public.js';

// Owner: Person 1 (platform). Read-only functions modules expose to each other. A module's
// `publicApi` must implement exactly its entry here; the platform validates every call's input
// and output against these schemas (`platform.modules.get(id)`).

export interface PublicApiSpec {
  input: z.ZodType;
  output: z.ZodType;
}

export const publicApiRegistry = {
  rides: {
    findStop: { input: rides.FindStopInput, output: rides.FindStopOutput },
    searchStops: { input: rides.SearchStopsInput, output: rides.SearchStopsOutput },
    upcomingForUser: { input: rides.UpcomingInput, output: rides.UpcomingOutput },
  },
  hub: {
    sessionsForUser: { input: hub.SessionsInput, output: hub.SessionsOutput },
    weeklyGoal: { input: hub.WeeklyGoalInput, output: hub.WeeklyGoalOutput },
  },
  wellbeing: {
    studyMinutesThisWeek: {
      input: wellbeing.StudyMinutesInput,
      output: wellbeing.StudyMinutesOutput,
    },
  },
} as const satisfies Partial<Record<ModuleId, Record<string, PublicApiSpec>>>;

export type PublicApiId = keyof typeof publicApiRegistry;
export type PublicApiSpecs<M extends PublicApiId> = (typeof publicApiRegistry)[M];
type Specs<M extends PublicApiId> = PublicApiSpecs<M>;

/** What a caller gets from `platform.modules.get(id)`. */
export type PublicApi<M extends PublicApiId> = {
  readonly [F in keyof Specs<M>]: Specs<M>[F] extends PublicApiSpec
    ? (input: z.input<Specs<M>[F]['input']>) => Promise<z.output<Specs<M>[F]['output']>>
    : never;
};
