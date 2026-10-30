import type { wellbeing as W } from '@universe/contracts';
import { ApiRequestError } from '../../platform/api';

export const LABEL: Record<W.Category, string> = {
  study: 'Study',
  communication: 'Communication',
  social: 'Social',
  entertainment: 'Entertainment',
  other: 'Other',
};

/** `3h 32m` */
export const fmtMin = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;

/** The server's meaning (a 409 says why), or the network line. */
export const message = (err: unknown) =>
  err instanceof ApiRequestError ? err.message : "Couldn't reach UniVerse. Try again.";
