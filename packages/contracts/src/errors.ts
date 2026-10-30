import { z } from 'zod';

export const ApiErrorBody = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      requestId: z.string(),
      details: z.unknown().optional(),
    }),
  })
  .meta({ id: 'ApiErrorBody' });
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;

/**
 * Error codes with a fixed meaning that clients may branch on (the `code` of ApiErrorBody).
 * Generic codes (VALIDATION_FAILED, NOT_FOUND, CONFLICT, FORBIDDEN, …) are not repeated here.
 */
export const ERROR_CODES = {
  MODULE_UNAVAILABLE: { status: 503, meaning: 'Another module or companion service is down or slow' },
  FILE_TOO_LARGE: { status: 413, meaning: 'Upload over the limit' },
  INVALID_RECIPIENT: { status: 422, meaning: 'Internal exam call names a user who is not an active reviewer' },
  INVALID_ACTOR: { status: 422, meaning: 'Internal exam audit actor is not an active reviewer' },
  NOT_BOARDED: { status: 409, meaning: 'Only a rider who boarded, after pickup, may rate the ride' },
  RIDE_CLOSED: { status: 409, meaning: 'The ride was cancelled, completed, started or reassigned' },
  TIME_WINDOW_MISMATCH: { status: 409, meaning: "The ride no longer fits the passenger's requested time" },
  GROUP_ACCESS: { status: 403, meaning: 'Women-only ride or group (the code requestSeat already used)' },
  DRIVER_SUSPENDED: { status: 409, meaning: 'The driver is suspended from rides' },
  SEAT_OVERLAP: { status: 409, meaning: 'The rider already holds a seat at an overlapping time' },
  IDEMPOTENCY_KEY_REUSED: { status: 422, meaning: 'The Idempotency-Key was used for a different request' },
  NOT_A_MENTOR: { status: 403, meaning: 'Mentor action by someone who no longer mentors' },
} as const satisfies Record<string, { status: number; meaning: string }>;
export type ErrorCode = keyof typeof ERROR_CODES;
