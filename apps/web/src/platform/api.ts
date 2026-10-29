import { ApiErrorBody } from '@universe/contracts';
import type { z } from 'zod';

// Held in memory only: never in localStorage.
let csrfToken: string | null = null;
let onUnauthorized: () => void = () => undefined;

export const setCsrfToken = (token: string | null) => {
  csrfToken = token;
};
export const setUnauthorizedHandler = (handler: () => void) => {
  onUnauthorized = handler;
};

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
  }
}

interface Options {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

/** fetch with the session cookie, the CSRF header on unsafe methods, and ApiErrorBody parsing. */
export async function request(
  path: string,
  { method = 'GET', body, signal, headers: extra }: Options = {},
) {
  const headers: Record<string, string> = { ...extra };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;

  const res = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    ...(body !== undefined && { body: JSON.stringify(body) }),
    ...(signal && { signal }),
  });
  if (res.ok) return res;

  const parsed = ApiErrorBody.safeParse(await res.json().catch(() => null));
  const error = parsed.success
    ? new ApiRequestError(
        res.status,
        parsed.data.error.code,
        parsed.data.error.message,
        parsed.data.error.requestId,
      )
    : new ApiRequestError(res.status, 'UNKNOWN', 'Something went wrong. Please try again.');
  if (res.status === 401 && path !== '/api/auth/login') onUnauthorized();
  throw error;
}

/** A text field from submitted form data. */
export const formText = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

/** Like `request`, then validates the JSON response against `schema`. */
export async function api<S extends z.ZodType>(path: string, schema: S, options?: Options) {
  const res = await request(path, options);
  return schema.parse(await res.json());
}
