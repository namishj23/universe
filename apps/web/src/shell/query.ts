import { QueryClient } from '@tanstack/react-query';
import { ApiRequestError } from '../platform/api';

/** Network failures (fetch throws TypeError) and 5xx are worth retrying; 4xx never are. */
export const isRetryable = (error: unknown) =>
  error instanceof TypeError || (error instanceof ApiRequestError && error.status >= 500);

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failures, error) => failures < 2 && isRetryable(error),
        // Live data arrives over SSE; refetching on every focus would only add load.
        refetchOnWindowFocus: false,
        staleTime: 30_000,
      },
      mutations: { retry: false },
    },
  });
}
