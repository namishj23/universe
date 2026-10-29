import { z } from 'zod';
import {
  createDocument,
  type ZodOpenApiOperationObject,
  type ZodOpenApiPathsObject,
  type ZodOpenApiResponsesObject,
} from 'zod-openapi';
import {
  ActivityEvent,
  AdminUser,
  AdminUserQuery,
  AnnouncementRequest,
  AnnouncementResponse,
  ApiErrorBody,
  AuditEntry,
  AuditQuery,
  ChangePasswordRequest,
  CreateUserRequest,
  CreateUserResponse,
  DashboardResponse,
  FileRecord,
  LoginRequest,
  ModuleInfo,
  PageQuery,
  pageOf,
  ResetPasswordResponse,
  SessionResponse,
  UnreadCount,
  UpdateUserRequest,
} from '@universe/contracts';
import { basePath, type ModuleDefinition } from './modules/index.js';

const STATUS_TEXT: Record<number, string> = {
  400: 'Validation failed or bad input',
  401: 'Not signed in',
  403: 'Forbidden (role, CSRF, or PASSWORD_CHANGE_REQUIRED)',
  404: 'Not found (also returned for resources the user may not see)',
  409: 'Conflict',
  413: 'Too large or quota exceeded',
  415: 'Unsupported media type',
  416: 'Range not satisfiable',
  429: 'Too many requests',
  503: 'Not ready',
};

const json = (schema: z.ZodType, description = 'OK') => ({
  description,
  content: { 'application/json': { schema } },
});

const errors = (...codes: number[]): ZodOpenApiResponsesObject =>
  Object.fromEntries(codes.map((c) => [String(c), json(ApiErrorBody, STATUS_TEXT[c] ?? 'Error')]));

const noContent = { '204': { description: 'No content' } };
const IdPath = z.object({ id: z.uuid() });
const session = [{ session: [] }];
const sessionAndCsrf = [{ session: [], csrf: [] }];

/** Signed-in GET. */
const read = (op: ZodOpenApiOperationObject, ...codes: number[]): ZodOpenApiOperationObject => ({
  security: session,
  ...op,
  responses: { ...op.responses, ...errors(400, 401, 403, ...codes) },
});
/** Signed-in POST/PATCH/DELETE: also needs the CSRF header. */
const write = (op: ZodOpenApiOperationObject, ...codes: number[]): ZodOpenApiOperationObject => ({
  security: sessionAndCsrf,
  ...op,
  responses: { ...op.responses, ...errors(400, 401, 403, ...codes) },
});

const platformPaths: ZodOpenApiPathsObject = {
  '/api/health/live': {
    get: {
      tags: ['health'],
      summary: 'Liveness',
      security: [],
      responses: { '200': json(z.object({ status: z.literal('ok') })) },
    },
  },
  '/api/health/ready': {
    get: {
      tags: ['health'],
      summary: 'Readiness: database reachable and file storage writable',
      security: [],
      responses: { '200': json(z.object({ status: z.literal('ok') })), ...errors(503) },
    },
  },

  '/api/auth/login': {
    post: {
      tags: ['auth'],
      summary: 'Sign in. Sets the httpOnly session cookie; returns the CSRF token.',
      description:
        'Exempt from the CSRF token (there is no session yet) but requires application/json and an allowed Origin. Five failures for one email lock it for 15 minutes, whether or not the account exists.',
      security: [],
      requestBody: { content: { 'application/json': { schema: LoginRequest } } },
      responses: { '200': json(SessionResponse), ...errors(400, 401, 403, 415, 429) },
    },
  },
  '/api/auth/logout': {
    post: write({ tags: ['auth'], summary: 'Sign out', responses: noContent }),
  },
  '/api/auth/me': {
    get: read({
      tags: ['auth'],
      summary: 'Current user and CSRF token',
      responses: { '200': json(SessionResponse) },
    }),
  },
  '/api/auth/change-password': {
    post: write(
      {
        tags: ['auth'],
        summary: 'Change your own password',
        description:
          'New password: 12–256 characters, different from the current one, not containing the email local part. Signs out every other session.',
        requestBody: { content: { 'application/json': { schema: ChangePasswordRequest } } },
        responses: noContent,
      },
      429,
    ),
  },

  '/api/modules': {
    get: read({
      tags: ['platform'],
      summary: 'Modules the signed-in role may use, in navigation order',
      responses: { '200': json(z.array(ModuleInfo)) },
    }),
  },
  '/api/dashboard': {
    get: read({
      tags: ['platform'],
      summary: 'User, unread count, latest 5 events and every visible module summary',
      description:
        "Each module entry is `ok` (with `data` matching that module's summary schema), `error` or `timeout` (1.5 s). One module failing never fails the response.",
      responses: { '200': json(DashboardResponse) },
    }),
  },

  '/api/activity': {
    get: read({
      tags: ['activity'],
      summary: 'Activity feed, newest first (cursor paged)',
      requestParams: { query: PageQuery },
      responses: { '200': json(pageOf(ActivityEvent)) },
    }),
  },
  '/api/activity/unread-count': {
    get: read({
      tags: ['activity'],
      summary: 'Unread count',
      responses: { '200': json(UnreadCount) },
    }),
  },
  '/api/activity/read-all': {
    post: write({ tags: ['activity'], summary: 'Mark every event read', responses: noContent }),
  },
  '/api/activity/{id}/read': {
    post: write(
      {
        tags: ['activity'],
        summary: 'Mark one event read',
        requestParams: { path: IdPath },
        responses: noContent,
      },
      404,
    ),
  },
  '/api/activity/announcements': {
    post: write({
      tags: ['activity'],
      summary: 'Send an announcement (admin)',
      requestBody: { content: { 'application/json': { schema: AnnouncementRequest } } },
      responses: { '200': json(AnnouncementResponse) },
    }),
  },
  '/api/activity/stream': {
    get: read({
      tags: ['activity'],
      summary: 'Live feed (Server-Sent Events)',
      description:
        'Named events: `activity` (an ActivityEvent) and `unread-count` (`{ count }`). Send `Last-Event-ID` to replay up to 100 missed events.',
      responses: {
        '200': {
          description: 'text/event-stream',
          content: { 'text/event-stream': { schema: z.string() } },
        },
      },
    }),
  },

  '/api/admin/users': {
    get: read({
      tags: ['admin'],
      summary: 'List users (admin): search by name or email, filter by role and active',
      requestParams: { query: AdminUserQuery },
      responses: { '200': json(pageOf(AdminUser)) },
    }),
    post: write(
      {
        tags: ['admin'],
        summary: 'Create a user with a temporary password (shown once)',
        requestBody: { content: { 'application/json': { schema: CreateUserRequest } } },
        responses: { '201': json(CreateUserResponse, 'Created') },
      },
      409,
    ),
  },
  '/api/admin/users/{id}': {
    patch: write(
      {
        tags: ['admin'],
        summary: 'Change role and/or active status',
        description:
          'Admins cannot demote or deactivate themselves; the last active admin can never be removed (409). Deactivating signs the user out everywhere.',
        requestParams: { path: IdPath },
        requestBody: { content: { 'application/json': { schema: UpdateUserRequest } } },
        responses: { '200': json(AdminUser) },
      },
      404,
      409,
    ),
  },
  '/api/admin/users/{id}/reset-password': {
    post: write(
      {
        tags: ['admin'],
        summary: 'Reset a password to a new temporary one (shown once); signs the user out',
        requestParams: { path: IdPath },
        responses: { '200': json(ResetPasswordResponse) },
      },
      404,
      409,
    ),
  },
  '/api/admin/audit': {
    get: read({
      tags: ['admin'],
      summary: 'Audit log, newest first (admin)',
      requestParams: { query: AuditQuery },
      responses: { '200': json(pageOf(AuditEntry)) },
    }),
  },

  '/api/files/{purpose}': {
    post: write(
      {
        tags: ['files'],
        summary: 'Upload one file for a registered purpose (e.g. hub.resource)',
        description:
          'multipart/form-data with exactly one file part and no other fields. The type is detected from the bytes and checked against the purpose; size and per-user quota are enforced while streaming.',
        requestParams: { path: z.object({ purpose: z.string() }) },
        requestBody: {
          content: { 'multipart/form-data': { schema: z.object({ file: z.file() }) } },
        },
        responses: { '201': json(FileRecord, 'Created') },
      },
      404,
      413,
      415,
      429,
    ),
  },
  '/api/files/{id}': {
    get: read(
      {
        tags: ['files'],
        summary: 'Download a file (supports Range requests)',
        requestParams: { path: IdPath },
        responses: {
          '200': {
            description: 'The file',
            content: { 'application/octet-stream': { schema: z.file() } },
          },
          '206': {
            description: 'Partial content',
            content: { 'application/octet-stream': { schema: z.file() } },
          },
        },
      },
      404,
      416,
    ),
    delete: write(
      {
        tags: ['files'],
        summary: 'Delete a file (owner or admin)',
        requestParams: { path: IdPath },
        responses: noContent,
      },
      404,
    ),
  },
};

/** The OpenAPI 3.1 document for the platform and every loaded module. */
export function buildOpenApiDocument(modules: readonly ModuleDefinition[]) {
  const modulePaths: ZodOpenApiPathsObject = {};
  for (const m of modules)
    for (const [path, item] of Object.entries(m.openapi ?? {}))
      modulePaths[`${basePath(m)}${path}`] = item;
  return createDocument({
    openapi: '3.1.0',
    info: {
      title: 'UniVerse API',
      version: '0.2.0',
      description:
        'Every error is `{ error: { code, message, requestId } }`. Unsafe methods need the `X-CSRF-Token` header from /api/auth/login or /api/auth/me.',
    },
    components: {
      securitySchemes: {
        session: { type: 'apiKey', in: 'cookie', name: 'uv_session' },
        csrf: { type: 'apiKey', in: 'header', name: 'X-CSRF-Token' },
      },
    },
    paths: { ...platformPaths, ...modulePaths },
  });
}
