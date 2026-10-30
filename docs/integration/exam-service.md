# Exam service contract (v1). The platform and the exam service both implement exactly this.

Module E keeps its own stack, a Python/Django service in `services/exam/`, behind the platform. The browser only ever talks to the platform (`/api/...`, one origin, one sign-in). The platform forwards exam calls to the service over the local machine. The service never faces the browser or the network.

### 1. Deployment
- The service listens on **127.0.0.1 only**, default port 8000, with a production WSGI server (`waitress`), never `runserver` in the demo.
- Its database is **`universe_exam`** on the same PostgreSQL 18 server, owned by its own role `universe_exam`. That role has no rights on `universe`. Prisma never sees this database, so the platform's drift checks are unaffected.
- Platform env (both optional):
  - `EXAM_SERVICE_URL` (for example `http://127.0.0.1:8000`);
  - `SERVICE_TOKEN_EXAM` (≥ 32 random characters; the same value in the service's env).
  If either is unset, the exam module is **not installed**: it is absent from `/api/modules`, and its routes give 404.

### 2. Browser → platform → service (the gateway)
- `GET|POST|PATCH|DELETE /api/exam/<path>` is forwarded to `${EXAM_SERVICE_URL}/exam/<path>` with the query string unchanged.
- **The platform enforces, before forwarding:**
  - a valid session;
  - role `invigilator` or `admin` (everyone else gets 403);
  - CSRF and the Origin check on unsafe methods;
  - the forced-password-change gate;
  - the rate limit.
- **The body is streamed, not parsed.** It is aborted with 413 past 200 MB.
- **Headers the platform sends** (all others from the browser are dropped, including `Cookie`, `Authorization` and any client-sent `X-Service-Token` or `X-UniVerse-*`):
  - `X-Service-Token`;
  - `X-UniVerse-User-Id` (UUID);
  - `X-UniVerse-User-Role`;
  - `X-UniVerse-User-Name` (URL-encoded);
  - `X-Request-Id`;
  - `Content-Type`, `Content-Length`, `Range`, `Accept`, `If-None-Match`.
- **Response handling:**
  - the service's response is streamed back;
  - `Set-Cookie` from the service is dropped;
  - the platform adds its security headers, plus `X-Content-Type-Options: nosniff`;
  - status and `Content-Range` pass through, so video seeking works.
- **Timeouts:** connect 2 s; headers 30 s. Routes under `/exam/live/` are long-lived streams: there is no header timeout, they are tracked by the platform, and they are closed on logout, deactivation, shutdown or after 2 hours.
- **Service down** → the platform returns 503 `{"error":{"code":"MODULE_UNAVAILABLE","message":"Exam review is unavailable right now.","requestId":"…"}}`.

### 3. What the service must do on every request
- **Token:** reject with 401 unless `X-Service-Token` matches. Compare HMAC-SHA256 digests with `hmac.compare_digest`.
- **Source:** reject with 403 unless the client address is loopback.
- **Identity:** read the user only from the `X-UniVerse-*` headers, and re-check that the role is `invigilator` or `admin` (403 otherwise). The service has **no login, no JWT, no Django users for the API, no CORS and no sessions**.
- **Errors**, always in this shape, with the incoming `X-Request-Id`: `{"error":{"code":"UPPER_SNAKE","message":"plain sentence","requestId":"…"}}`.
  - 400 `VALIDATION_ERROR`: serializers reject unknown fields;
  - 404 `NOT_FOUND`;
  - 409 `CONFLICT`;
  - 413 `FILE_TOO_LARGE`;
  - 415 `UNSUPPORTED_TYPE`.
- **Lists:** `?limit=` (1–100, default 20) and `?cursor=` (opaque) → `{"items":[…],"nextCursor":null|"…"}`.
- **Times** are ISO 8601 UTC with `Z`. **IDs** are UUIDs. Confidence is 0–1, with 3 decimals.

### 4. Service endpoints (paths are relative to `/exam/`; the browser sees them under `/api/exam/`)
| Method and path | Purpose |
| --- | --- |
| `GET exams` | list exams or rooms, for the exam select |
| `POST clips` (multipart `file`, `examId`, optional `zone` as `x1,y1,x2,y2` in % of the frame) | upload a clip: mp4 or webm, magic bytes checked, ≤ 200 MB; starts an analysis job; 202 `{clipId, jobId}` |
| `GET clips`, `GET clips/:id` | list and detail, with job status and progress |
| `GET clips/:id/video` | the clip, with `Range` support (206) |
| `GET flags?status=open\|dismissed\|resolved\|all&examId=` | the flag list, with counts per status in `counts` |
| `GET flags/:id` | detail: signal, `startAt` and `endAt` offsets in seconds, `confidence`, `peakConfidence`, seat or track, `clipId`, snapshot URL, a plain-language `explanation` including common harmless causes, status, decision and note, history |
| `GET flags/:id/snapshot` | the JPEG snapshot |
| `POST flags/:id/review` `{decision: "dismiss"\|"follow_up", note}` | the note is required (1–1000 characters, trimmed); 409 if the flag is not open |
| `POST flags/:id/reopen` `{note}` | back to open; the note is required |
| `GET dashboard-summary` | `{"openFlags": n, "lastProcessedAt": "…"\|null}` for the dashboard card |
| `POST live/sessions`, `POST live/sessions/:id/stop`, `GET live/sessions/:id/stream` (MJPEG) | live webcam (optional, only if time allows). Recording needs `consent: true` from the "everyone agreed" checkbox. |

Statuses: `open` → `dismissed` or `resolved` (follow-up), and `reopen` goes back to `open`. **The service never decides anything itself.** No endpoint, field or message uses the words "cheating", "misconduct", "suspicious", "CCTV" or "surveillance"; use "flag", "observed event" and "for human review". There are no penalties and no verdict fields.

### 5. Service → platform (internal routes, loopback only, same `X-Service-Token`)
- `POST /internal/exam/activity` `{idempotencyKey, type, recipients: {role: "invigilator"} | {userIds: [...]}, params}`
  - `type` is one of `exam.flag_created`, `exam.flag_reviewed` or `exam.clip_processed`;
  - the platform owns the text template for each type (in `packages/contracts/src/activity/exam.ts`), so the service never sends free text;
  - `params` holds only IDs, counts and a seat label.
- `POST /internal/exam/audit` `{idempotencyKey, actorUserId, action, targetType, targetId, meta}`
  - `action` starts with `exam.`;
  - `meta` is small JSON with no personal data beyond IDs.
- `POST /internal/exam/push` `{userId, event: "exam.job_progress", data: {jobId, progress, status}}` sends an ephemeral live event to that user's open tabs (it replaces polling).
- All three return 202. They are idempotent by `idempotencyKey`: the platform keeps keys for 7 days, and a repeat returns 202 without a duplicate.
- **Reliability:** the service writes an **outbox row in the same database transaction** as the change, for example a review. A background worker delivers outbox rows with retries and backoff, so an audit entry is never lost even if the platform is briefly down.
