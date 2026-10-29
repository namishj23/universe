# Session P3a: Module B (Rides) onto the platform, backend only

## 1. Session details
- Owner: Person 1
- Model / effort: Opus 5.5 (claude-opus-5-5), high
- Started / finished: 2026-10-29 23:18 IST / 2026-10-30 00:35 IST, duration about 77 minutes
- Branch: `p1/p3a-rides-move-in` · Commits: 8 (including this report) · Pull request: https://github.com/namishj23/universe/pull/3

## 2. Summary
Module B (RoutePool, `routepool2-react-` @ `0c57429`) now runs inside UniVerse as the `rides` module. It uses the shared PostgreSQL database and the platform's users, sessions, roles, CSRF, audit log, activity feed and file storage. Drivers are platform users with the new role `driver`. The mock store, emailed codes, JWTs and staff passwords are gone. Every Module B feature works on the real database, including the driver portal: 56 routes, 15 `rides_*` tables.

Before building, P1 and P2 were verified from a fresh clone. The one high finding was a login lockout that parallel attempts could bypass; it is fixed and tested.

Rides reaches the platform through a factory. CommonJS cannot `require()` the TypeScript platform in dev or tests, so every module now default-exports `(platform) => definition`. The phase is complete.

## 3. What was done
1. Step 0: verified P1–P2 from a fresh clone of `main` (build, typecheck, lint, tests, audit, migration status and drift) and read every platform, contracts and Prisma file against the quality bar (independent agent). Fixed the one high finding (login-lockout race) with a regression test; listed 6 low findings in PROGRESS.md "Audit findings for P8".
2. Step 1: route inventory (66 Module B routes, including `/health` and the dev reset → 56 rides routes, removed routes with reasons), data inventory (every mock and Prisma store → its `rides_*` table) and the list of mock-only branches (in the approved plan and PROGRESS.md).
3. Step 2: `apps/api/src/modules/rides/` (`{"type":"commonjs"}`). `index.js` exports a factory returning the `ModuleDefinition` (`id: 'rides'`, `order: 20`, roles student/mentor/driver/admin, router, dashboardSummary, seed, openapi, two file purposes). The build copies the folder to `dist/`. Module B's own Prisma client, JWT, auth/admin middleware, error handler, mailer, OTP, env, db and mock store were not ported. Zod 4 strict schemas live in `packages/contracts/src/rides/`. Tariff and matching settings are a validated, frozen config object in integer units.
4. Platform (on request): one module pattern. Every module default-exports `(platform) => definition`. `platform` is a typed, frozen object built once at startup (prisma, transaction/emit, pushEvent, audit.record, authOf/requireRole, paging, files.save, contracts, config getters, per-module logger; no secrets). Hub and wellbeing were converted, and tests can pass `createPlatform(overrides)`.
5. Step 2b: role `driver` (contracts, enum migration, guards, seed). Driver OTP, pattern, demo code and JWT removed. Driver routes need `driver`, rider routes refuse it, admin routes need `admin`. `GET /api/modules` for a driver returns only `rides`. Seeded 7 roster drivers (with vehicles and approved documents, online), one driver with a licence expiring in ~10 days, and one with no documents.
6. Step 3: `prisma/schema/rides.prisma` with 15 `rides_` tables. Profiles are keyed by platform user, with the rider code from `crypto.randomInt`. Stops use a PostGIS `geography(Point,4326)` column with a GIST index. Vehicles, inspections, feedback, safety reports and notices are new tables. Drivers, documents and trips use platform users and file ids. The group's driver is `vehicle_id` + `driver_assigned_at` + `eta_minutes`. CHECK constraints sit on enum-like columns, uniques on (group,user) and feedback (group,user), and an exclusion constraint stops a vehicle holding two live assignments. Every FK and filter/sort column is indexed. Shadow database configured, no drift.
7. Step 4: seat race fixed (group row lock inside the transaction). Every multi-step write is one transaction with its audit entry and events. Atomic driver assignment and accept. Non-member 404. Rides-only suspension. Gender only returned to its owner. `timestamptz(3)` in UTC. Money is integer paise with largest-remainder splits, and payout plus fee equals the fare. Lists are batched (no N+1).
8. Step 5: `pushEvent` (ephemeral SSE events) added to the platform; chat is stored, then pushed as `rides.chat`. 15 activity event types and 12 audit actions registered in contracts.
9. Step 6: file purposes `rides.driver_document` (PDF/JPEG/PNG, 5 MB, driver who uploaded + admins) and `rides.inspection_photo` (JPEG/PNG/WebP, 5 MB, admins only). Inspections store four file ids, each checked for existence, owner and purpose.
10. Step 7: dashboard summary (rider: upcoming ride, rides completed, metres shared, paise saved; driver: online, document status, trips today, payout today) with its schema registered in contracts. Every rides route is described in OpenAPI, generated from the same route table as the router; `npm run api:docs` committed.
11. Step 8: idempotent rides seed: 6 stops with OSRM coordinates and distances, 7 vehicles with Module B's document offsets, driver rows and documents, profiles for the demo users (`student2` female + women-only), and two forming groups plus one open request relative to now.
12. Step 9: Module B's `checkGrouping`, `checkGenderAndAccess`, `checkAdmin`, `checkVehicles` and `checkDriverPortal` ported to Vitest, plus unit tests and the 15 scenarios (39 rides tests in 7 files).
13. Docs: `docs/DISCLOSURES.md` (reused code), PROGRESS.md (phase rows, decisions, corrected P1 note, plug-in guide, audit findings, P3b notes, session log), README (shadow database setup, driver demo accounts, Implemented vs simulated).

## 4. Issues hit
| Issue | Root cause | Fix | Files |
| --- | --- | --- | --- |
| P1's plan for CommonJS (`require()` the ESM platform) fails in Vitest and `tsx` with `Cannot find module …/db.js` | Native `require` doesn't map `.js` to `.ts`, and Vitest runs CJS files with Node's loader; even in `dist/` it would load a second Prisma client and SSE broker | Module factories: the platform passes one frozen `platform` object to every module | `apps/api/src/platform/modules/{index,platform}.ts`, all module `index` files |
| Login lockout bypassed by parallel wrong passwords (30 of 30 verified) | Lock read before Argon2, failure counted after, in separate transactions | Reserve the attempt under a row lock before verifying; 6th reservation locks | `apps/api/src/platform/auth/throttle.ts`, `routes.ts`, `test/auth.test.ts` |
| First reservations raced on insert (409) | Prisma `upsert` is select-then-insert | `INSERT … ON CONFLICT DO NOTHING` (tagged template) | `throttle.ts` |
| Rides migration: `type "geography" does not exist` | Prisma's migration connection pins `search_path` to `public` | `SET search_path TO public, extensions;` at the top of the migration | `prisma/schema/migrations/20261029180948_p3a_rides/migration.sql` |
| `migrate dev` still failed on the shadow database | `extensions` schema in `universe_shadow` was created by the superuser (setup steps), so `universe` couldn't use it | `ALTER SCHEMA extensions OWNER TO universe` (as on the other two databases); README setup now creates it with `AUTHORIZATION universe` | `README.md` |
| Exclusion constraint: `functions in index expression must be marked IMMUTABLE` | `timestamptz + interval` is STABLE | IMMUTABLE wrapper `rides_vehicle_busy_until(pickup)` (minutes only) | rides migration |
| `prisma migrate dev` doesn't regenerate the client in Prisma 7 (typecheck errors after the enum change) | Prisma 7 behaviour | Ran `prisma generate` (postinstall does it on `npm ci`) | — |
| OpenAPI test only sees routes on the top-level router | It walks `router.stack` one level | All rides routes registered on one router from one table, which also builds the OpenAPI paths | `apps/api/src/modules/rides/routes.js`, `index.js` |
| Tests hit the 10/min login limiter | Many sign-ins through one app instance | One app instance per test session (same modules, database, broker) | `apps/api/test/rides/helpers.ts` |
| Announcement test expected 5 recipients | Seed now has 14 accounts | Count from `DEMO_ACCOUNTS`, plus a drivers-only check | `apps/api/test/roles.test.ts` |
| A boarded rider stayed blocked after the driver completed the trip | Module B only released at pickup + 30 min | Completed groups no longer block | `services/core.js` |

## 5. Changed vs the prompt
| Prompt asked for | What was done instead | Why |
| --- | --- | --- |
| Rides requires the ESM platform modules from CommonJS "as P1 proved" | Factory injection: `module.exports = (platform) => definition`, applied to every module (user decision) | `require()` fails in dev and tests, and would duplicate the Prisma client and SSE broker |
| "4 riders join a 3-seat group: exactly 3 succeed, the 4th gets 409, the group shows 3 members" | A group always starts with its founder, so two tests: 4 riders racing for the last 2 seats (exactly 2 succeed, 2 get 409, 3 members) and 4 riders for the last seat (exactly 1 succeeds) | No group with 3 free seats can exist; the invariant (never more than 3) is what's tested |
| "Two drivers accepting the same group at once: exactly one wins" | An offer goes to one vehicle at a time (Module B's design), so the test sends the assigned driver's accept twice plus another driver's accept at once: exactly one 200, two 409 | Faithful port of Module B's offer model; the accept is a conditional update either way |
| Suspended rider refused "with Module B's message" | New message: "Your rides access is suspended: <reason>. Contact the transport office." (403 `RIDES_SUSPENDED`) | Module B stored suspensions but never enforced them; there was no message to reuse |
| `rides_vehicles` holds "driver name, driver gender, rating" (Step 3, first bullet) | Name comes from the platform user, gender and rating are on `rides_drivers` | The prompt's later bullet: driver facts live on the driver, vehicle facts on the vehicle |
| Driver document files and inspection photos as file ids | Stored as uuids **without** an FK to `files` | The platform sweep hard-deletes soft-deleted files after 24 h; an FK would block it |
| Seed "one driver whose licence is expiring soon and one with no documents" | Both added as extra accounts **without a vehicle** | Only 7 autos exist; they show the verification states |
| `PUT /auth/me/preferences` → `PUT /api/rides/preferences` | Done; also `GET /auth/me`'s rides part → `GET /api/rides/me` | Rider code and preferences are rides data |
| Legacy `POST /groups/:id/join` for an open request id | Removed for request ids (still works for group ids) | It pulled another student's request into a group without their consent |
| `POST /drivers/me/dev/age-documents` | Removed | Seed shows the expiry states; tests change dates in the database |
| Extra | `POST /api/rides/driver/vehicle/inspections` (driver files their own inspection) | Module B's comment says staff filed inspections only because drivers had no login |

## 6. Decisions made
- One module pattern (factories with a frozen `platform` object), for every module; P1's CommonJS note corrected.
- Login lockout reserves attempts under a row lock before the password check.
- Role `driver`; drivers are platform users.
- Every person reference in rides points at `rides_profiles(user_id)`; platform `User` gets two back-relations only.
- Exclusion constraint (`btree_gist`) for "a vehicle can't hold two live assignments", because the busy rule is time-based; row locks make it a backstop.
- Migration `SET search_path` for PostGIS; shadow database `universe_shadow` with `extensions` owned by `universe`.
- Money in integer paise: one half-up rounding per stop, telescoping segments, largest remainder, payout + fee = fare. Distances in integer metres.
- Driver assignment ports both Module B flows; only online, verified drivers with roadworthy, non-busy vehicles are assignable; the seed puts roster drivers online.
- Behaviour changes: own-request-only joins, enforced suspension, completed rides release riders, paged lists, top-N matches.
- Chat through `pushEvent` (ephemeral `rides.chat`), never the feed.
- One route table builds the router and the OpenAPI paths.
- Query events only in tests, for N+1 checks.
- File ids without FK to `files`.

All are recorded in PROGRESS.md with reasons.

## 7. Files
- Created: `apps/api/src/modules/rides/{package.json,index.js,config.js,routes.js,seed.js}`, `apps/api/src/modules/rides/data/{stops.js,stopEdges.json,roster.js}`, `apps/api/src/modules/rides/lib/{dijkstra,fare,genderRules,matching,stopMatcher,vehicleStatus,verification}.js`, `apps/api/src/modules/rides/services/{core,riders,drivers,vehicles,admin,history}.js`, `apps/api/src/platform/modules/platform.ts`, `apps/api/test/rides/{helpers.ts,lib.test.ts,grouping.test.ts,gender.test.ts,drivers.test.ts,admin.test.ts,dashboard.test.ts}`, `packages/contracts/src/rides/index.ts`, `packages/contracts/src/{activity,audit,dashboard}/rides.ts`, `prisma/schema/rides.prisma`, `docs/DISCLOSURES.md`, `docs/sessions/P3a.md`
- Changed: `apps/api/src/platform/{modules/index.ts,activity/broker.ts,auth/routes.ts,auth/throttle.ts,db.ts,files/index.ts}`, `apps/api/src/server.ts`, `apps/api/src/modules/{hub,wellbeing}/index.ts`, `apps/api/package.json` (build copies module JS), `apps/api/test/{auth,modules,roles}.test.ts`, `apps/api/test/{fixtures,helpers}.ts`, `packages/contracts/src/{role.ts,index.ts,activity/index.ts,audit/index.ts,dashboard/index.ts}`, `prisma/schema/platform.prisma`, `prisma/seed/platform.ts`, `prisma.config.ts`, `eslint.config.js`, `docs/api/openapi.json`, `PROGRESS.md`, `README.md`
- Deleted: none
- Database migrations: `20261029180206_p3a_driver_role` adds `driver` to enum `role` (before `admin`). `20261029180948_p3a_rides` creates the 15 `rides_*` tables, their FKs and indexes (including the GIST index on `rides_nodes.geom`), the CHECK constraints, extension `btree_gist` in schema `extensions`, function `rides_vehicle_busy_until`, and exclusion constraint `rides_groups_vehicle_busy`.

## 8. Tests and checks
| Check | Command | Result |
| --- | --- | --- |
| Fresh clone of the branch | `git clone --branch p1/p3a-rides-move-in …` (env files copied), then `npm ci && npm run build && npm run typecheck && npm run lint && npm test` | All pass: API 19 files / 146 tests, web 1 / 1 |
| Build | `npm run build` | Pass (contracts, api incl. `dist/modules/rides`, web) |
| Typecheck | `npm run typecheck` | Pass, 0 errors |
| Lint | `npm run lint` | Pass (ESLint + Prettier) |
| API tests | `npm test` (`@universe/api`) | 19 files, 146 tests passed, 0 failed: 107 in the platform suites (P1–P2 tests, the new lockout and factory tests, and module/role/file tests that now include the real rides module) and 39 in `test/rides/` (lib 9, grouping 9, gender 4, drivers 6, admin 8, dashboard 3) |
| Web tests | `npm test` (`@universe/web`) | 1 file, 1 test passed |
| Production audit | `npm audit --omit=dev` | 0 vulnerabilities |
| Migrations | `npx prisma migrate status` (dev and `ENV_FILE=apps/api/.env.test`) | 5 migrations, up to date on both |
| Drift | `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema --script --exit-code` (dev and test); `--from-migrations prisma/schema/migrations` | Empty, exit 0 on all three |
| Forbidden names | `git grep -i -E "USE_MOCK_DB\|mockStore\|driverMockStore\|send-otp\|verify-otp\|DRIVER_DEMO_OTP\|jsonwebtoken\|ADMIN_EMAILS\|nodemailer" -- apps packages prisma` | No matches |
| Built server discovers rides | `npm run build`, then `PORT=4123 NODE_ENV=production node --env-file-if-exists=.env dist/server.js` (what `npm start` runs) | Log `"modules":["hub","rides","wellbeing"]`, `/api/health/ready` `{"status":"ok"}`, clean SIGTERM shutdown |
| OpenAPI | `npm run api:docs`; `test/openapi.test.ts` | Committed file current, every route documented, valid 3.1 |
| Seed idempotent | `npm run db:seed` twice | Same counts (6 stops, 5 edges, 7 vehicles, 9 drivers, 16 documents, 2 groups, 3 requests) |
| Module B repo unchanged | `git -C ~/Documents/"Mini project (React)"/routepool2-react- status` / `log -1` | Clean, HEAD `69a08ea` (as at session start; the merge the prompt mentioned had already been committed upstream; `backend/` identical to `0c57429`) |

**P1–P2 verification** (fresh clone of `main` @ `3c27d87`, before any P3a change; independent agent):
| Check | Result |
| --- | --- |
| `npm ci` / `npm run build` / `npm run typecheck` / `npm run lint` | Pass |
| `npm test` | API 13 files, 95 tests passed; web 1 passed |
| `npm audit --omit=dev` | 0 vulnerabilities |
| `prisma migrate status` + `migrate diff` (dev and test) | Up to date, no drift |
| Code review vs quality bar | 1 HIGH, 0 critical, 6 LOW |

Findings: **HIGH**: the login lockout could be bypassed by concurrent attempts (`platform/auth/routes.ts:66-88`, `auth/throttle.ts:14-35`); reproduced with 30 parallel wrong passwords (all verified, none got 429). This is fixed in commit `eb31dbf`, with a test that fails on the old code and passes on the new. The claims in P2.md §6/§9 ("15-minute lock at 5") and P1.md §6 now hold under concurrency. **LOW** (PROGRESS.md "Audit findings for P8"): SSE stream left registered after an early disconnect; internal ZodErrors reported as 400 and not logged; TRUNCATE not blocked on `audit_log`; no index for `sessions.last_seen_at` or `targetId`-only audit filters; some routes ignore unknown query/body fields; P1.md §9 enumeration note out of date. Checked and found correct: auth/role/ownership on every route, CSRF on unsafe methods, tagged-template SQL only, no secrets in logs or responses, strict Zod on used inputs, cursor paging, indexes, no N+1, transactions with audit, upload handling, shutdown.

**EXPLAIN ANALYZE** (dev database with 20,000 synthetic groups, inserted and rolled back in one transaction; script and full output in the session scratchpad):
```
1. Matching candidates (services/riders.js findMatches)
 Nested Loop Anti Join (actual time=0.016..0.016 rows=0)
   ->  Bitmap Index Scan on rides_groups_status_pickup_at_id_idx
         Index Cond: status='forming' AND pickup_at BETWEEN now()+50m AND now()+70m
   ->  Index Scan using rides_group_members_user_id_joined_at_idx (never executed)
 Execution Time: 0.033 ms
2. Available groups page (services/riders.js listAvailable)
 Limit -> Nested Loop Semi Join
   ->  Index Scan using rides_groups_pickup_at_id_idx  Index Cond: pickup_at >= now()
         SubPlan: Index Scan using rides_group_members_user_id_joined_at_idx
   ->  Index Only Scan using rides_group_members_group_id_user_id_key (Index Cond: group_id = g.id)
 Execution Time: 0.121 ms
3. Admin rides board page (services/admin.js rides)
 Limit -> Nested Loop Semi Join
   ->  Index Scan using rides_groups_pickup_at_id_idx  Index Cond: pickup_at >= now()
   ->  Index Only Scan using rides_group_members_group_id_user_id_key
 Execution Time: 0.080 ms
```
**Query counts:** `test/rides/dashboard.test.ts` shows `GET /groups/available` and `GET /admin/rides` issue the same number of queries for 1 and 6 groups.

## 9. Security and performance review
- **Validation:** every rides body, query and param is parsed with a strict Zod 4 schema from contracts (unknown fields → 400), including empty-body actions (`NoBody`) and no-query GETs (`NoQuery`). Uploads go through the platform (magic-byte type check, size limits, quota, rate limit); a renamed executable gets 415 (tested).
- **SQL:** Prisma everywhere; raw SQL only as tagged `$queryRaw`/`$executeRaw` (PostGIS reads and writes, row locks, aggregates). No `Unsafe` calls. The tagged-template payout sum takes its percentage as a parameter.
- **Roles and ownership:** an outer guard admits only `rides` roles. Each route has its own guard (rider routes refuse drivers; driver and admin routes are separate). Every group route checks membership, and a non-member gets 404 (tested for detail, chat, driver, pay, board, leave). Drivers see only offers and trips for their own vehicle, with riders by first name. Driver documents are readable only by their driver and admins, inspection photos by admins only (tested). A file must be the caller's own, with the right purpose, before it is attached.
- **Privacy:** gender, women-only and driver preference appear only in `/me` and `/preferences` for their owner. A test scans match, group, member, chat, list, history, driver card, admin board, admin riders and activity payloads for gender fields and values.
- **CSRF and sessions:** unchanged platform guards cover every unsafe rides route (tests send the token; the guard runs app-wide).
- **Rate limits:** login and uploads (platform). The lockout race is fixed.
- **Errors:** the platform error format, with codes such as `RIDES_SUSPENDED`, `NO_DRIVER_AVAILABLE`, `NO_MATCHING_DRIVER`, `ALREADY_IN_GROUP` and `GROUP_ACCESS`. Rides never logs bodies.
- **Secrets:** `platform` holds none. Module B's `.env` was never opened. Tariff values are constants from `.env.example`.
- **Performance:** all FKs and filter/sort columns indexed (EXPLAIN above). Every list is cursor-paged (default 20, max 100); matches are top-N and busy routes top-5, both bounded. Members, profiles, requests, vehicles and documents are loaded in batched queries (query-count test). The stop graph is 2 queries per request.
- **Reliability:** every multi-step write is one transaction, with the audit entry and activity events inside it (events pushed after commit). Unique and exclusion constraints back the app checks. Concurrency is tested for seats, driver assignment and accept.
- **Live updates:** SSE only; chat pushes after commit; no polling.
- **Honesty:** payment and ETA are simulated and labelled so in the README table.
- **Not met / noted:** the six LOW P1–P2 findings are deferred to P8 as instructed. The rides module is untyped JavaScript (by design), so type safety comes from contracts parsing at the edges and the tests.

## 10. Done checklist
- [x] `npm ci && npm run build && npm run typecheck && npm run lint && npm test` all pass; `npm audit --omit=dev` clean.
- [x] Forbidden-names `git grep` in `apps/`, `packages/`, `prisma/` finds nothing.
- [x] `docs/DISCLOSURES.md` records the source repository, commit `0c57429` and its authors.
- [x] Every Module B route is working under `/api/rides/...` with tests, or listed as removed with the reason (PROGRESS.md "Module B (rides) after P3a").
- [x] `prisma migrate diff` shows no drift; EXPLAIN for the three queries is in §8.
- [x] `npm run build && npm start` discovers the rides module from `dist`.
- [x] `docs/api/openapi.json` is current (test enforces it).
- [x] Module B's repository is unchanged. It was already clean at `69a08ea` when the session started (no unmerged file then either); it is still clean with no new commits.
- [x] Branch pushed; pull request #3 open to `main`.

## 11. Still open
| Item | Owner | Blocks what |
| --- | --- | --- |
| Review and merge PR #3 (shared areas: contracts, platform, platform.prisma, seed, config) | Person 2 | Person 2's modules (must use the factory pattern) |
| Create `universe_shadow` with `extensions` owned by `universe` on Person 2's laptop | Person 2 | `prisma migrate dev` |
| Six LOW P1–P2 findings | Person 1 (P8) | Hour 9 audit |
| Kiran Pawar / Ganesh Salunkhe have no vehicle (state demo only) | Person 1 (P6) | Nothing; give them vehicles if the demo needs them driving |
| Payment is a recorded step only | Team | Nothing for the demo; confirm wording |
| Carpool drivers (`kind = 'carpool'`), campus graph, detour matching | Person 1 (P3b) | P3b |

## 12. How to verify by hand
```bash
cd ~/Desktop/"mini project hackathon"
git checkout p1/p3a-rides-move-in && npm ci && npm run db:deploy && npm run db:seed
npm run dev    # API on :4000
```
In another terminal (replace PASSWORD with `SEED_DEMO_PASSWORD`):
```bash
B=http://localhost:4000/api
login() { curl -s -c "$1.jar" -H 'content-type: application/json' -d "{\"email\":\"$2\",\"password\":\"PASSWORD\"}" $B/auth/login | sed -E 's/.*"csrfToken":"([^"]+)".*/\1/' > "$1.csrf"; }
login s student@universe.test; login m mentor@universe.test; login d priya.more@drivers.universe.test
curl -s -b s.jar $B/rides/groups/mine | head -c 400; echo          # the seeded Azad Nagar -> Ghatkopar group
curl -s -b d.jar $B/modules; echo                                    # [{"id":"rides",...}] only
curl -s -b d.jar $B/rides/me -o /dev/null -w '%{http_code}\n'        # 403: drivers can't use rider routes
GID=$(curl -s -b s.jar $B/rides/groups/mine | sed -E 's/.*"items":\[\{"id":"([^"]+)".*/\1/')
curl -s -b s.jar $B/rides/groups/$GID/driver; echo                   # a driver card (same for every member)
curl -s -b s.jar -H "x-csrf-token: $(cat s.csrf)" -H 'content-type: application/json' \
  -d '{"message":"On my way"}' $B/rides/groups/$GID/chat; echo       # 201; other members get SSE event rides.chat
```
Then open http://localhost:4000/api/docs: the `rides-*` tags list all 56 routes. Run `npm test` to see the 146 API tests (including the seat race and driver accept race) pass.

## 13. Next step
P3b: Rides driver offers, campus graph, detour matching and savings (Opus 5.5 / high). It must know the following:
- `rides_drivers.kind` is CHECK `('auto')`; add `'carpool'` there and in contracts. A carpool driver is a student or mentor, not role `driver`, possibly with no `vehicle_id`.
- Matching rules: `lib/matching.js` `evaluate` and the backbone check in `services/riders.js` `join`. Replace the "one auto on one line" rules with maximum-detour rules.
- The stop graph is still six stops in a line (`data/stops.js`, seed); Dijkstra already handles any graph.
- Savings: `services/history.js` `totals`. Fares: `lib/fare.js` (paise).
- The 30-minute busy rule is in `config.js` **and** in the migration's `rides_vehicle_busy_until`; change both together.
- Modules use the platform only through `platform` (factory).
