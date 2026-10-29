// Every hub route in one table: the router and the OpenAPI paths are built from it, so a route
// can't exist undocumented. Paths are relative to /api/hub. The platform already admits only
// student, mentor and admin; `who` narrows that, and the services check ownership (404 for
// records that aren't yours). "mentor" routes also accept peer-mentor students (checked inside).
import { Router, type Request, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { ZodOpenApiOperationObject, ZodOpenApiPathsObject } from 'zod-openapi';
import { hub } from '@universe/contracts';
import type { Role } from '@universe/contracts';
import type { Platform } from '../../platform/modules/index.js';
import { config } from './config.js';
import type { dashboardService } from './dashboard.js';
import { idempotencyStore, validIdempotencyKey } from './idempotency.js';
import type { MentorService } from './mentors.js';
import type { PrepService } from './prep.js';
import type { profileService } from './profiles.js';
import type { requestService } from './requests.js';
import type { resourceService } from './resources.js';

export interface Services {
  profiles: ReturnType<typeof profileService>;
  prep: PrepService;
  mentors: MentorService;
  requests: ReturnType<typeof requestService>;
  resources: ReturnType<typeof resourceService>;
  dashboard: ReturnType<typeof dashboardService>;
}

type Who = 'any' | 'student' | 'mentor' | 'party' | 'admin';
const WHO: Record<Who, { roles: Role[]; text: string }> = {
  any: { roles: ['student', 'mentor', 'admin'], text: 'students, mentors and admins' },
  student: { roles: ['student'], text: 'students' },
  mentor: { roles: ['mentor', 'student'], text: 'mentors and peer-mentor students' },
  party: { roles: ['student', 'mentor'], text: 'the student or the mentor of the request' },
  admin: { roles: ['admin'], text: 'admins' },
};

interface Route {
  method: 'get' | 'post' | 'put' | 'delete';
  path: string;
  who: Who;
  summary: string;
  params?: z.ZodObject;
  query?: z.ZodObject;
  body?: z.ZodType;
  response?: z.ZodType;
  status?: 200 | 201 | 204;
  errors?: number[];
  headers?: z.ZodObject;
  use?: RequestHandler[];
  handler: (req: Request) => Promise<unknown>;
}

const ERROR_TEXT: Record<number, string> = {
  400: 'Validation failed or bad input',
  401: 'Not signed in',
  403: 'Wrong role (drivers and invigilators never reach the hub), CSRF, or not a mentor',
  404: 'Not found (also for records you are not a party to)',
  409: 'Conflict (state changed, slot taken, capacity, duplicate)',
  429: 'Too many requests',
};

export function routes(p: Platform, s: Services) {
  const user = (req: Request) => p.authOf(req).user;
  const noQuery = (req: Request) => hub.NoQuery.parse(req.query);

  const idempotency = idempotencyStore(config.idempotencyTtlMs, config.idempotencyMaxKeys);
  // ponytail: in-memory store, per process; several instances need a shared store (Redis).
  const searchLimiter = rateLimit({
    windowMs: 60_000,
    limit: config.searchPerMinute,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => p.authOf(req).user.id,
    handler: (_req, _res, next) =>
      next(
        new p.http.ApiError(429, 'TOO_MANY_SEARCHES', 'Too many searches. Try again in a minute.'),
      ),
  });

  const Id = hub.HubIdParam;
  const table: Route[] = [
    // ── Profile ─────────────────────────────────────────────────────────────────────────
    {
      method: 'get',
      path: '/me',
      who: 'any',
      summary: 'My hub profile with readiness (name and email come from the account)',
      response: hub.HubProfile,
      handler: async (req) => (noQuery(req), s.profiles.get(user(req))),
    },
    {
      method: 'put',
      path: '/me',
      who: 'any',
      summary: 'Update my profile (partial; name and email are read-only and rejected)',
      body: hub.UpdateProfileRequest,
      response: hub.HubProfile,
      handler: (req) => s.profiles.update(user(req), req.body),
    },
    {
      method: 'get',
      path: '/students/:id',
      who: 'any',
      summary:
        "A student's card: admins, or a mentor that student has sent a request to (404 otherwise)",
      params: Id,
      response: hub.StudentCard,
      errors: [404],
      handler: async (req) => (noQuery(req), s.profiles.student(user(req), req.params)),
    },

    // ── Prep ────────────────────────────────────────────────────────────────────────────
    {
      method: 'get',
      path: '/prep',
      who: 'student',
      summary:
        'Prep dashboard: tracked topics by track, catalogue, DSA totals, readiness, weekly goal and pace, 30-day series',
      response: hub.PrepView,
      handler: async (req) => (noQuery(req), s.prep.get(user(req).id)),
    },
    {
      method: 'put',
      path: '/prep/topics',
      who: 'student',
      summary:
        'Choose the topics I am preparing (new ones start at 0; removed ones keep their history)',
      body: hub.TrackTopicsRequest,
      response: hub.PrepView,
      handler: (req) => s.prep.trackTopics(user(req).id, req.body),
    },
    {
      method: 'put',
      path: '/prep/goal',
      who: 'student',
      summary: "Set this week's target (weeks run Sunday to Saturday, Asia/Kolkata)",
      body: hub.GoalRequest,
      response: hub.WeekGoal,
      handler: (req) => s.prep.setGoal(user(req).id, req.body),
    },
    {
      method: 'post',
      path: '/prep/:topicId/increment',
      who: 'student',
      summary:
        'Add (or correct, −5..5) solved problems on a tracked topic; an Idempotency-Key repeated within 10 minutes is ignored',
      params: hub.TopicParam,
      body: hub.IncrementRequest,
      response: hub.IncrementResponse,
      errors: [404, 409],
      headers: z.object({ 'idempotency-key': z.string().max(100).optional() }),
      handler: async (req) => {
        const run = () => s.prep.increment(user(req).id, req.params, req.body);
        const key = req.get('idempotency-key');
        if (key === undefined) return run();
        if (!validIdempotencyKey(key))
          throw new p.http.ApiError(
            400,
            'INVALID_IDEMPOTENCY_KEY',
            'Idempotency-Key must be 1–100 letters, digits or _.:-',
          );
        return (await idempotency.run(`${user(req).id}:increment:${key}`, run)).value;
      },
    },

    // ── Mentors ─────────────────────────────────────────────────────────────────────────
    {
      method: 'get',
      path: '/mentors',
      who: 'student',
      summary:
        'Mentors ranked for me: 0.6 × match + 0.2 × availability + 0.2 × (1 − load), with every component and a reason',
      query: hub.HubPageQuery,
      response: hub.MentorList,
      handler: (req) => s.mentors.list(user(req), req.query),
    },
    {
      method: 'get',
      path: '/mentors/:id',
      who: 'any',
      summary: "A mentor's public profile and open slots in the next 7 days",
      params: Id,
      response: hub.MentorProfile,
      errors: [404],
      handler: async (req) => (noQuery(req), s.mentors.profile(req.params)),
    },

    // ── Slots (mentors) ─────────────────────────────────────────────────────────────────
    {
      method: 'get',
      path: '/slots',
      who: 'mentor',
      summary: 'My slots that have not ended, soonest first, with who booked them',
      query: hub.SlotQuery,
      response: hub.pages.slots,
      handler: (req) => s.requests.mySlots(user(req), req.query),
    },
    {
      method: 'post',
      path: '/slots',
      who: 'mentor',
      summary: 'Add a slot (30–180 minutes, in the future; never overlapping my other live slots)',
      body: hub.CreateSlotRequest,
      response: hub.MySlot,
      status: 201,
      errors: [409],
      handler: (req) => s.requests.createSlot(user(req), req.body),
    },
    {
      method: 'delete',
      path: '/slots/:id',
      who: 'mentor',
      summary: 'Cancel an open slot (a booked one is cancelled through its request)',
      params: Id,
      status: 204,
      errors: [404, 409],
      handler: (req) => s.requests.deleteSlot(user(req), req.params),
    },

    // ── Mentorship requests ─────────────────────────────────────────────────────────────
    {
      method: 'post',
      path: '/requests',
      who: 'student',
      summary: 'Request a mentor (slot and note optional: one click)',
      body: hub.CreateMentorshipRequest,
      response: hub.MentorshipRequest,
      status: 201,
      errors: [404, 409],
      handler: (req) => s.requests.create(user(req), req.body),
    },
    {
      method: 'get',
      path: '/requests/mine',
      who: 'student',
      summary: 'My requests, newest first',
      query: hub.HubPageQuery,
      response: hub.pages.requests,
      handler: (req) => s.requests.mine(user(req), req.query),
    },
    {
      method: 'get',
      path: '/requests/incoming',
      who: 'mentor',
      summary:
        "Requests to me, newest first, with each student's name, year, branch, DSA % and note",
      query: hub.IncomingQuery,
      response: hub.pages.requests,
      handler: (req) => s.requests.incoming(user(req), req.query),
    },
    {
      method: 'get',
      path: '/requests/:id',
      who: 'any',
      summary: 'One request (its student, its mentor, or an admin; 404 for anyone else)',
      params: Id,
      response: hub.MentorshipRequest,
      errors: [404],
      handler: async (req) => (noQuery(req), s.requests.get(user(req), req.params)),
    },
    {
      method: 'post',
      path: '/requests/:id/accept',
      who: 'mentor',
      summary:
        'Accept: books slotId, else the requested slot, else my earliest open slot at least an hour away (409 NO_OPEN_SLOT)',
      params: Id,
      body: hub.AcceptRequest,
      response: hub.MentorshipRequest,
      errors: [404, 409],
      handler: (req) => s.requests.accept(user(req), req.params, req.body),
    },
    {
      method: 'post',
      path: '/requests/:id/decline',
      who: 'mentor',
      summary: 'Decline a pending request',
      params: Id,
      body: hub.NoBody,
      response: hub.MentorshipRequest,
      errors: [404, 409],
      handler: (req) => s.requests.decline(user(req), req.params, req.body),
    },
    {
      method: 'post',
      path: '/requests/:id/complete',
      who: 'mentor',
      summary: 'Mark an accepted session completed (after it has started)',
      params: Id,
      body: hub.NoBody,
      response: hub.MentorshipRequest,
      errors: [404, 409],
      handler: (req) => s.requests.complete(user(req), req.params, req.body),
    },
    {
      method: 'post',
      path: '/requests/:id/cancel',
      who: 'party',
      summary: 'Cancel a pending or accepted request (frees its slot; the other party is notified)',
      params: Id,
      body: hub.NoBody,
      response: hub.MentorshipRequest,
      errors: [404, 409],
      handler: (req) => s.requests.cancel(user(req), req.params, req.body),
    },

    // ── Resources ───────────────────────────────────────────────────────────────────────
    {
      method: 'get',
      path: '/subjects',
      who: 'any',
      summary: 'Subjects a resource can be filed under',
      response: z.array(hub.Subject),
      handler: async (req) => (noQuery(req), s.resources.subjects()),
    },
    {
      method: 'get',
      path: '/resources',
      who: 'any',
      summary:
        'Search resources (title, description and subject by word prefix; uploader by name); by relevance with q, else newest first. 60 per minute.',
      query: hub.ResourceQuery,
      response: hub.pages.resources,
      errors: [429],
      use: [searchLimiter],
      handler: (req) => s.resources.list(user(req), req.query),
    },
    {
      method: 'post',
      path: '/resources',
      who: 'any',
      summary: 'Attach a file I uploaded with POST /api/files/hub.resource as a resource',
      body: hub.CreateResourceRequest,
      response: hub.Resource,
      status: 201,
      errors: [404, 409],
      handler: (req) => s.resources.create(user(req), req.body),
    },
    {
      method: 'delete',
      path: '/resources/:id',
      who: 'any',
      summary: 'Delete a resource (uploader or admin; soft delete, audited for admins)',
      params: Id,
      status: 204,
      errors: [404],
      handler: (req) => s.resources.remove(user(req), req.params, req.id),
    },

    // ── Admin ───────────────────────────────────────────────────────────────────────────
    {
      method: 'get',
      path: '/admin/mentors',
      who: 'admin',
      summary:
        "Every mentor ranked against all students' weakest topics, with load, slots and recent requests",
      query: hub.HubPageQuery,
      response: hub.AdminMentorList,
      handler: (req) => s.mentors.adminList(req.query),
    },
    {
      method: 'get',
      path: '/admin/resources',
      who: 'admin',
      summary:
        'Resources including deleted ones (status=active|deleted|all), same search and filters',
      query: hub.AdminResourceQuery,
      response: hub.pages.resources,
      handler: (req) => s.resources.adminList(user(req), req.query),
    },
  ];

  const router = Router();
  for (const r of table) {
    router[r.method](
      r.path,
      p.requireRole(...WHO[r.who].roles),
      ...(r.use ?? []),
      p.http.asyncHandler(async (req, res) => {
        const body = await r.handler(req);
        if (r.status === 204) res.status(204).end();
        else res.status(r.status ?? 200).json(body);
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
    const ok =
      r.status === 204
        ? { description: 'No content' }
        : {
            description: 'OK',
            content: { 'application/json': { schema: r.response ?? z.unknown() } },
          };
    const op: ZodOpenApiOperationObject = {
      tags: ['hub'],
      summary: r.summary,
      description: `Who may call: ${WHO[r.who].text}.`,
      security: r.method === 'get' ? [{ session: [] }] : [{ session: [], csrf: [] }],
      responses: {
        [String(r.status ?? 200)]: ok,
        ...Object.fromEntries(
          [400, 401, 403, ...(r.errors ?? [])].map((c) => [String(c), error(c)]),
        ),
      },
    };
    if (r.params || r.query || r.headers)
      op.requestParams = {
        ...(r.params && { path: r.params }),
        ...(r.query && { query: r.query }),
        ...(r.headers && { header: r.headers }),
      };
    if (r.body) op.requestBody = { content: { 'application/json': { schema: r.body } } };
    openapi[key][r.method] = op;
  }
  return { router, table, openapi };
}
