import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { wellbeing as W } from '@universe/contracts';
import type { z } from 'zod';
import { api, request } from '../../platform/api';

/**
 * Every call Module D's screen makes. The server only ever receives settings, a tracking state,
 * `{ date, category, minutes }` rows or the typed delete confirmation: never a domain, URL,
 * rule or event (those stay in this browser, see `local.ts`). Responses are `no-store`, and the
 * queries keep nothing once the screen unmounts (`gcTime: 0`); sign-out clears the whole cache.
 */
export const KEY = ['wellbeing'] as const;
const fresh = { gcTime: 0, staleTime: 0 } as const;

export const summaryQuery = queryOptions({
  queryKey: [...KEY, 'summary'],
  queryFn: ({ signal }) => api('/api/wellbeing/summary?days=7', W.Summary, { signal }),
  ...fresh,
});

export const settingsQuery = queryOptions({
  queryKey: [...KEY, 'settings'],
  queryFn: ({ signal }) => api('/api/wellbeing/settings', W.Settings, { signal }),
  ...fresh,
});

export const recordsPage = (cursor: string | null, signal: AbortSignal) =>
  api(
    `/api/wellbeing/records?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    W.RecordsPage,
    { signal },
  );

export const setTracking = (state: W.TrackingState) =>
  api('/api/wellbeing/tracking', W.Settings, {
    method: 'POST',
    body: W.TrackingRequest.parse({ state }),
  });

export const updateSettings = (body: W.UpdateSettingsRequest) =>
  api('/api/wellbeing/settings', W.Settings, {
    method: 'PUT',
    body: W.UpdateSettingsRequest.parse(body),
  });

const Stored = W.UploadTotalsResponse;
/** One upload: at most 31 days. `parse` drops anything that is not a `{ date, category, minutes }` row. */
export const uploadTotals = (rows: W.TotalRow[]) =>
  api('/api/wellbeing/totals', Stored, {
    method: 'PUT',
    body: W.UploadTotalsRequest.parse({ rows }),
  });

export const deleteEverything = () =>
  api('/api/wellbeing/data', W.Deleted, {
    method: 'DELETE',
    body: W.DeleteDataRequest.parse({ confirm: 'DELETE' }),
  });

/** The export document, with the server's file name from Content-Disposition. */
export async function exportData() {
  const res = await request('/api/wellbeing/export');
  const name = /filename="?([^";]+)"?/.exec(res.headers.get('Content-Disposition') ?? '')?.[1];
  const doc: z.infer<typeof W.ExportDocument> = W.ExportDocument.parse(await res.json());
  return { doc, name: name ?? `wellbeing-export-${doc.generatedAt.slice(0, 10)}.json` };
}

export const refresh = (queryClient: QueryClient) =>
  queryClient.invalidateQueries({ queryKey: KEY });
