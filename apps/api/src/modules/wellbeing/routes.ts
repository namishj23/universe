// Every wellbeing route in one table: the router and the OpenAPI paths are built from it.
// Paths are relative to /api/wellbeing. The platform admits only students and mentors; every
// route works on the caller's own data (ids never appear in a URL), so there is nothing of
// anyone else's to reach. Responses are `no-store`, and errors are stripped of values before
// the platform logs them.
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { ZodOpenApiOperationObject, ZodOpenApiPathsObject } from 'zod-openapi';
import { istDate, wellbeing as wb } from '@universe/contracts';
import type { Platform } from '../../platform/modules/index.js';
import type { WellbeingService } from './service.js';

interface Route {
  method: 'get' | 'post' | 'put' | 'delete';
  path: string;
  summary: string;
  params?: z.ZodObject;
  query?: z.ZodObject;
  body?: z.ZodType;
  response?: z.ZodType;
  status?: 200 | 204;
  errors?: number[];
  /** Served as a file download with this name. */
  download?: (now: Date) => string;
  handler: (req: Request, now: Date) => Promise<unknown>;
}

const ERROR_TEXT: Record<number, string> = {
  400: 'Validation failed (unknown fields are rejected)',
  401: 'Not signed in',
  403: 'Not a student or mentor (admins, drivers and invigilators never see wellbeing data), or CSRF',
  404: 'No such stored total',
  409: 'TRACKING_PAUSED: tracking is paused or off, nothing is stored',
  422: 'CATEGORY_NOT_COUNTED, FUTURE_DATE, OUTSIDE_RETENTION or DAY_OVER_LIMIT (1440 minutes)',
};

/** Keeps only what is safe to log: our own errors pass, anything else loses its message. */
function scrub(err: unknown, p: Platform): unknown {
  if (err instanceof p.http.ApiError || err instanceof z.ZodError) return err;
  const code = (err as { code?: unknown } | null)?.code;
  const name = err instanceof Error ? err.name : 'Error';
  return new Error(
    `wellbeing request failed: ${name}${typeof code === 'string' ? ` ${code}` : ''}`,
  );
}

export function routes(p: Platform, s: WellbeingService) {
  const me = (req: Request) => p.authOf(req).user.id;

  const table: Route[] = [
    {
      method: 'get',
      path: '/settings',
      summary: 'My wellbeing settings (created with tracking off on first use)',
      response: wb.Settings,
      handler: (req) => s.getSettings(me(req)),
    },
    {
      method: 'put',
      path: '/settings',
      summary:
        'Change counted categories, retention (7–365 days) or Student Hub sharing. A category turned off keeps its stored rows',
      body: wb.UpdateSettingsRequest,
      response: wb.Settings,
      handler: (req) => s.updateSettings(me(req), wb.UpdateSettingsRequest.parse(req.body)),
    },
    {
      method: 'post',
      path: '/tracking',
      summary: 'Turn tracking on, pause it or turn it off (never deletes data)',
      body: wb.TrackingRequest,
      response: wb.Settings,
      handler: (req, now) => s.setTracking(me(req), wb.TrackingRequest.parse(req.body).state, now),
    },
    {
      method: 'put',
      path: '/totals',
      summary:
        'Upload daily category totals computed in the browser (upsert; up to 31 days × 5 categories). The only way data reaches the server',
      body: wb.UploadTotalsRequest,
      response: wb.UploadTotalsResponse,
      errors: [409, 422],
      handler: (req, now) =>
        s.uploadTotals(me(req), wb.UploadTotalsRequest.parse(req.body).rows, now),
    },
    {
      method: 'get',
      path: '/summary',
      summary:
        "Today's totals by category, the last days' series, the comparison with the average, record count and tracking state",
      query: wb.SummaryQuery,
      response: wb.Summary,
      handler: (req, now) => s.summary(me(req), wb.SummaryQuery.parse(req.query).days, now),
    },
    {
      method: 'get',
      path: '/records',
      summary: 'See my data: exactly the stored rows (newest day first) and their total count',
      query: wb.RecordsQuery,
      response: wb.RecordsPage,
      handler: (req) => s.records(me(req), wb.RecordsQuery.parse(req.query)),
    },
    {
      method: 'delete',
      path: '/records/:date/:category',
      summary: 'Delete one stored total',
      params: wb.RecordParams,
      status: 204,
      errors: [404],
      handler: async (req) => {
        const { date, category } = wb.RecordParams.parse(req.params);
        await s.deleteRecord(me(req), date, category);
      },
    },
    {
      method: 'delete',
      path: '/records',
      summary: 'Delete the stored totals of a date range (inclusive)',
      query: wb.RangeQuery,
      response: wb.Deleted,
      handler: (req) => {
        const { from, to } = wb.RangeQuery.parse(req.query);
        return s.deleteRange(me(req), from, to);
      },
    },
    {
      method: 'get',
      path: '/export',
      summary: 'Download my settings and every stored row as wellbeing-export-YYYY-MM-DD.json',
      response: wb.ExportDocument,
      download: (now) => `wellbeing-export-${istDate(now)}.json`,
      handler: (req, now) => s.exportAll(me(req), now),
    },
    {
      method: 'delete',
      path: '/data',
      summary:
        'Delete everything stored for me and turn tracking off; settings stay. Needs { "confirm": "DELETE" }',
      body: wb.DeleteDataRequest,
      response: wb.Deleted,
      handler: (req) => {
        wb.DeleteDataRequest.parse(req.body);
        return s.deleteAll(me(req));
      },
    },
  ];

  const router = Router();
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  for (const r of table) {
    router[r.method](
      r.path,
      p.http.asyncHandler(async (req: Request, res: Response) => {
        try {
          if (!r.query) wb.NoQuery.parse(req.query);
          if (!r.body && r.method !== 'get') wb.NoQuery.parse(req.body ?? {});
          const now = new Date();
          const body = await r.handler(req, now);
          if (r.download) res.attachment(r.download(now));
          if (r.status === 204) res.status(204).end();
          else res.json(body);
        } catch (err) {
          throw scrub(err, p);
        }
      }),
    );
  }

  const error = (code: number) => ({
    description: ERROR_TEXT[code] ?? 'Error',
    content: { 'application/json': { schema: p.contracts.ApiErrorBody } },
  });
  const openapi: ZodOpenApiPathsObject = {};
  for (const r of table) {
    const key = r.path.replace(/:(\w+)/g, '{$1}');
    openapi[key] ??= {};
    const op: ZodOpenApiOperationObject = {
      tags: ['wellbeing'],
      summary: r.summary,
      description:
        'Who may call: students and mentors, for their own data only. Responses are Cache-Control: no-store.',
      security: r.method === 'get' ? [{ session: [] }] : [{ session: [], csrf: [] }],
      responses: {
        [String(r.status ?? 200)]:
          r.status === 204
            ? { description: 'No content' }
            : {
                description: r.download ? 'OK (attachment)' : 'OK',
                content: { 'application/json': { schema: r.response ?? z.unknown() } },
              },
        ...Object.fromEntries(
          [400, 401, 403, ...(r.errors ?? [])].map((c) => [String(c), error(c)]),
        ),
      },
    };
    if (r.params || r.query)
      op.requestParams = {
        ...(r.params && { path: r.params }),
        ...(r.query && { query: r.query }),
      };
    if (r.body) op.requestBody = { content: { 'application/json': { schema: r.body } } };
    openapi[key][r.method] = op;
  }
  return { router, openapi };
}
