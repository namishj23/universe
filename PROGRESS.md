# UniVerse — progress and project memory

This file is the single memory of the project. Every Claude Code session reads it first and updates it last. Newest entries go at the top of each log.

Master plan (scope, architecture, rubric): the "UniVerse — Implementation Plan" doc. If this file and the plan disagree, this file holds the latest decision.

## Current status

| Area | Owner | Phase now | Status |
| --- | --- | --- | --- |
| Platform | Person 1 | P3a (module factories, `driver` role, login-lockout fix) | Done — PR open to `main` (needs Person 2 review: shared areas) |
| A · Student Hub | Person 1 | P4 profiles, prep tracker, mentor ranking, mentorship requests, resource repository (backend) | Done — PR open (stacked on #4) |
| B · Ride-Pooling | Person 1 | P3b carpool offers, campus graph, detour matching, savings | Done — PR #4 open (stacked on #3) |
| D · Digital Wellbeing | Person 1 | — | Not started |
| C · Observatory | Person 2 | — | Not started |
| E · Exam Monitoring | Person 2 | — | Not started |

## Person 1 phases

| Phase | What | Model / effort | Status |
| --- | --- | --- | --- |
| P1 | Platform core: auth, sessions, roles, activity feed with SSE | Opus 5.5 / high | Done |
| P2 | Platform services: module registry, dashboard API, admin user management, password change, audit log, file storage, OpenAPI contract | Opus 5.5 / high | Done (report: `docs/sessions/P2.md`) |
| P3a | Module B onto the platform (Opus 5.5 / high) | Opus 5.5 / high | Done (report: `docs/sessions/P3a.md`) |
| P3b | Rides: driver offers, campus graph, detour matching, savings (Opus 5.5 / high) | Opus 5.5 / high | Done (report: `docs/sessions/P3b.md`) |
| P4 | Module A backend: profiles, prep tracker, mentor ranking, mentorship requests, resource repository with search | Opus 5.5 / high | Done (report: `docs/sessions/P4.md`) |
| P5 | Module D: privacy logic library (sanitise, categorise, metrics) and API for opt-in daily totals, consent, export and delete | Sonnet 5.5 / high | Not started |
| P6 | Cross-module links, seed data, test scenarios, demo storyline run through the API | Sonnet 5.5 / medium | Not started |
| P7 | Independent read-only audit of Platform, A, B, D | Opus 5.5 / xhigh | Not started |
| P8 | Fix audit findings | Sonnet 5.5 / high | Not started |
| P9 | README, architecture, algorithms, docs | Sonnet 5.5 / medium | Not started |
| U1 | Frontend shell from the team's UI design | Sonnet 5.5 / high | Waiting for UI |
| U2 | Frontend screens for A, B, D from the team's UI design | Sonnet 5.5 / high | Waiting for UI |

Checkpoints with Person 2: merge to `main` at Hour 5 and Hour 7. Feature freeze at Hour 9.

## Decisions (newest first)

- 2026-10-30 (P4) — **Hub data model** (`prisma/schema/hub.prisma`, migrations `20261029202837_p4_hub` and `20261029210500_p4_hub_search_words`): every table `hub_`; `hub_profiles(user_id)` is created on first use and every other hub reference to a person points at it, so `User` gets **one** back-relation (`hubProfile`, the only line changed in `platform.prisma`; Prisma refuses one-sided relations). CHECKs on enum-like text, array sizes and item lengths (an IMMUTABLE `hub_items_ok()` helper), ranges and slot length. `hub_topic_progress` stores a copy of the topic's total with a composite FK `(topic_id, total_items) → hub_topics ON UPDATE CASCADE`, so a CHECK bounds `solved` and the copy can't go stale. Resource file ids have no FK to `files` (rides' reason: the sweep hard-deletes rows).
- 2026-10-30 (P4) — **No-drift tricks:** Prisma compares partial-index predicates and generated-column expressions as text, so `hub.prisma` copies PostgreSQL's normalised forms (`status = ANY (ARRAY['pending'::text, 'accepted'::text])`, the `dbgenerated(...)` of the `search` column). The generated `tsvector` is declared `Unsupported("tsvector")? @default(dbgenerated(...))` with `@@index(type: Gin)`; `migrate diff` is empty on dev and test.
- 2026-10-30 (P4) — **Search:** the vector holds title and description words both as written (`simple`) and stemmed (`english`) plus the subject code; queries are prefix-only `simple` tsqueries built from letters and digits (`graph:* & algo:*`), so half-typed words match and input can't be tsquery syntax. Changed in place with PostgreSQL 18's `ALTER COLUMN … SET EXPRESSION` (no DROP). Uploader names use P2's trigram index with escaped `ILIKE`. One statement (FTS UNION ALL names, joined to files and users). 60 searches per minute per user (in-memory limiter).
- 2026-10-30 (P4) — **One week for every module:** `weekOf()` in `packages/contracts/src/week.ts` (Sunday 00:00 → Saturday 23:59:59.999 Asia/Kolkata; fixed +05:30). Modules C, D and E should use it for anything "this week".
- 2026-10-30 (P4) — **Mentor ranking** exactly as the prompt (weights in `apps/api/src/modules/hub/config.ts`); hand-worked numbers in `docs/ALGORITHMS.md`. Seed order for Aarav: **Neha 0.6663, Sameer 0.5691, Arjun 0.5670, Kavita 0.4234**. `slotsThisWeek` = open slots in the next 7 days (the same window as `availability`). The ranked list is paged with an offset cursor (it is bounded by the number of mentors and must be ranked whole).
- 2026-10-30 (P4) — **Requests:** either party may cancel (the other is notified); cancelling an accepted request reopens its slot if it is still in the future. Accept locks mentor profile → request → slot; a requested slot that is no longer open is 409 `SLOT_TAKEN` (not silently swapped). Complete only after the session has started. Increment outside 0..total is 409 `PROGRESS_OUT_OF_RANGE` (not clamped).
- 2026-10-30 (P4) — **Resource visibility (resolves P2's open item):** `hub.resource` downloads need a hub role AND (attached to a live resource OR uploader OR admin); drivers and invigilators get 404 on every resource file. `inUse` counts every resource row, deleted ones too (admins can still review a deleted resource's file), so attached files are never deleted or swept.
- 2026-10-30 (P4) — **Idempotency-Key** on `POST /api/hub/prep/:topicId/increment`: in-process map of in-flight/finished promises per user and key for 10 minutes (max 10,000 keys). Another single-instance limit, next to the rate limiters and the SSE broker (`ponytail:` comment in `apps/api/src/modules/hub/idempotency.ts`).
- 2026-10-30 (P4) — Seven new demo accounts in `prisma/seed/platform.ts` (3 mentors, 4 students). Platform tests that counted recipients now derive the count from `DEMO_ACCOUNTS`.

- 2026-10-30 (P3b) — **Scope (user decision mid-session): RoutePool's ported backend is not reworked.** Only what RoutePool never had was written (carpool drivers, offers, bookings, detour matching, offer costs, stats, the 22-stop graph). Pooled-auto matching, joins and fares are P3a's port unchanged. So the "one auto on one line" rule still applies to pooled autos, and riders whose routes share a stretch then split are matched by the carpool matcher only. Offer matches use RoutePool's `MatchCard` field names (`score`, `routeSimilarity`, `seatsLeft`, `pickupNode`, `womenOnly`), so its components can be reused in U2.
- 2026-10-30 (P3b) — **Graph source:** `apps/api/scripts/rides-graph.mjs` → `apps/api/src/modules/rides/data/graph.json` (committed, Prettier-ignored).
  - 22 stops and 27 edges. OSRM road distances and Nominatim coordinates for the city stops; RoutePool's six stops keep their cached ids, coordinates and distances.
  - The 8 campus points are hand-placed; their 11 edges are straight line × 1.3 and marked `estimated`.
  - Edge kinds are `road`, `campus_road` and `walk`. Vehicles never use `walk`.
  - Durations come from 20/10/5 km/h.
  - The graph is validated when the module loads and after the seed.
  - Details in `docs/ASSUMPTIONS.md`.
- 2026-10-30 (P3b) — **Shortest paths:** binary-heap Dijkstra (`lib/dijkstra.js`, O((V+E) log V)). `core.loadGraph` caches the graph by an md5 fingerprint of the two tables (one query per call) and keeps path trees in a 256-source LRU.
- 2026-10-30 (P3b) — **Carpool drivers are `rides_drivers` rows with `kind = 'carpool'`** and `status` pending | approved | rejected | suspended (auto rows default to approved).
  - Their platform role stays student or mentor. Offer routes check the record (approved and documents verified), not a role.
  - The same `rides.driver_document` upload and review is used.
  - The admin decides with `POST /admin/drivers/:id/review` (audited, plus an activity event). Approving needs verified documents; suspending cancels upcoming offers.
- 2026-10-30 (P3b) — **Vehicle rules:**
  - `rides_vehicles.vehicle_type` is auto | car | bike.
  - Permit, fitness and service dates are auto-only; a CHECK makes them required for autos and lets them be null otherwise.
  - Cars and bikes need a validated, unique Indian plate plus insurance and PUC valid on the departure day. A bike carries exactly 1 passenger (CHECK).
  - Inspections, the complaint rules and the admin fleet board stay auto-only.
- 2026-10-30 (P3b) — **Detour, delay and cost limits** (`config.offers`):
  - default detour 2,000 m (0–10,000), with a default time budget equal to that distance at 20 km/h (≤ 3,600 s);
  - confirmed pickups may move ≤ 10 minutes; a ride may be ≤ 1.5 × the direct path;
  - trips ≤ 180 minutes;
  - cost per km: car ₹7, bike ₹2.50 (driver can override);
  - cancellations within 15 minutes of departure are audited; a ride can be marked departed from 30 minutes before.
- 2026-10-30 (P3b) — **Scoring weights:** the same 0.7 route similarity + 0.3 time fit as pooled matching (`config.matching`). Detour, seats and delay are hard rules, not score terms.
- 2026-10-30 (P3b) — **Offer edit rules:** with no accepted passenger, any field can change (requested bookings are re-checked when accepted). With accepted passengers, only seats up (never below `peak_onboard`), more detour budget, a lower cost per km and `autoAccept`; anything else gets 409 `OFFER_HAS_PASSENGERS`.
- 2026-10-30 (P3b) — **Seats are per segment:** a seat freed at a drop can be reused by a later pickup. Status `full` means the busiest stretch is full: `full` offers are hidden from matches but can still take a passenger whose stretch fits.
- 2026-10-30 (P3b) — **Files in use:** `FilePurpose.inUse(ids)` (platform). `DELETE /api/files/:id` returns 409 `FILE_IN_USE` for a claimed file, and `sweepFiles(modules)` skips claimed files. Rides claims any file still referenced by a driver document or inspection (old rows are the review trail, so not only the current one). New indexes on those file id columns.
- 2026-10-30 (P3b) — **`GET /api/rides/stats` was already RoutePool's rider totals route**, so the new admin report is `GET /api/rides/admin/stats`, next to `GET /api/rides/stats/me`.
- 2026-10-30 (P3b) — Removed `apps/api/.vitest/json/output.json` (a test-run artifact committed by accident in P3a's report commit; it failed the Prettier check) and ignored `.vitest/`.

- 2026-10-29 (P3a) — **One module pattern: factories.** Every module folder default-exports `(platform) => ModuleDefinition` (CommonJS: `module.exports = (platform) => ({...})`); `loadModules({ dir?, platform? })` refuses a plain definition. `platform` (`apps/api/src/platform/modules/platform.ts`, type `Platform`) is a frozen object built once at startup (`platform()` in `server.ts`, the seed and `api:docs` use the same shared instance; tests may pass `createPlatform(overrides)`): `prisma`, `transaction`, `emit`, `pushEvent`, `audit.record`, `authOf`, `requireRole`, `http.{ApiError, asyncHandler}`, `paging.*`, `files.save`, `contracts` (the whole `@universe/contracts` namespace, for CommonJS modules), `config.{nodeEnv, isProduction}` and `logger(moduleId)` (cached child). No environment variables or secrets. Hub and wellbeing were converted. **Why:** P3a found that a CommonJS module cannot `require()` the TypeScript platform in dev (`tsx`) or Vitest — Node's native loader finds no `db.js` next to `db.ts` (`Cannot find module`) — and where it can (built `dist/`), it would load a second Prisma client and a second SSE broker. File purposes are still registered through the definition's `filePurposes`.
- 2026-10-29 (P3a) — **Login lockout reserves attempts before checking the password** (`apps/api/src/platform/auth/throttle.ts` `reserveAttempt`): under a row lock (`INSERT … ON CONFLICT DO NOTHING`, then `SELECT … FOR UPDATE`) the count is read and raised; the sixth reservation locks the key. The P1–P2 audit reproduced 30 of 30 parallel wrong passwords being verified with the old read-then-count code. Regression test in `apps/api/test/auth.test.ts`.
- 2026-10-29 (P3a) — **Role `driver`** (contracts `Role`, enum migration `20261029180206_p3a_driver_role` with `BEFORE 'admin'`). Drivers sign in with email + password; Module B's driver OTP, email pattern, demo code and driver JWT are gone. `GET /api/modules` for a driver lists only `rides`.
- 2026-10-29 (P3a) — **Rides data model** (`prisma/schema/rides.prisma`, migration `20261029180948_p3a_rides`): every table `rides_`; every reference to a person points at `rides_profiles(user_id)` (created on first use, rider code `crypto.randomInt`, unique), so platform `User` gets only two back-relations (`ridesProfile`, `ridesDriver`). Money integer paise, distance integer metres, CHECK constraints on enum-like columns (hand-written SQL, no drift). File ids (driver documents, inspection photos) have **no FK** to `files`: the platform's sweep hard-deletes files 24 h after a soft delete, which an FK would block. `total_rides`/`total_savings` are not stored: computed from completed rides (boarded, not cancelled, and completed by the driver or past pickup).
- 2026-10-29 (P3a) — **A vehicle can't hold two live assignments:** exclusion constraint `rides_groups_vehicle_busy` — `EXCLUDE USING gist (vehicle_id WITH =, tstzrange(driver_assigned_at, rides_vehicle_busy_until(pickup_at)) WITH &&) WHERE (vehicle_id IS NOT NULL AND status <> 'cancelled')`, needing `btree_gist` (trusted, in schema `extensions`) and an IMMUTABLE wrapper for `pickup_at + 30 minutes` (`timestamptz + interval` is only STABLE). Chosen over a partial unique index because Module B's rule is time-based ("busy until pickup + 30 min"), which a partial index can't express without a release job. Assignment also locks the group row and the candidate vehicles (`FOR UPDATE OF v SKIP LOCKED`), so the constraint is a backstop (violation → 409).
- 2026-10-29 (P3a) — **Migrations and PostGIS:** Prisma's migration connection pins `search_path` to `public`, so the rides migration starts with `SET search_path TO public, extensions;`. `prisma.config.ts` sets `shadowDatabaseUrl` (`SHADOW_DATABASE_URL`, default `universe_shadow` on the same server). The shadow's `extensions` schema must be owned by `universe` like the other two databases (the setup steps had created it as the superuser; fixed with `ALTER SCHEMA extensions OWNER TO universe`, README updated).
- 2026-10-29 (P3a) — **Money:** fares in paise with one rounding rule (half up on an exact integer fraction) applied once per stop to the cumulative meter fare; segment costs are differences, so they telescope to the full-route fare; shares by largest remainder over the whole route (ties → earlier member), so they always sum to the total; payout = half-up 90 %, fee = total − payout. The API returns integer paise (`…Paise` fields) and metres (`…M`).
- 2026-10-29 (P3a) — **Concurrency in rides:** join locks the group row, then the caller's request row, and re-checks capacity, status, gender access, the boarded rule and time window against committed data (Module B's in-process `oneAtATime` queue is gone). Driver assignment locks the group (two members asking at once get the same driver). Driver accept is `UPDATE … WHERE vehicle_id = mine AND driver_accepted_at IS NULL` (one winner, others 409). Leave, board, pay, cancel, unassign, decline, trip steps, reviews and suspension are each one transaction with their audit entry and activity events.
- 2026-10-29 (P3a) — **Driver assignment** is Module B's both flows: a rider's `GET /groups/:id/driver` auto-assigns, the assigned driver accepts or declines (decline re-assigns at once). Every roster driver is now an account, so only online drivers with valid documents and a roadworthy, non-busy vehicle are assignable; the seed puts the seven roster drivers online.
- 2026-10-29 (P3a) — **Behaviour changes from Module B** (on purpose): a join may only add the caller's own request to an existing group (Module B could pull another student's open request into your group without consent; the legacy `POST /groups/:id/join` for an open *request* id is gone); a suspended rider is refused request, join and board with 403 `RIDES_SUSPENDED` (Module B stored suspensions but never enforced them, so the message is new); a ride completed by its driver releases boarded riders at once (Module B waited until pickup + 30 min); `GET` lists are cursor-paged (default 20, max 100); matches are the top `limit` ranked results.
- 2026-10-29 (P3a) — **Live chat:** `pushEvent(userIds, name, data)` in `platform/activity/broker.ts` sends a named SSE event that is not stored (name must be `<module>.<event>`, so never `activity` or `unread-count`). Rides stores the message, then pushes `rides.chat` to the other members; history is `GET …/chat` (cursor-paged, newest first).
- 2026-10-29 (P3a) — **Rides routes are one table** (`apps/api/src/modules/rides/routes.js`) that builds both the Express router (all routes on one router, so the OpenAPI test sees them) and the OpenAPI paths. Rider routes refuse `driver`; driver routes need `driver`; admin routes need `admin`; non-members get 404 for groups.
- 2026-10-29 (P3a) — Tests count Prisma queries: `platform/db.ts` emits query events only when `NODE_ENV=test`; `test/rides/dashboard.test.ts` proves the available-groups list and the admin board use the same number of queries for 1 and 6 groups.

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
- 2026-10-29 (P1) — **API is ESM** (`"type": "module"`, TS `module`/`moduleResolution: nodenext`, `verbatimModuleSyntax`). Prisma 7 ships ESM-only and its `prisma-client` generator recommends ESM. **Corrected in P3a:** the plan below (CommonJS code `require()`-ing the platform) only works in the built `dist/`; in `tsx` dev and Vitest it fails, and it would duplicate the Prisma client and SSE broker. Modules now receive the platform through their factory (see the P3a decision above). Original note: **How Module B mounts unchanged in P3:** copy its `.js` files to `apps/api/src/modules/rides/` with a nested `package.json` containing `{"type":"commonjs"}`; the ESM app default-imports the router (`import ridesRouter from './modules/rides/routes/index.js'` binds to `module.exports`); its CJS code can `require()` ESM platform modules (Node ≥22.12 `require(esm)`). Verified in P1 with a throwaway probe (ESM app → CJS router → `require()` of an ESM middleware): 200, no warnings on Node 24. Rule: **no top-level `await` anywhere in `apps/api/src`** (it breaks `require(esm)`). P3 must also copy that folder into `dist/` in `apps/api`'s build script (tsc does not emit `.js` sources; `allowJs` is off).
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

## Module B (rides) after P3a — what P3b must know

Ported from `routepool2-react-` @ `0c57429` into `apps/api/src/modules/rides/` (CommonJS JS, factory `index.js`); provenance in `docs/DISCLOSURES.md`. Backend only; Module B's repo was not modified.

- **Routes** (all under `/api/rides`, full list in `routes.js` and `docs/api/openapi.json`): rider — `GET /me`, `PUT /preferences`, `GET /stats|/history|/busy-routes|/campus-stats|/nodes|/notices`, `POST /requests`, `GET /matches`, `POST /groups/join`, `GET /groups/available|/mine`, `GET /groups/:id`, `POST /groups/:id/join|leave|board|pay|driver-preference|chat|feedback|reports`, `PATCH /groups/:id/meeting`, `GET /groups/:id/driver|chat`; driver — `GET /driver`, `PATCH /driver/vehicle|availability`, `POST /driver/documents`, `POST /driver/vehicle/inspections`, `GET /driver/offers|trips`, `POST /driver/offers/:id/accept|decline`, `POST /driver/trips/:id/heading|board|complete`; admin — `/admin/rides` (+ `cancel`, `unassign-driver`), `/admin/riders` (+ `suspension`), `/admin/reports`, `/admin/notices`, `/admin/vehicles` (+ `documents`, `status`, `service`, `inspections`), `/admin/inspections/:id`, `/admin/drivers`, `/admin/driver-documents/:id`. **Removed:** OTP and staff sign-in (platform login), driver OTP, document download routes (platform `GET /api/files/:id`), raw-body upload (platform `POST /api/files/rides.driver_document` + `POST /driver/documents`), `/dev/age-documents` and `/dev/reset-rides` (mock store gone), `/admin/audit` (platform `GET /api/admin/audit?action=rides.…`), `/health`.
- **Data** (short): users → platform `users` + `rides_profiles`; nodes/edges → `rides_nodes` (PostGIS) / `rides_route_edges` (metres); requests, groups (+ the in-memory driver → `vehicle_id`, `driver_assigned_at`, `eta_minutes`, `driver_female_requested`, `driver_accepted_at`), members, chat → `rides_*`; mock vehicles, inspections, feedback, safety reports, notices → new `rides_*` tables; drivers/documents/trips → `rides_drivers` (PK `user_id`), `rides_driver_documents` (platform file id), `rides_driver_trips`; admin action log → platform `audit_log`; OTP codes dropped.
- **For P3b:** `rides_drivers.kind` has a CHECK of `('auto')` — P3b adds `'carpool'` (a student or mentor offering rides, possibly with `vehicle_id` NULL, so they need a driver row without the `driver` role or a rule for it). The stop graph is still Module B's six stops in a line (`data/stops.js`); Dijkstra (`lib/dijkstra.js`) already works on any edge list. Matching rules live in `lib/matching.js` (`evaluate`) and `config.js`; maximum-detour matching replaces the "one line" checks there and in `services/riders.js` `join` (backbone check). Savings are computed in `services/history.js` (`totals`). Fares: `lib/fare.js` (paise). Assignment: `services/drivers.js` `assignInTx`; the busy rule is in config **and** in the exclusion constraint's `rides_vehicle_busy_until` (change both). Seed: `seed.js` (+ driver accounts in `prisma/seed/platform.ts`, names duplicated from `data/roster.js`).

## Module B (rides) after P3b — what later phases must know

- **New routes** (all under `/api/rides`, in `routes.js` and `docs/api/openapi.json`):
  - shared: `GET /graph`, `GET /route?from&to`;
  - carpool (student or mentor): `POST/GET /carpool/driver`, `POST /carpool/driver/documents`, `POST /offers`, `GET /offers/mine`, `PATCH /offers/:id`, `POST /offers/:id/cancel|depart|complete`, `POST /bookings/:id/accept|decline`;
  - rider: `GET /offers/matches?requestId=`, `GET /offers/:id` (members only), `POST /offers/:id/bookings`, `GET /bookings/mine`, `POST /bookings/:id/cancel`, `GET /stats/me`;
  - admin: `POST /admin/drivers/:id/review`, `GET /admin/stats`.
- **Tables:** `rides_offers` (plan as JSON, plus the plan totals, peak onboard and costs) and `rides_offer_bookings` (unique offer + passenger; planned pickup, in-vehicle metres, cost share, solo fare).
- **Migrations:** `20261029191650_p3b_rides_offers` and `20261029192926_p3b_file_reference_indexes`.
- **Dashboard:** the rider summary's `upcomingRide` is now `{ rideType: 'pool' | 'carpool', id, … }`, totals cover both ride types, and there is a new `carpool: { seatsFilled, costRecoveredPaise } | null`.
- **Seed:** `mentor@` (car, 3 seats) and `student2@` (bike, women-only offer) are approved carpool drivers. Each first seed creates two open offers (Borivali → SPIT at about now + 75 min, auto-accept; Goregaon → SPIT at about now + 50 min, women-only) and one completed ride yesterday with `student@` aboard (Malad → Andheri, share ₹41.21, saved ₹213.13).

## Module A (hub) after P4 — what U2 and P6 must know

- **Routes** (all under `/api/hub`, in `apps/api/src/modules/hub/routes.ts` and `docs/api/openapi.json`):
  - profile: `GET/PUT /me`, `GET /students/:id` (admin, or a mentor the student asked);
  - prep (students): `GET /prep`, `PUT /prep/topics`, `PUT /prep/goal`, `POST /prep/:topicId/increment` (send `Idempotency-Key`);
  - mentors: `GET /mentors` (students), `GET /mentors/:id`;
  - slots (mentors and peer mentors): `GET/POST /slots`, `DELETE /slots/:id`;
  - requests: `POST /requests`, `GET /requests/mine`, `GET /requests/incoming?status=`, `GET /requests/:id`, `POST /requests/:id/accept|decline|complete|cancel`;
  - resources: `GET /subjects`, `GET/POST /resources`, `DELETE /resources/:id`;
  - admin: `GET /admin/mentors`, `GET /admin/resources?status=`.
- **Design screens → endpoints:** Prep tracker → `GET /prep` (`tracks[].topics[]` rows, `dsa` OVERALL card, `week` goal cells "14 of 20 done, 6 left", empty state = `tracks: []` + `untracked` for "Add topics" → `PUT /prep/topics`), "+1" → `POST /prep/:topicId/increment`. Mentors → `GET /mentors` (`rank`, `name`, `department`, `reason`, `expertise`, `score`, `slotsThisWeek`, button from `myRequest`: none → "Request mentor" `POST /requests`; pending → "Requested", click again `POST /requests/:requestId/cancel`; accepted → "Accepted · Mon 15:30" from `startsAt`). Requests (mentor) → `GET /requests/incoming` (`student.name`, `student.year`, `student.branch`, `note`, `createdAt`, `student.dsaPercent` = "PREP 54%"), Accept/Decline. Resources → `GET /resources?q=&subject=` (`title`, `type`, `subject`, `uploader.name`, `sizeBytes`, `createdAt`), upload = `POST /api/files/hub.resource` then `POST /resources`, download `GET /api/files/{fileId}`. Profile → `GET/PUT /me`. Admin "Mentor ranking" → `GET /admin/mentors`; admin Resources → `GET /admin/resources`. Dashboard card → `GET /api/dashboard` hub entry (`kind` student/mentor/admin).
- **Seed results U2 can rely on:** Aarav DSA 118/190 (62 %), 14 of 20 done this week, readiness 31; mentor order Neha 0.6663 (accepted, next Monday 15:30 IST), Sameer 0.5691, Arjun 0.5670, Kavita 0.4234; Neha's incoming: Diya pending (54 %), Kabir pending (31 %), Aarav accepted; six resources, newest first OS, DBMS, CN, DSA, OS, OS.
- **For P6:** `hub_mentor_slots.location_stop_id` (uuid, the type of `rides_nodes.id`) is stored but not validated against rides stops yet — validate it (and offer "ride to my mentor session") in P6. The reason line says "Covers two of your weakest topics: …" when the mentor covers two of three (the design's "your two weakest" would be wrong for Graphs, the third).
- **Activity types:** `hub.request_received`, `hub.request_accepted`, `hub.request_declined`, `hub.request_cancelled`. **Audit:** `hub.resource_deleted` (admin deletes).

## Requests for the other owner

- 2026-10-30 (P4, for Person 2): please review the P4 pull request (stacked on #4, which is stacked on #3: merge those first). Shared areas it changes (all authorised for this phase except the one-line `platform.prisma` back-relation, which Prisma requires):
  - `packages/contracts/` — new `hub/index.ts`, `week.ts` (**use `weekOf()` for any "this week" in C and E**), `activity/hub.ts`, `audit/hub.ts`, real `dashboard/hub.ts`, registry lines;
  - `prisma/schema/platform.prisma` — `hubProfile HubProfile?` on `User`;
  - `prisma/seed/platform.ts` — seven demo accounts.
  - Platform tests `apps/api/test/{audit,roles,dashboard}.test.ts` now derive account counts from `DEMO_ACCOUNTS`.

- 2026-10-30 (P3b, for Person 2): please review PR #4. It is **stacked on #3, so merge #3 first**. Shared areas it changes:
  - `apps/api/src/platform/` — `FilePurpose.inUse` hook in `modules/index.ts`; 409 `FILE_IN_USE` on delete and the sweep skipping claimed files in `files/index.ts`; `server.ts` passes modules to the sweep;
  - `packages/contracts/` — new `rides/offers.ts`, rides activity and audit entries, and the rides dashboard summary shape.
  - Also `eslint.config.js` (`*.mjs` linted without type info), `.gitignore` (`.vitest/`) and `.prettierignore` (`graph.json`).
  - If your module stores file ids, add `inUse` to its purpose so your files can't be deleted from under you.

- 2026-10-29 (P3a, for Person 2): please review the P3a pull request. It changes shared areas: `packages/contracts/` (role `driver`, rides contracts and registry lines), `apps/api/src/platform/` (module factories + `platform.ts`, `pushEvent`, `saveFile`, test-only query events in `db.ts`, login-lockout fix), `prisma/schema/platform.prisma` (role `driver`, two back-relations on `User`), `prisma/seed/platform.ts` (driver accounts), `prisma.config.ts` (shadow database), `eslint.config.js`. **Your modules now default-export a factory** `(platform) => definition` — see "How to plug in your module" below. Also create `universe_shadow` (README step 2) before your first `prisma migrate dev`.

- 2026-10-29 (P2, for Person 2): please review the P2 pull request too (it changes shared areas: `packages/contracts/`, `apps/api/src/platform/`, `prisma/schema/platform.prisma`, `prisma/seed/index.ts`, root `package.json`). Your modules plug in without touching the platform: see "How to plug in your module (backend)" below. Two shared files take one line each when you start: `packages/contracts/src/dashboard/index.ts` (your summary schema) and `packages/contracts/src/audit/index.ts` (your audit actions), via PR.
- 2026-10-29 (P1, for Person 2): please review and approve the P1 pull request: it creates every shared area (`packages/contracts/`, `apps/api/src/platform/`, root `package.json`, `prisma/schema/base.prisma`, `prisma/schema/platform.prisma`, `prisma/seed/index.ts`). To send activity events from C or E: add `packages/contracts/src/activity/observatory.ts` / `exam.ts` (types named `observatory.*` / `exam.*`), spread them into `activityRegistry` in `packages/contracts/src/activity/index.ts` (shared, so via PR), then call `transaction()` or `emit()` from `apps/api/src/platform/activity/service.ts`.

## How to plug in your module (backend)

Everything below happens in your own folders except the one-line registry entries in `packages/contracts` (shared, so by PR). The OpenAPI document is the contract the UI phases build against.

**1. Module factory.** Create `apps/api/src/modules/<id>/index.ts` (`<id>` is `observatory` or `exam`). Its default export is a **factory** that receives the platform object and returns the definition (one pattern for every module; hub, wellbeing and rides follow it). Use the platform only through `platform` — don't import `platform/*` files — so every module shares the app's single Prisma client, SSE broker and audit log:

```ts
import { Router } from 'express';
import type { ModuleFactory } from '../../platform/modules/index.js';

const exam: ModuleFactory = (platform) => {
  const log = platform.logger('exam');           // child logger tagged module=exam
  const router = Router();                        // mounted at /api/exam
  router.get('/flags', platform.requireRole('invigilator', 'admin'),
    platform.http.asyncHandler(async (req, res) => {
      const { user } = platform.authOf(req);      // { id, email, name, role }
      res.json(await platform.prisma.examFlag.findMany({ where: { ownerId: user.id } }));
    }));
  return {
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
};
export default exam;
```
`platform` (type `Platform`, frozen, no secrets): `prisma`, `transaction`, `emit`, `pushEvent` (ephemeral SSE event `<module>.<event>`, not stored), `audit.record`, `authOf`, `requireRole`, `http.ApiError`, `http.asyncHandler`, `paging.{encodeCursor, decodeCursor, olderThan, toPage, newestFirst}`, `files.save` (server-held bytes, for seeds), `contracts`, `config.{nodeEnv, isProduction}`, `logger(moduleId)`. Restart the API: the folder is discovered automatically. A bad definition (or a default export that is not a factory) stops startup with a list of problems. Inside your routes still check finer permissions and ownership; return 404 for other people's records.

**2. Dashboard summary.** Add `packages/contracts/src/dashboard/<id>.ts` exporting a Zod schema (e.g. `ExamDashboardSummary`) and one line in `dashboardSummaryRegistry` in `packages/contracts/src/dashboard/index.ts`. The platform validates your provider's output against it; a mismatch, a throw or more than 1.5 s shows as `error`/`timeout` for your module only. Respect `signal` (pass it to slow work) — it aborts at the deadline.

**3. File uploads.** Add an entry to `filePurposes`:
```ts
{ id: 'exam.clip', mimeTypes: ['video/mp4', 'video/webm'], maxBytes: 200 * 1024 * 1024,
  authorizeRead: (user, file) => user.role === 'admin' || user.role === 'invigilator' }
```
Uploads: `POST /api/files/exam.clip` (multipart, one part named anything). Only roles in your module's `roles` may upload. The real type is detected from the bytes. Download `GET /api/files/:id` (Range supported, so video seeking works), delete `DELETE /api/files/:id` (owner or admin). Keep the returned `FileRecord.id` in your own table. Note the per-user quota (`STORAGE_QUOTA_MB`, default 200) — tell Person 1 if clips need more.

**4. Audit.** Add `packages/contracts/src/audit/exam.ts` with actions named `exam.<verb>` and their metadata schemas (strict; never personal data you don't need), spread into `auditRegistry`. Then, inside the same transaction as the action:
```ts
await platform.transaction(async (tx, emit) => {
  await tx.examFlag.update(...);
  await platform.audit.record(tx, { actorId: user.id, action: 'exam.flag_reviewed', targetType: 'exam_flag',
    targetId: flag.id, metadata: { decision: 'dismissed' }, requestId: req.id });
});
```
**5. Activity events.** As in P1: add `packages/contracts/src/activity/exam.ts`, spread into `activityRegistry`, then `platform.transaction(async (tx, emit) => { …; await emit({...}) })`. You can call `platform.audit.record(tx, …)` in the same callback. For live data that should not be stored (chat, progress), `platform.pushEvent(userIds, 'exam.progress', data)` after the commit.

**6. OpenAPI.** Describe each route in your definition's `openapi` field, paths relative to your base path, using your contracts' Zod schemas:
```ts
openapi: { '/flags': { get: { summary: 'List flags', requestParams: { query: PageQuery },
  responses: { '200': { description: 'OK', content: { 'application/json': { schema: pageOf(ExamFlag) } } } } } } }
```
Then run `npm run api:docs` and commit `docs/api/openapi.json`. `npm test` fails if a mounted route is undocumented or the committed file is stale. Browse it at http://localhost:4000/api/docs while `npm run dev` runs.

**7. Tests.** Use `apps/api/test/helpers.ts`: `login(email)` and `as(session).get/post/patch/delete(url)` (cookie and CSRF header set). Create the app with your module: `createApp({ modules: await loadModules() })` (optionally `loadModules({ platform: createPlatform({ ...overrides }) })`). Rides tests (`apps/api/test/rides/`) show concurrency tests, SSE checks and query counting.

## Audit findings for P8

From the independent P1–P2 verification in P3a (the one high finding, the login-lockout race, was fixed in P3a):

- LOW — `apps/api/src/platform/activity/routes.ts:120-163`: an SSE stream whose client disconnects before the handler attaches `req.on('close')` stays registered (heartbeat keeps querying) until the session ends or it is evicted as the 6th stream. Fix: return early if `req.destroyed`/`res.writableEnded`, listen on `res.on('close')`, check `closed` in the heartbeat.
- LOW — `apps/api/src/platform/http.ts:52-53`: every `ZodError` becomes 400 `VALIDATION_FAILED`, including server-side checks (audit metadata `audit/index.ts:48`, activity payloads `activity/service.ts:57`); such bugs reach users as 400 with schema details and are never logged. Fix: request parsing throws `ApiError(400)` itself; other ZodErrors go to the 500 path.
- LOW — `prisma/schema/migrations/20261029160836_p2_platform_services/migration.sql:98-100`: the append-only trigger blocks UPDATE/DELETE on `audit_log` but not TRUNCATE (test setup relies on TRUNCATE). Fix: a BEFORE TRUNCATE statement trigger that test setup disables, or document the limit.
- LOW — `apps/api/src/platform/auth/sessions.ts:101-104`: `deleteDeadSessions` filters `sessions.last_seen_at`, which has no index; `apps/api/src/platform/audit/index.ts:72`: a `targetId`-only filter can't use `audit_log_target_idx` (leads with `target_type`).
- LOW — routes that ignore unknown query/body fields instead of rejecting them: `GET /api/auth/me`, `/api/activity/unread-count`, `/api/activity/stream`, `/api/dashboard`, `/api/modules`, `POST /api/activity/read-all`, `/api/auth/logout`.
- LOW — `docs/sessions/P1.md` §9 still says a 429 lockout appears only for existing accounts (fixed in P2).

## Open questions

- decided: `platform.prisma` gets one line (`hubProfile HubProfile?` on `User`) although it was not on P4's authorised list — Prisma rejects a relation without its back-relation, and the prompt asks for `hub_profiles.user_id` FK users; every other hub table references `hub_profiles` instead (P4, unattended).
- decided: `GET /api/hub/students/:id` added so the privacy rule ("a mentor sees a student only through a request; admins see all") has an endpoint and a test (P4, unattended).
- decided: a requested slot that was taken is 409 `SLOT_TAKEN` on accept (the mentor picks another with `slotId`), not swapped for another time silently (P4, unattended).
- decided: either the student or the mentor can cancel; complete only after the session started; increments outside 0..total are 409, not clamped (P4, unattended).
- decided: "this term" = Jan–Jun or Jul–Dec IST; "near capacity" = ≥ 80 % of capacity; "new resources" = last 7 days by anyone (P4, unattended).
- decided: admin mentor ranking uses per-topic weakness 1 − Σ solved ÷ Σ total over all students, and the union of students' interests (P4, unattended).
- decided: search matches word prefixes with the `simple` configuration over words as written plus English stems; a query of only punctuation returns nothing (P4, unattended).
- decided: prep routes are for role student (peer mentors are students); `GET /mentors` is for students; admins use `/admin/mentors` and `GET /mentors/:id` (P4, unattended).
- P4: the readiness weights (0.5/0.2/0.15/0.1/0.05) and the catalogue's problem counts are judgement calls — confirm with the team before the demo.
- P3b: should pooled autos also pool riders whose routes share a stretch and then split (as carpool offers do)? Left out on purpose (user: don't rework RoutePool's backend), so today they don't.
- P3b: should a carpool driver also need the auto-style inspection certificate? Today carpool drivers upload the same two documents as auto drivers (licence and inspection certificate), as the prompt asked.
- P3a: Module B's rider payment is a recorded step only (no gateway) — confirm that is enough for the demo.
- P3a: the two state-demo drivers (Kiran Pawar, Ganesh Salunkhe) have no vehicle (the roster has seven autos). Give them vehicles if the demo needs them on the road.
- GitHub usernames of both people (for CODEOWNERS): `.github/CODEOWNERS` has placeholders `@PERSON1_GITHUB` and `@PERSON2_GITHUB`. The repo is `github.com/namishj23/universe` (private), so Person 1 is probably `namishj23`: confirm.
- Which laptop runs the demo? Person 1's Mac already has PostgreSQL 18.6 + PostGIS 3.6.4 (Homebrew) with `universe` and `universe_test` set up.
- `npm run db:test:reset` has still not been run (Prisma 7 blocks `migrate reset` from AI agents unless the user consents). Run it once by hand to confirm it works.
- P2: is 200 MB per user enough for exam clips (Person 2)? `STORAGE_QUOTA_MB` is one setting for everyone.

## Session log (newest first)

- 2026-10-30 01:52–02:35 — P4 Module A: Student Hub backend (Person 1, Opus 5.5 / high, unattended).
  - 9 `hub_` tables (2 migrations), contracts (hub schemas, shared IST week, activity, audit, dashboard).
  - Profiles with privacy, prep tracker (row-locked increments with Idempotency-Key, weekly goal and pace, readiness, 30-day series), mentor ranking in one query, slots with an exclusion constraint, row-locked accept, resource repository with full-text + uploader-name search and file-in-use protection, admin views, dashboard summary, seed with the design's data and six padded real files.
  - 242 API tests (58 new hub tests) + 1 web test; EXPLAIN shows both search paths on their GIN indexes.
  - Branch `p1/p4-hub`, PR stacked on #4. Full report: `docs/sessions/P4.md`. Next: P5.
- 2026-10-30 00:40–01:20 — P3b Rides: carpool offers, campus graph, detour matching, savings, backend only (Person 1, Opus 5.5 / high).
  - Files-in-use hook: 409 on delete, and the sweep skips claimed files.
  - 22-stop branching graph from OSRM and Nominatim, plus estimated campus paths; heap Dijkstra; LRU path cache; validation.
  - Carpool drivers (apply, documents, admin review); offers and bookings with row-locked seat safety; O(k²) detour insertion with seat, delay and ride-length limits; RoutePool's 0.7/0.3 score; per-segment cost split in paise; stats for both ride types; dashboard update.
  - RoutePool's pooled backend left as ported (user decision).
  - 177 API + 1 web tests. 200 open offers matched in a median of 23 ms.
  - Branch `p1/p3b-rides-offers`, PR #4 stacked on #3. Full report: `docs/sessions/P3b.md`. Next: P4.
- 2026-10-29 23:18–2026-10-30 00:30 — P3a Module B onto the platform, backend only (Person 1, Opus 5.5 / high). P1–P2 verified from a fresh clone (all green; one high finding — login lockout race — fixed with a test); module factories with one frozen `platform` object for every module; role `driver`; Module B ported as the `rides` module on the shared database (15 `rides_*` tables, 56 routes) with row-locked joins, atomic driver assignment/accept, paise fares, exclusion constraint for busy vehicles, audit + activity, `rides.chat` over SSE, file purposes, dashboard summary, OpenAPI, seed; Module B's check scripts ported to Vitest. 146 API + 1 web tests. Branch `p1/p3a-rides-move-in`, PR to `main`. Full report: `docs/sessions/P3a.md`. Next: P3b.
- 2026-10-29 21:25–22:07 — P2 Platform services, backend only (Person 1, Opus 5.5 / high). Backend-first switch (phase table, CLAUDE.md rule, P1 screens removed), P1 review fixes (email-HMAC login throttle, index guard test), module registry and discovery, dashboard API, admin users with last-admin lock, change password + forced change, append-only audit log, file storage (busboy + file-type, quota, Range), OpenAPI 3.1 contract with `npm run api:docs`. 95 API + 1 web tests. Branch `p1/p2-platform-services`, PR to `main`. Full report: `docs/sessions/P2.md`. Next: P3 Module B backend.
- 2026-10-29 20:30–21:10 — P1 Platform core (Person 1, Opus 5.5 / high). Monorepo, DB setup, contracts, auth/sessions/CSRF/roles, transaction-safe activity feed with SSE, seed, minimal web, 33 tests, README setup. Branch `p1/p1-platform-core`, PR to `main`. Full report: `docs/sessions/P1.md`. Next: P2 app shell.
