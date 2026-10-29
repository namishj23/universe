# UniVerse — progress and project memory

This file is the single memory of the project. Every Claude Code session reads it first and updates it last. Newest entries go at the top of each log.

Master plan (scope, architecture, rubric): the "UniVerse — Implementation Plan" doc. If this file and the plan disagree, this file holds the latest decision.

## Current status

| Area | Owner | Phase now | Status |
| --- | --- | --- | --- |
| Platform | Person 1 | P2 Platform services | Done — PR open to `main`, stacked on P1's PR #1 (both need Person 2 review) |
| A · Student Hub | Person 1 | — | Not started |
| B · Ride-Pooling | Person 1 | — | Existing code, not moved in |
| D · Digital Wellbeing | Person 1 | — | Not started |
| C · Observatory | Person 2 | — | Not started |
| E · Exam Monitoring | Person 2 | — | Not started |

## Person 1 phases

| Phase | What | Model / effort | Status |
| --- | --- | --- | --- |
| P1 | Platform core: auth, sessions, roles, activity feed with SSE | Opus 5.5 / high | Done |
| P2 | Platform services: module registry, dashboard API, admin user management, password change, audit log, file storage, OpenAPI contract | Opus 5.5 / high | Done (report: `docs/sessions/P2.md`) |
| P3 | Module B backend: Prisma on the shared database and users, platform sessions instead of emailed codes, mock DB removed, activity events, dashboard summary | Opus 5.5 / high | Not started |
| P4 | Module A backend: profiles, prep tracker, mentor ranking, mentorship requests, resource repository with search | Opus 5.5 / high | Not started |
| P5 | Module D: privacy logic library (sanitise, categorise, metrics) and API for opt-in daily totals, consent, export and delete | Sonnet 5.5 / high | Not started |
| P6 | Cross-module links, seed data, test scenarios, demo storyline run through the API | Sonnet 5.5 / medium | Not started |
| P7 | Independent read-only audit of Platform, A, B, D | Opus 5.5 / xhigh | Not started |
| P8 | Fix audit findings | Sonnet 5.5 / high | Not started |
| P9 | README, architecture, algorithms, docs | Sonnet 5.5 / medium | Not started |
| U1 | Frontend shell from the team's UI design | Sonnet 5.5 / high | Waiting for UI |
| U2 | Frontend screens for A, B, D from the team's UI design | Sonnet 5.5 / high | Waiting for UI |

Checkpoints with Person 2: merge to `main` at Hour 5 and Hour 7. Feature freeze at Hour 9.

## Decisions (newest first)

- 2026-10-29 (P2) — **Login throttle** moved from `users` to `login_throttle` (`apps/api/src/platform/auth/throttle.ts`), keyed by `HMAC-SHA256(EMAIL_HMAC_SECRET, lowercased email)` hex. Known and unknown emails take one code path: same lookups, one Argon2 verify (dummy hash for unknown), same failure counting (atomic Prisma upsert), lock for 15 min at 5 failures, same 401/429 bodies. Inactive accounts with the right password also count as failures. Rows untouched for 24 h are purged by the hourly cleanup. `EMAIL_HMAC_SECRET` is a new required env var, separate from `CSRF_SECRET` so rotating CSRF never breaks audit correlation.
- 2026-10-29 (P2) — **Additive-then-drop without backfill:** `20261029160836_p2_platform_services` adds the table, `20261029160853_drop_user_lockout_columns` drops `failed_login_count`/`locked_until`. Live locks were not copied: the key needs the app secret, which SQL migrations do not have, and locks last ≤15 min. The drop migration was hand-written and applied with `migrate deploy` (Prisma's data-loss confirmation is interactive); `migrate diff` shows no drift.
- 2026-10-29 (P2) — **Module discovery** (`apps/api/src/platform/modules/index.ts`): at startup `loadModules()` reads `apps/api/src/modules/*/` (or `dist/modules/*/`), imports `index.ts` if present else `index.js`, and takes the default export (ESM `export default`, CommonJS `module.exports =` both land there; a test proves a `{"type":"commonjs"}` folder loads). A strict Zod schema validates each definition; folder name must equal `id`; duplicate ids and file purposes fail; one error lists every problem and the server exits. `createApp({ modules })` mounts each router at `/api/<id>` behind `requireAuth` + `requireRole(...roles)`. `server.ts` loads modules with `.then()` (still no top-level await).
- 2026-10-29 (P2) — **Dashboard:** providers run in parallel, each with `AbortSignal.timeout(1500)` raced against its promise; output is validated against `dashboardSummaryRegistry[id]` in contracts (missing schema or mismatch → `error`); failures are logged with request ID and module ID and never fail the response.
- 2026-10-29 (P2) — **Password rules:** 12–256 characters (Zod `NewPassword`), must differ from the current one, must not contain the email local part when it is ≥3 characters (shorter local parts would ban most passwords for no gain). Temporary passwords: 18 random bytes base64url (24 chars). While `must_change_password` is true, a global gate after CSRF returns 403 `PASSWORD_CHANGE_REQUIRED` except `/api/auth/me`, `/change-password`, `/logout`, `/login` and `/api/health/*`. Change-password is rate-limited to 10 per 15 min per user.
- 2026-10-29 (P2) — **Last-admin protection:** `PATCH /api/admin/users/:id` locks every active admin row (`SELECT … FOR UPDATE`, in id order) inside the transaction before checking; the second of two concurrent requests waits, re-reads, and gets 409 `LAST_ADMIN` (or 401 if its own account was the one deactivated). Self-demote/deactivate/reset → 409 `CANNOT_CHANGE_SELF`.
- 2026-10-29 (P2) — **Audit log** (`apps/api/src/platform/audit/index.ts`): `audit.record(tx, …)` validates metadata against `auditRegistry` in contracts and writes with the caller's transaction client. Append-only is enforced by trigger `audit_log_append_only` (BEFORE UPDATE OR DELETE, raises) in the migration SQL; TRUNCATE (test setup only) is not blocked. `actor_id` FK is RESTRICT. Failed sign-ins store only `{ emailHmac }`.
- 2026-10-29 (P2) — **Uploads:** `busboy` 1.6 (streaming multipart, `defParamCharset: 'utf8'`, limits files 1 / fields 0 / parts 1 / fileSize per purpose) and `file-type` 22 (`fileTypeFromFile`, magic numbers). busboy's `filesLimit`/`partsLimit` events mean "limit reached" (extra parts are silently skipped), so they are not errors. Failures wait for the temp write stream's `close` before deleting the temp file; the socket is closed after an early error response instead of reading the rest of the body.
- 2026-10-29 (P2) — **Storage layout:** `STORAGE_DIR` (absolute, must exist, writable, outside the repo; checked at startup and in `/api/health/ready`) holds `tmp/<uuid>.part` and `objects/<uuid>`; keys are server-generated UUIDs, never derived from names. `Storage` interface + disk implementation in `apps/api/src/platform/files/storage.ts`. Quota (default 200 MB, `STORAGE_QUOTA_MB`) is re-checked under `pg_advisory_xact_lock(hashtext(owner))`. Delete is a soft delete; the hourly sweep removes temp files >1 h old and, 24 h after a soft delete, the bytes and then the row. Downloads use `res.sendFile` (Range/206/416 from `send`) with our own RFC 6266/5987 `Content-Disposition`.
- 2026-10-29 (P2) — `hub.resource` downloads are **owner or admin** until P4 defines the shared repository's visibility (secure default).
- 2026-10-29 (P2) — **OpenAPI:** `zod-openapi` 6 (Zod 4 native `.meta({ id })` for components; contracts only use Zod's own `.meta`). Builder: `apps/api/src/platform/openapi.ts`; modules add `openapi` paths (relative to `/api/<id>`) in their definition. Served at `/api/docs/openapi.json` and `/api/docs` (swagger-ui-express, assets local, no CDN) only when `NODE_ENV !== 'production'`. `npm run api:docs` writes `docs/api/openapi.json` (Prettier-ignored); tests validate it with `@apidevtools/swagger-parser`, check every mounted route is documented, and fail if the committed file is stale.
- 2026-10-29 (P2) — Admin search uses `pg_trgm` (in `public`, trusted extension, created by the migration) with GIN indexes on `users.name` and `users.email`, declared in `platform.prisma` with `ops: raw("gin_trgm_ops")` (no drift). Prisma's `contains` does **not** escape `%`/`_` (checked), so `escapeLike()` does.
- 2026-10-29 (P2) — Shared paging helpers in `apps/api/src/platform/paging.ts` (`olderThan`, `toPage`, `encodeCursor`/`decodeCursor`, `newestFirst`); `IdParam` moved to `http.ts`. The activity feed now uses them too.
- 2026-10-29 (P2) — **Risk (recorded as asked):** the partial index `activity_events_unread_idx` depends on Prisma's `partialIndexes` preview feature. `apps/api/test/throttle.test.ts` fails if it (or the trigram indexes) is missing from `pg_indexes`.
- 2026-10-29 — Backend first: all phases build backend only; frontend is built in phases U1–U2 from the team's UI design.
- 2026-10-29 (P1) — **API is ESM** (`"type": "module"`, TS `module`/`moduleResolution: nodenext`, `verbatimModuleSyntax`). Prisma 7 ships ESM-only and its `prisma-client` generator recommends ESM. **How Module B mounts unchanged in P3:** copy its `.js` files to `apps/api/src/modules/rides/` with a nested `package.json` containing `{"type":"commonjs"}`; the ESM app default-imports the router (`import ridesRouter from './modules/rides/routes/index.js'` binds to `module.exports`); its CJS code can `require()` ESM platform modules (Node ≥22.12 `require(esm)`). Verified in P1 with a throwaway probe (ESM app → CJS router → `require()` of an ESM middleware): 200, no warnings on Node 24. Rule: **no top-level `await` anywhere in `apps/api/src`** (it breaks `require(esm)`). P3 must also copy that folder into `dist/` in `apps/api`'s build script (tsc does not emit `.js` sources; `allowJs` is off).
- 2026-10-29 (P1) — Node engines `>=22.12 <23 || >=24 <25`; `.nvmrc` = 24. TypeScript pinned `~6.0.3` (typescript-eslint 8 supports `<6.1`; TS 7 is out but unsupported by the linter). Prisma pinned `7.10.1` (npm's `latest` tag points at an 8.0 RC).
- 2026-10-29 (P1) — TS flags: `strict`, `noUncheckedIndexedAccess`, **`exactOptionalPropertyTypes` on** (did not fight Prisma 7 or Zod 4), `noImplicitOverride`, `noFallthroughCasesInSwitch` (`tsconfig.base.json`).
- 2026-10-29 (P1) — `@universe/contracts` is consumed from source everywhere except `npm start`: export condition `@universe/source` → `src/index.ts` (tsconfig `customConditions`, `tsx --conditions`), Vite/Vitest alias to the same file; `default` → `dist/` (built first by `npm run build`).
- 2026-10-29 (P1) — Zod 4 (`^4.6`). Module B uses Zod 3: in P3, if any of its schemas break, change its imports to `require('zod/v3')` (shipped inside Zod 4) rather than rewriting.
- 2026-10-29 (P1) — No dotenv: the API uses `node --env-file-if-exists=.env`; `prisma.config.ts` and Vitest use `process.loadEnvFile()`. `ENV_FILE=apps/api/.env.test` points Prisma commands at the test database.
- 2026-10-29 (P1) — **PostGIS lives in schema `extensions`**, not `public`, with `ALTER DATABASE … SET search_path = "$user", public, extensions` on both databases. Reasons: Prisma 7 `migrate reset` drops `public` (which would remove PostGIS from `universe_test`, and only a superuser can re-create it), and PostGIS's `spatial_ref_sys` table in `public` shows up as schema drift. Unqualified `geography(...)`/`ST_*` still resolve through the search path, so Module B's `$queryRaw` works unchanged. P3: a migration that uses `geography` needs the extension in Prisma's shadow database too; plan to set `shadowDatabaseUrl` to a pre-made `universe_shadow` with the same `extensions` schema.
- 2026-10-29 (P1) — Argon2id via `argon2` 0.45 with the OWASP Password Storage Cheat Sheet minimum: m=19456 KiB (19 MiB), t=2, p=1 (`apps/api/src/platform/auth/password.ts`).
- 2026-10-29 (P1) — **Transaction-safe emit** (`apps/api/src/platform/activity/service.ts`): `transaction(async (tx, emit) => { …module writes with tx…; await emit({...}) })` wraps `prisma.$transaction`; `emit` validates against the contracts registry and inserts with `createManyAndReturn` (1,000 rows per INSERT) using `tx`, and queues the rows; they are pushed to SSE streams only after `$transaction` resolves, and discarded if it throws. `emit(input)` alone is shorthand for a one-event transaction. `recordActivity(db, input)` inserts without pushing (seed only). A failed push after commit is logged, never thrown (the data is already committed).
- 2026-10-29 (P1) — Timestamps are `timestamptz(3)` (millisecond precision) so JS `Date` cursors round-trip exactly; microsecond columns would break `(created_at, id)` keyset paging. Feed cursor = base64url of `ISO|uuid`. The keyset `WHERE` adds a redundant `created_at <= cursor` so PostgreSQL seeks the feed index instead of filtering from the newest row.
- 2026-10-29 (P1) — Partial index `activity_events_unread_idx (recipient_id) WHERE read_at IS NULL` is declared in the schema with Prisma's `partialIndexes` preview feature (no hand-written SQL, so no drift).
- 2026-10-29 (P1) — Login is exempt from the CSRF **token** check (there is no session to bind a token to yet, and a stale cookie has no token in memory). It still requires `Content-Type: application/json` (415 otherwise), passes the Origin allow-list check, and the cookie is SameSite=Lax.
- 2026-10-29 (P1) — CSRF token = `HMAC-SHA256(CSRF_SECRET, session.id)`, base64url, returned in the body of `/api/auth/login` and `/api/auth/me`, kept only in memory on the web.
- 2026-10-29 (P1) — Single-instance limits, marked with `ponytail:` comments: the login rate limiter uses express-rate-limit's in-memory store, and the SSE broker is an in-process map. Running more than one API instance needs a shared rate-limit store (Redis) and PostgreSQL `LISTEN/NOTIFY` or Redis pub/sub for the broker.
- 2026-10-29 (P1) — Tests: `apps/api/test/global-setup.ts` runs `prisma migrate deploy` on `universe_test` (refuses any database not named `*_test`); `test/setup.ts` truncates every table except `_prisma_migrations` before each file; files run one at a time. Not `migrate reset`: Prisma 7 blocks `migrate reset` from AI agents without the user's typed consent, and truncation gives the same clean state faster. `npm run db:test:reset` still exists for humans.
- 2026-10-29 (P1) — `WEB_ORIGINS` includes `http://127.0.0.1:4000` so a judge can run two signed-in users in one Chrome (`localhost` and `127.0.0.1` keep separate cookies).
- 2026-10-29 (P1) — Prettier formats code only (`*.md` ignored), so hand-written docs are never rewritten.
- 2026-10-29 (P1) — Helmet's CSP `upgrade-insecure-requests` is only on when `COOKIE_SECURE=true`; otherwise it would break the plain-http `npm start` demo.
- 2026-10-29 (P1) — The temporary web screens live in `apps/web/src/platform/` (`api.ts`, `auth.tsx`, `LoginPage.tsx`, `FeedPage.tsx`) and `apps/web/src/App.tsx`. P2 moves the layout into `apps/web/src/shell/` and can keep `api.ts` and `auth.tsx`.
- 2026-10-29 — Repo lives at `~/Desktop/mini project hackathon` with a new private GitHub repo. Paths contain spaces: always quote them in scripts.
- 2026-10-29 — No Docker. PostgreSQL + PostGIS installed with Homebrew on each laptop. README gives the Homebrew setup steps for judges.
- 2026-10-29 — One real PostgreSQL database for every module. Module B's in-memory mock DB (`USE_MOCK_DB`) is removed in P3.
- 2026-10-29 — Everyone logs in with email + password. One seeded demo account per role. Module B's emailed one-time code login and its localStorage JWT are retired in P3.
- 2026-10-29 — New code is TypeScript. Module B stays JavaScript while being moved in.
- 2026-10-29 — Clock already running when planning finished: no pre-built code.
- 2026-10-29 — Each module has one owner who handles code, tests, docs, audit fixes, slides and demo steps. Person 1: Platform, A, B, D. Person 2: C, E.
- 2026-10-29 — GSD skipped for the hackathon (too much overhead for 12 hours). Plain Claude Code with plan mode; grill-me optional at Hour 0.

## What we know about Module B (read before P3)

Source: `~/Documents/Mini project (React)/routepool2-react-/` (not a git repo).

- Backend: Express 4, CommonJS JavaScript, Zod validation, Prisma 7 with PostgreSQL + PostGIS (`nodes.geom` is `geography(Point, 4326)`, queried with `$queryRaw`).
- Every model file switches between Prisma and an in-memory mock store (`src/db/mockStore.js`) on `USE_MOCK_DB`. The copy on disk runs in mock mode, so the Prisma path may be untested.
- Auth: emailed 4-digit code limited to `@spit.ac.in`, JWT in `localStorage`, admins listed in `ADMIN_EMAILS` with one shared password hash.
- Matching: Dijkstra on a stop graph (`src/utils/dijkstra.js`, `src/config/stopGraph.js`, `stopEdges.json`), eligibility by route overlap ≥ 50% of the shorter route, pickup times within 10 minutes, max 3 riders, ranking 0.7 route similarity + 0.3 time (`src/config/matchingConfig.js`).
- Frontend: React 19, Vite, React Router 7, plain CSS, `/api` proxied to port 4000.
- Risks for P3: admin features (reports, notices, student suspension, audit log) and vehicles have model files but no matching tables in `schema.prisma` — check whether they only exist in the mock store. `backend/.env` contains real email credentials: never copy it.

## Requests for the other owner

- 2026-10-29 (P2, for Person 2): please review the P2 pull request too (it changes shared areas: `packages/contracts/`, `apps/api/src/platform/`, `prisma/schema/platform.prisma`, `prisma/seed/index.ts`, root `package.json`). Your modules plug in without touching the platform: see "How to plug in your module (backend)" below. Two shared files take one line each when you start: `packages/contracts/src/dashboard/index.ts` (your summary schema) and `packages/contracts/src/audit/index.ts` (your audit actions), via PR.
- 2026-10-29 (P1, for Person 2): please review and approve the P1 pull request: it creates every shared area (`packages/contracts/`, `apps/api/src/platform/`, root `package.json`, `prisma/schema/base.prisma`, `prisma/schema/platform.prisma`, `prisma/seed/index.ts`). To send activity events from C or E: add `packages/contracts/src/activity/observatory.ts` / `exam.ts` (types named `observatory.*` / `exam.*`), spread them into `activityRegistry` in `packages/contracts/src/activity/index.ts` (shared, so via PR), then call `transaction()` or `emit()` from `apps/api/src/platform/activity/service.ts`.

## How to plug in your module (backend)

Everything below happens in your own folders except the one-line registry entries in `packages/contracts` (shared, so by PR). The OpenAPI document is the contract the UI phases build against.

**1. Module definition.** Create `apps/api/src/modules/<id>/index.ts` (`<id>` is `observatory` or `exam`) with a default export:

```ts
import { Router } from 'express';
import type { ModuleDefinition } from '../../platform/modules/index.js';

const router = Router(); // your routes; the platform mounts it at /api/exam
const exam: ModuleDefinition = {
  id: 'exam',                 // must equal the folder name
  label: 'Exam Monitoring',
  order: 50,
  roles: ['invigilator', 'admin'],   // outer guard: anyone else gets 401/403 before your router
  router,
  dashboardSummary: async (user, signal) => ({ openFlags: 3 }), // optional, 1.5 s budget
  seed: async () => {},       // optional, idempotent; run by `npm run db:seed`
  filePurposes: [/* see 3 */],
  openapi: {/* see 6 */},
};
export default exam;
```
Restart the API: the folder is discovered automatically. A bad definition stops startup with a list of problems. Inside your routes still check finer permissions and ownership (`authOf(req)` from `platform/auth/guards.js` gives `{ user, sessionId }`); return 404 for other people's records.

**2. Dashboard summary.** Add `packages/contracts/src/dashboard/<id>.ts` exporting a Zod schema (e.g. `ExamDashboardSummary`) and one line in `dashboardSummaryRegistry` in `packages/contracts/src/dashboard/index.ts`. The platform validates your provider's output against it; a mismatch, a throw or more than 1.5 s shows as `error`/`timeout` for your module only. Respect `signal` (pass it to slow work) — it aborts at the deadline.

**3. File uploads.** Add an entry to `filePurposes`:
```ts
{ id: 'exam.clip', mimeTypes: ['video/mp4', 'video/webm'], maxBytes: 200 * 1024 * 1024,
  authorizeRead: (user, file) => user.role === 'admin' || user.role === 'invigilator' }
```
Uploads: `POST /api/files/exam.clip` (multipart, one part named anything). Only roles in your module's `roles` may upload. The real type is detected from the bytes. Download `GET /api/files/:id` (Range supported, so video seeking works), delete `DELETE /api/files/:id` (owner or admin). Keep the returned `FileRecord.id` in your own table. Note the per-user quota (`STORAGE_QUOTA_MB`, default 200) — tell Person 1 if clips need more.

**4. Audit.** Add `packages/contracts/src/audit/exam.ts` with actions named `exam.<verb>` and their metadata schemas (strict; never personal data you don't need), spread into `auditRegistry`. Then, inside the same transaction as the action:
```ts
import { audit } from '../../platform/audit/index.js';
await prisma.$transaction(async (tx) => {
  await tx.examFlag.update(...);
  await audit.record(tx, { actorId: user.id, action: 'exam.flag_reviewed', targetType: 'exam_flag',
    targetId: flag.id, metadata: { decision: 'dismissed' }, requestId: req.id });
});
```
**5. Activity events.** As in P1: add `packages/contracts/src/activity/exam.ts`, spread into `activityRegistry`, then `transaction(async (tx, emit) => { …; await emit({...}) })` from `platform/activity/service.js`. You can call `audit.record(tx, …)` in the same callback.

**6. OpenAPI.** Describe each route in your definition's `openapi` field, paths relative to your base path, using your contracts' Zod schemas:
```ts
openapi: { '/flags': { get: { summary: 'List flags', requestParams: { query: PageQuery },
  responses: { '200': { description: 'OK', content: { 'application/json': { schema: pageOf(ExamFlag) } } } } } } }
```
Then run `npm run api:docs` and commit `docs/api/openapi.json`. `npm test` fails if a mounted route is undocumented or the committed file is stale. Browse it at http://localhost:4000/api/docs while `npm run dev` runs.

**7. Tests.** Use `apps/api/test/helpers.ts`: `login(email)` and `as(session).get/post/patch/delete(url)` (cookie and CSRF header set). Create the app with your module: `createApp({ modules: await loadModules() })`.

## Open questions

- GitHub usernames of both people (for CODEOWNERS): `.github/CODEOWNERS` has placeholders `@PERSON1_GITHUB` and `@PERSON2_GITHUB`. The repo is `github.com/namishj23/universe` (private), so Person 1 is probably `namishj23`: confirm.
- Which laptop runs the demo? Person 1's Mac already has PostgreSQL 18.6 + PostGIS 3.6.4 (Homebrew) with `universe` and `universe_test` set up.
- `npm run db:test:reset` has still not been run (Prisma 7 blocks `migrate reset` from AI agents unless the user consents). Run it once by hand to confirm it works.
- P2: is 200 MB per user enough for exam clips (Person 2)? `STORAGE_QUOTA_MB` is one setting for everyone.

## Session log (newest first)

- 2026-10-29 21:25–22:20 — P2 Platform services, backend only (Person 1, Opus 5.5 / high). Backend-first switch (phase table, CLAUDE.md rule, P1 screens removed), P1 review fixes (email-HMAC login throttle, index guard test), module registry and discovery, dashboard API, admin users with last-admin lock, change password + forced change, append-only audit log, file storage (busboy + file-type, quota, Range), OpenAPI 3.1 contract with `npm run api:docs`. 95 API + 1 web tests. Branch `p1/p2-platform-services`, PR to `main`. Full report: `docs/sessions/P2.md`. Next: P3 Module B backend.
- 2026-10-29 20:30–21:10 — P1 Platform core (Person 1, Opus 5.5 / high). Monorepo, DB setup, contracts, auth/sessions/CSRF/roles, transaction-safe activity feed with SSE, seed, minimal web, 33 tests, README setup. Branch `p1/p1-platform-core`, PR to `main`. Full report: `docs/sessions/P1.md`. Next: P2 app shell.
