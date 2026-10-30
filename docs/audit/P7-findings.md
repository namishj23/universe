# P7 — Independent audit (Person 1's scope), read-only

Branch `p1/p7-audit` from `fb24636` (P6 HEAD, contains P1–P6 and U1). No application code was changed. All checks ran against `universe_test` (port 4199 for the running API); nothing touched `universe`. Evidence (logs, EXPLAIN output, repro scripts, probe tests) is in `docs/audit/P7-evidence/`.

How the repros were run: the probe tests in `docs/audit/P7-evidence/probes/` (stored as `*.ts.txt` so the repo's lint does not pick up evidence files; drop the `.txt` to run them) were copied into a temporary fresh clone at `apps/api/test/p7/` and run with `npx vitest run test/p7/<file>`. The repro scripts in `repro/` are stored the same way (the vitest config and global setup refuse any database not named `*_test`). Each probe asserts the **safe** behaviour, so a failing probe confirms the finding. The output is in `probe-*.log`.

## Summary

| Severity | Count | IDs | P8 status |
| --- | --- | --- | --- |
| Critical | 0 | — | — |
| High | 6 | P7-001 … P7-006 | all fixed |
| Medium | 11 | P7-007 … P7-017 | P7-008 fixed; the rest open (deferred) |
| Low | 11 | P7-018 … P7-028 | P7-023 fixed; the rest open (deferred) |

"Confirmed" = reproduced by a probe or script in `P7-evidence/`. "Code-verified" = read in the code and traced by hand, not executed.

### Gate results (fresh clone of `p1/p7-audit`, `.env` files copied in, never committed)

Script: `P7-evidence/gates.sh`. Logs: `P7-evidence/gates/`.

| Gate | Command | Result |
| --- | --- | --- |
| Install | `npm ci` | pass (916 packages; npm 11 skipped dependency install scripts, see P7-026) |
| Build | `npm run build` | pass |
| Typecheck | `npm run typecheck` | pass |
| Root project typecheck | `npx tsc -p tsconfig.json --noEmit` | **fail**: `prisma.config.ts(25,3)` TS2375 (P7-025, known from P6) |
| Lint | `npm run lint` | pass |
| Tests run 1 / 2 / 3 | `npm test` | pass ×3: wellbeing-core 86/86, API 328 passed + 1 todo (42 files), web 52/52. No flaky test |
| Visual | `npm run test:visual` | pass, 214/214 |
| Audit, all | `npm audit` | 0 vulnerabilities |
| Audit, prod | `npm audit --omit=dev` | 0 vulnerabilities |
| Migrations | `prisma migrate status` (universe_test) | 10 migrations, up to date |
| Drift | `prisma migrate diff --from-config-datasource --to-schema prisma/schema --exit-code` | No difference detected |

---

## Findings

### P7-001 · High · Platform · Every timestamp is stored 5 h 30 m early, so SQL-side time maths is wrong (corrected root cause of the P5 HIGH)
- **Where:** `apps/api/src/platform/db.ts:6-10` (the pool sets no time zone). The local databases have `TimeZone = Asia/Kolkata`.
- **What is wrong:** P5 diagnosed this partly wrong. The measured behaviour (`P7-evidence/tz-repro.log`, `tz-raw-repro.log`, `tz-expr-repro.log`):
  - The Prisma 7 pg adapter sends a JS `Date` as a wall-clock time without an offset. PostgreSQL reads that as IST, so a write at 04:05 IST is stored as 22:35 IST (`last_login_at::text = 2026-10-29 22:35:43.676+05:30` for a true 04:05 IST).
  - Reads apply the reverse shift, so every Prisma round trip looks right. That includes `@default(now())`, which Prisma fills on the client, not the database. P5's claim that "database defaults read back wrong" is false for Prisma-created rows.
  - Anything computed in SQL disagrees with the stored values:
    - `SELECT now()` and literal `'…Z'::timestamptz` come back +330 min.
    - `AT TIME ZONE 'Asia/Kolkata'` buckets land 5.5 h early: the busy-hour histogram `rides/services/history.js:243` and the weekly stats `rides/services/stats.js:37`.
    - Rows written with a database-side `now()` read back 5.5 h in the future: `login_throttle.updated_at` (`throttle.ts:23` raw INSERT), and `hub/prep.ts:207` `updated_at = now()`.
  - psql, pg_dump and any report show times 5.5 h early.
- **Repro:** `ENV_FILE=apps/api/.env.test npx tsx docs/audit/P7-evidence/repro/tz-raw.ts.txt` (rename to `.ts` in place first, then run from the repo root) (rolled back).
- **Why it matters:** the stored data is wrong in absolute terms, and every row written grows the cleanup a later fix must do. A pickup at 09:00 IST is counted in hour 3 of the busy-hours chart.
- **Fix:** pin the session to UTC at the root. Add `options: '-c TimeZone=UTC'` to `PrismaPg` in `db.ts` (and to the seed and scripts that build their own client), plus `ALTER DATABASE … SET timezone TO 'UTC'` in the README setup. Re-seed `universe` with `npm run demo:reset -- --yes`. Any real data needs a one-off `UPDATE … + interval '5 hours 30 minutes'`.
- **Test to add:** in `apps/api/test/health.test.ts`, assert that `SELECT now()` via `$queryRaw` is within 1 s of `Date.now()`. Also check that `last_login_at::text` matches the IST wall clock.
- **P8:** fixed on `p1/p8-fixes` (commit message starts `fix(P7-001)`) · test apps/api/test/health.test.ts, rides/stats.test.ts, hub/prep.test.ts

### P7-002 · High · Rides (pooled autos) · One rider who never boarded can suspend any auto with a single feedback (confirmed)
- **Where:**
  - `apps/api/src/modules/rides/services/riders.js:823-847` (`addFeedback`) checks only membership and `g.vehicleId`.
  - `lib/vehicleStatus.js:65-78` counts **tags**, not riders.
  - The suspend threshold is 5 (`config.js:85`).
  - `ComplaintTag` arrays are not de-duplicated (`packages/contracts/src/rides/index.ts:123`).
- **Repro:** `P7-R1` in `probes/p7-rides.test.ts.txt`. A fresh student starts a group alone, `GET /groups/:id/driver` assigns an auto, then `POST /groups/:id/feedback` sends all 5 tags. The result: 201, and vehicle `MH 02 EK 4417` has `status=suspended` (`probe-modules.log`).
- **Why it matters:** with seven demo autos, one student can take the fleet off the road in minutes. That breaks the pooled-ride flow and wrongly penalises drivers.
- **Fix:**
  - Allow feedback only from a boarded member, after pickup or completion.
  - Make `tags` unique with `.refine`.
  - Count one complaint per feedback row (or per distinct rider) towards flag and suspend.
- **Test to add:** a non-boarded member gets 409; duplicate tags get 400; one feedback with 5 tags does not suspend.
- **P8:** fixed on `p1/p8-fixes` (commit message starts `fix(P7-002)`) · test apps/api/test/rides/admin.test.ts

### P7-003 · High · Rides (pooled autos) · Admin cancel or unassign leaves the driver's trip live (confirmed)
- **Where:**
  - `services/admin.js:77-156`: `cancelRide` and `unassignDriver` never update `rides_driver_trips`.
  - `services/drivers.js:504-581`: `tripStep` and `boardRider` check only the trip row, not `g.status` or `g.vehicleId`.
  - `drivers.js:68-69`: `assignInTx` excludes only `declined` trips.
- **Repro:** `P7-R2` and `P7-R2b` (`probe-modules.log`):
  - After an admin cancel, the driver's `POST /driver/trips/:id/heading` returns **200** and notifies the riders of a cancelled ride.
  - After an admin unassign, the same driver is re-assigned (the only one online) and `POST /driver/offers/:id/accept` returns **409 CONFLICT "Resource already exists"** (P2002 on `(group_id, driver_id)`). The group holds that vehicle and can never be accepted.
- **Why it matters:** riders get "driver heading" for a ride the admin cancelled. The admin's unassign tool can strand a group.
- **Fix:**
  - In both admin actions, move the live trip to a terminal status (add `cancelled`/`unassigned` to its CHECK) in the same transaction.
  - In `tripStep`/`boardRider`, require `g.status NOT IN ('cancelled','completed') AND g.vehicle_id = trip.vehicle_id`.
  - Exclude any earlier trip row of the driver in `assignInTx`, or reuse the row.
- **Test to add:**
  - cancel → heading/board/complete give 409;
  - unassign → reassign → accept by the same driver gives 200.
- **P8:** fixed on `p1/p8-fixes` (commit message starts `fix(P7-003)`) · test apps/api/test/rides/p7-audit.test.ts

### P7-004 · High · Rides (pooled autos) · Strangers see full names and drop stops of forming groups (confirmed)
- **Where:**
  - `services/riders.js:200-205` (`describeGroup`, used by `GET /groups/available` for groups the caller is not in) returns `members[].name` and `dropName`.
  - `core.js:163-175` returns `fare.members[].name`.
  - `riders.js:404` (`findMatches`, `GET /matches`) also returns each member's `userId`, `rideRequestId` and drop stop.
- **Repro:** `P7-R3`. A student named "Meera Kapoorfamily" starts a group; an unrelated student's `GET /api/rides/groups/available?limit=100` contains `Kapoorfamily` (`probe-modules.log`).
- **Why it matters:** any student can see who is travelling where and when. Carpool offers deliberately show first names only (P3b), so the two ride types disagree.
- **Fix:** for non-members, return first name (or initials) and the stop only. Drop `userId`. Keep `memberRideRequestIds`, which the join flow needs.
- **Test to add:** a non-member's `/groups/available` and `/matches` contain no surname and no `userId`.
- **P8:** fixed on `p1/p8-fixes` (commit message starts `fix(P7-004)`) · test apps/api/test/rides/p7-audit.test.ts

### P7-005 · High · Rides (carpool) · Driver accept skips the passenger's time window and women-only check (code-verified)
- **Where:**
  - `services/offers.js:584-612` (`acceptInTx`) re-runs only the seat and detour insertion.
  - The `|pickup − requested| ≤ buffer` and `womenOnly && !female` checks exist only in `requestSeat` (`offers.js:619-662`).
  - `update` (`offers.js:365-418`) lets the driver change `departAt` or `womenOnly` while bookings are still `requested`.
- **Repro (traced):**
  1. A 09:00 offer.
  2. A male passenger requests a seat.
  3. The driver sends `PATCH /offers/:id { departAt: 18:00, womenOnly: true }`.
  4. `POST /bookings/:b/accept` returns 200: the passenger is matched to an 18:00 women-only ride.
- **Why it matters:** it breaks the women-only guarantee (a safety promise) and the departure-time requirement.
- **Fix:** re-check both rules in `acceptInTx` against the passenger's profile and request, or have `update` cancel requested bookings that no longer fit, in the same transaction.
- **Test to add:** the sequence above gives 409 (time) and 403 (women-only).
- **P8:** fixed on `p1/p8-fixes` (commit message starts `fix(P7-005)`) · test apps/api/test/rides/offer-recheck.test.ts

### P7-006 · High · Hub · A mentor keeps reading a student's live card after the request is cancelled or declined (confirmed)
- **Where:**
  - `apps/api/src/modules/hub/profiles.ts:78-84` matches any request with any status.
  - `requests.ts:264` (`GET /requests/incoming`) rebuilds live cards for closed requests too.
- **Repro:** `P7-H1`. A student requests Neha, then cancels; Neha's `GET /api/hub/students/:id` still returns **200** with current DSA % and readiness (`probe-modules.log`). The same applies to a peer mentor who later turns mentoring off.
- **Why it matters:** this breaks the design's privacy rule ("a mentor sees a student only through a request"). Access never expires.
- **Fix:**
  - Restrict to `status IN ('pending','accepted')`, or completed within N days.
  - For students, also require a current peer-mentor profile.
  - In `incoming`, return only name and status for closed rows.
- **Test to add:** cancel or decline → 404; a former peer mentor → 404.
- **P8:** fixed on `p1/p8-fixes` (commit message starts `fix(P7-006)`) · test apps/api/test/hub/p7-audit.test.ts

### P7-007 · Medium · Hub · `Idempotency-Key` is not tied to the topic or body; a different increment is silently dropped (confirmed)
- **Where:** `hub/routes.ts:174` keys `${userId}:increment:${key}`. `hub/idempotency.ts` is an in-memory map: lost on restart, per process, and a global 10,000-key cap evicts other users' keys.
- **Repro:** `P7-H2`. With key `k1`, `+1` on `dsa-dp`, then `+1` on `dsa-graphs` with the same key, returns **200 with the dsa-dp body**; graphs `solved` stays 0.
- **Fix:** include `topicId` and a body hash in the key; reject a reuse with a different body with 422 `IDEMPOTENCY_KEY_REUSED`. Optionally persist keys (unique `(user_id, key)`) with a TTL.
- **Test to add:** the H2 sequence gives 422 (or applies to graphs).
- **P8:** open — deferred (15-minute deadline)

### P7-008 · Medium · Rides · `GET /api/rides/admin/drivers` page 2 returns 500 (confirmed)
- **Where:** `services/admin.js:404` uses `c.afterAsc('createdAt', cursor)`, which emits `id: { gt }` (`core.js:183-190`). `RidesDriver` has no `id` column (its PK is `userId`).
- **Repro:** `P7-R6`. `?limit=1`, then the returned `nextCursor` → **500 INTERNAL_ERROR**. The existing test only uses `?limit=100`.
- **Fix:** give `afterAsc` an `idField` parameter (as `beforeDesc` has) and pass `'userId'`.
- **Test to add:** page through with `limit=1`.
- **P8:** fixed on `p1/p8-fixes` (commit message starts `fix(P7-008)`) · test apps/api/test/rides/p7-audit.test.ts

### P7-009 · Medium · Rides · Leaving after the ride rewrites fares and the driver's payout (code-verified)
- **Where:** `riders.js:613-662` (`leave`) never checks `g.status`. `core.js:35-40` `leaveLockedReason` unlocks once pickup has passed. The driver's earnings are computed live from `g.total_fare_paise` (`drivers.js:391-395`).
- **Repro (traced):** group of 3, the driver boards 2 and completes; the no-show calls `POST /groups/:id/leave` → 200. The others' shares rise after they paid, and the payout changes.
- **Fix:** reject `leave` when the group is `completed`/`cancelled` or a trip has started.
- **Test to add:** leave after complete gives 409.
- **P8:** open — deferred (15-minute deadline)

### P7-010 · Medium · Rides · A rides suspension does not stop a carpool driver's live offers (code-verified)
- **Where:** `admin.js:212-252` sets only `suspendedAt`. `requestSeat`, `decide`, `depart` and `complete` (`offers.js`) never check the driver's suspension.
- **Fix:** cancel live offers on suspension (reuse `cancelInTx`), and refuse seat requests and accepts for suspended drivers.
- **Test to add:** after suspension, a seat request on the driver's offer gives 409.
- **P8:** open — deferred (15-minute deadline)

### P7-011 · Medium · Rides · No database guard against one rider holding two seats at once (code-verified)
- **Where:**
  - There is no partial unique index `rides_offer_bookings(request_id) WHERE status = 'accepted'` (`prisma/schema/rides.prisma:456-460`).
  - `acceptInTx` marks only that request `matched`.
  - `join` (`riders.js:555-558`) cancels only *open* requests.
  - So an accepted carpool seat and a pooled-auto group can overlap in time. CLAUDE.md: "Unique constraints, not app checks".
- **Fix:**
  - Add the partial unique index.
  - In `acceptInTx` and `join`, reject when the user already holds a matched request with an overlapping window.
  - Optionally add an exclusion constraint per driver on `tstzrange(depart_at, …)`.
- **Test to add:** accepted on an offer, then joining a group at an overlapping time gives 409.
- **P8:** open — deferred (15-minute deadline)

### P7-012 · Medium · Rides · A passenger whose seat is only *requested* sees confirmed passengers' stops, times and shares (code-verified)
- **Where:** `offers.js:796-798, 826-846` (`GET /offers/:id`). Anyone can create a request, request a seat, read the plan and cancel.
- **Fix:** show other passengers' stops and times only to accepted passengers and the driver; requesters see the route and their own pickup.
- **Test to add:** a requested passenger's view has no other passenger's pickup/drop/time.
- **P8:** open — deferred (15-minute deadline)

### P7-013 · Medium · Hub · Accept, decline and complete skip the mentor check (code-verified)
- **Where:** `hub/requests.ts:278-282` (`lockFor(…, 'mentor')`) checks only `user.id === row.mentorId`. `incoming`, `mySlots`, `createSlot` and `deleteSlot` call `requireMentor`. `docs/ROLES.md:5` says mentor routes also need a mentor or peer-mentor profile.
- **Repro (traced):** a peer mentor turns `isPeerMentor` off; `GET /requests/incoming` → 403, but `POST /requests/:id/accept` → 200 and books a slot.
- **Fix:** call `requireMentor(tx, user)` in `accept`, `decline` and `complete`, or auto-decline pending requests when someone stops mentoring.
- **Test to add:** the sequence above gives 403 `NOT_A_MENTOR`.
- **P8:** open — deferred (15-minute deadline)

### P7-014 · Medium · Hub · Completing a session sends no notification (code-verified)
- **Where:** `hub/requests.ts:375-388` (`complete`) updates the status but emits nothing. The other three transitions emit `hub.request_*`. The integration requirement asks for a common notification mechanism for module actions.
- **Fix:** emit `hub.request_completed` to the student in the same transaction, and add it to `packages/contracts/src/activity/hub.ts` and the web `activityText`.
- **Test to add:** after complete, the student has one `hub.request_completed` event.
- **P8:** open — deferred (15-minute deadline)

### P7-015 · Medium · Hub · Two booking rules are enforced only by application code (code-verified)
- **Where:** migration `20261029202837_p4_hub` has no constraint for:
  - (a) one accepted/completed request per slot;
  - (b) a request's slot belonging to its mentor.
  The row locks hold today (the race test passes), but CLAUDE.md requires constraints.
- **Fix:**
  - (a) Partial unique `hub_mentorship_requests(slot_id) WHERE status IN ('accepted','completed')`.
  - (b) `UNIQUE (id, mentor_id)` on `hub_mentor_slots`, plus a composite FK `(slot_id, mentor_id)`.
- **Test to add:** a raw insert of a second accepted request on the same slot fails on the constraint.
- **P8:** open — deferred (15-minute deadline)

### P7-016 · Medium · Wellbeing / platform logging · An absolute-form request target bypasses the wellbeing log scrubbing (confirmed)
- **Where:** `apps/api/src/app.ts:32-33` tests `req.originalUrl` against `^/api/wellbeing…`. Express 4 still routes `GET http://host/api/wellbeing/... HTTP/1.1`, and pino then logs the full URL with the query string and params.
- **Repro:** `P7-W1` (`probes/p7-wb-logs.test.ts.txt`, `probe-wb-logs.log`): status 200, and `days=9` appears in the log. (The probe's mock logger has no redaction, so its cookie output is an artefact; the real logger redacts cookies.) Browsers never send this form; curl `--request-target` or a proxy can.
- **Why it matters:** this breaks the binding rule that wellbeing dates, categories and query strings never reach a log.
- **Fix:** match on the pathname, `new URL(req.originalUrl, 'http://x').pathname`, or reject absolute-form targets in `requestId` middleware.
- **Test to add:** P7-W1 in `apps/api/test/wellbeing/logs.test.ts`.
- **P8:** open — deferred (15-minute deadline)

### P7-017 · Medium (scale, uncertain) · Wellbeing · The weekly-summary job is one unbounded interactive transaction
- **Where:** `modules/wellbeing/jobs.ts:22-41`. One `INSERT … SELECT` covers every user, then `emit` creates events in 1,000-row chunks, all inside `prisma.$transaction` with the default 5 s timeout.
- **Why it matters:** at several thousand eligible users the transaction can time out every hour, so no summary is ever sent. Not observed at demo scale.
- **Fix:** batch by `user_id` (e.g. 500 per transaction, loop until 0); `ON CONFLICT DO NOTHING` already makes batches idempotent.
- **Test to add:** 3,000 eligible users → `sent === 3000`, second run `sent === 0`.
- **P8:** open — deferred (15-minute deadline)

### P7-018 · Low · Rides · `GET /groups/:id/driver` assigns a driver and emits events (a state change on GET)
- **Where:** `drivers.js:179-202`. GET skips CSRF, and SameSite=Lax cookies are sent on top-level cross-site GET navigations. The group id is a UUID, so this is hard to exploit.
- **Fix:** move assignment to `POST /groups/:id/driver`.
- **P8:** open — deferred (15-minute deadline)

### P7-019 · Low · Rides · Riders can self-board at any time, which inflates savings
- **Where:** `riders.js:705-721` has no vehicle or time check. This feeds `completedRides`/savings (`history.js:87-88`), and the odometer is skipped if boarding happens before assignment (`riders.js:675`).
- **Fix:** require an assigned vehicle and pickup within the buffer.
- **P8:** open — deferred (15-minute deadline)

### P7-020 · Low · Hub · Smaller concurrency and performance items (code-verified)
- (a) `requests.ts:203-204, 283` lock `hub_profiles … FOR UPDATE`, which conflicts with FK `KEY SHARE`. Two peer mentors requesting each other at once can deadlock (40P01 → 500). Use `FOR NO KEY UPDATE`.
- (b) `resources.ts:209-213`: delete is `findFirst` then an unconditional `update`, so double admin deletes write two audit rows. Use `updateMany({ id, deletedAt: null })`.
- (c) `resources.ts:154-160`: the file ownership/live check is outside the create transaction, so an owner's concurrent `DELETE /api/files/:id` leaves a resource pointing at an unreadable file. Lock the file row inside the transaction.
- (d) `GET /requests/incoming` without `status` sorts in memory. Add index `(mentor_id, created_at DESC, id DESC)`.
- **P8:** open — deferred (15-minute deadline)

### P7-021 · Low · Hub, rides · Mutating routes ignore unknown query fields (and some DELETE bodies)
- **Where:** hub `PUT /me`, `PUT /prep/*`, all POSTs, and `DELETE /slots/:id`/`/resources/:id` bodies (`hub/routes.ts:229, 359`); rides POST/PATCH/DELETE never parse `req.query` (e.g. `rides/routes.js:81, 634`). CLAUDE.md: reject unknown fields everywhere.
- **Fix:** parse `NoQuery`/`NoBody` by default in each module's route loop.
- **P8:** open — deferred (15-minute deadline)

### P7-022 · Low · Wellbeing · Privacy and edge items
- (a) `DELETE /data` (`service.ts:289-299`) leaves `wellbeing.weekly_summary` activity events, which show the user had data. Because it also deletes the markers, re-uploading last week's totals sends a second summary. Delete the user's `wellbeing.*` events in the same transaction.
- (b) Lowering `retentionDays` (`service.ts:139-152`) deletes nothing until the hourly job, so `/records` and `/export` still return rows outside the new window for up to an hour. Delete in the same transaction.
- (c) `Cache-Control: no-store` is missing on wellbeing-derived values outside the module: the `GET /api/dashboard` wellbeing card, hub `GET /prep` `focusStudyMinutesThisWeek`, and the outer guard's 401/403 on `/api/wellbeing`.
- (d) The library can produce totals the server rejects in bulk: no lower date bound, and no 1440-minute cap per day for overlapping slices (`events.ts:95-97`, `daily.ts:83-117`). The all-or-nothing `PUT /totals` then fails. U2 contract gap.
- **P8:** open — deferred (15-minute deadline)

### P7-023 · Low · Platform · Logout does not close that session's SSE streams
- **Where:** `platform/auth/routes.ts` `/logout` deletes the session but never calls `closeUserStreams` (change-password and admin deactivate do). The stream keeps receiving events until the next 25 s heartbeat notices the dead session.
- **Fix:** after the transaction, `closeUserStreams(user.id)` filtered to `sessionId` (add a `sessionId` filter variant).
- **Test to add:** after logout, the open stream ends within 1 s.
- **P8:** fixed on `p1/p8-fixes` (commit message starts `fix(P7-023)`) · test apps/api/test/platform/streams.test.ts

### P7-024 · Low · Seeds · `demo:reset` guard and scope
- `prisma/seed/reset.ts:63` checks only `url.hostname`. A `?host=` query parameter, which pg honours, or a localhost tunnel to a remote server passes. Also check `inet_server_addr()` and `current_database()` after connecting.
- `reset.ts:87` `activityEvent.deleteMany()` also deletes Person 2's observatory/exam events while their tables stay (a cross-owner deletion). Limit it to `module IN ('platform','hub','rides','wellbeing')`.
- `reset.ts:52` `as unknown as Table` bypasses the type checker.
- **P8:** open — deferred (15-minute deadline)

### P7-025 · Low · Root config · `prisma.config.ts` fails the root typecheck (known from P6, still open)
- **Where:** `prisma.config.ts:25`. No gate runs `tsc -p tsconfig.json`, so `prisma/seed/` is not type-checked by `npm run typecheck`.
- **Fix:** `...(shadow && { shadowDatabaseUrl: shadow })`, and add the root project to `npm run typecheck`.
- **P8:** open — deferred (15-minute deadline)

### P7-026 · Low · Tooling · npm 11 does not run dependency install scripts
- `npm ci` warns that 6 packages' install scripts (`@prisma/engines`, `argon2`'s build, `esbuild`, `fsevents`, …) were not run. Everything works today from prebuilt binaries and the root `postinstall` (`prisma generate`), but a platform without prebuilds would fail at runtime.
- **Fix:** add an `allowScripts` list to `package.json` (or `.npmrc`) for the packages that need them, and document it in the README setup.
- **P8:** open — deferred (15-minute deadline)

### P7-027 · Low · Platform · Earlier LOW findings still open (re-verified)
- SSE stream registered after an early client disconnect: `activity/routes.ts:120-163` still has no `req.destroyed` check.
- Every `ZodError` becomes 400: `http.ts:51-52`, unchanged.
- Audit-log `TRUNCATE` is not blocked: migration `p2_platform_services:92-100`.
- No index on `sessions.last_seen_at`: EXPLAIN #12 is a seq scan, `P7-evidence/explain.log`.
- `targetId`-only audit filter: EXPLAIN #6 uses `audit_log_target_idx` with 3 index searches, which is fine at 300k rows.
- Platform routes ignore unknown query fields.
- **P8:** open — deferred (15-minute deadline)

### P7-028 · Low · Docs · Reports and COVERAGE.md claims that are false or overstated
See "Reports versus reality" below. Correct `docs/sessions/P1.md` §9, `docs/COVERAGE.md` (three rows) and the P5 time-zone diagnosis (P7-001).
- **P8:** open — deferred (15-minute deadline)

---

## Verified correct (P8 need not re-check)

**Gates and secrets**
- All gates in the table above (except the root tsc, P7-025): 3 identical green test runs; visual 214/214; 0 audit issues; no migration drift.
- Secrets in git history (83 commits, all refs, `git log --all -p`):
  - Module B's `backend/.env` blob hash (computed with `git hash-object`, file never opened) is absent from `git rev-list --objects --all`.
  - `SMTP_PASS`, `SMTP_USER`, `ADMIN_PASSWORD_HASH`, `JWT_SECRET` never appear.
  - None of the real values in `apps/api/.env`/`.env.test` (`DATABASE_URL`, `CSRF_SECRET`, `EMAIL_HMAC_SECRET`, `SEED_DEMO_PASSWORD`, `STORAGE_DIR`) appear (occurrence count 0 each).
  - Committed env files are only `.env.example`, `.env.test.example` (placeholders `CHANGE_ME`) and `apps/web/.env.visual` (a demo flag).
  - No private keys or cloud/API token patterns.
  - The only email in history besides `*.test` accounts is the committer's address.

**Authentication and sessions**
- CSRF on **every** unsafe route: a probe walks the route table (`routeTable()`), sends every POST/PUT/PATCH/DELETE except login without the token as admin and as student, and gets 403 `CSRF_FAILED` for each. A wrong token, another session's token, a foreign `Origin`, `Origin: null`, and a foreign Origin on login are all refused; an allowed Origin with the token passes (`probe-csrf-session.log`). CSRF is global middleware ahead of every router (`app.ts:95`).
- Cookie: `HttpOnly; SameSite=Lax; Path=/`, `Secure` from `COOKIE_SECURE`; no token in any response body.
- Opaque 32-byte token; only SHA-256 stored (`sessions.ts:52`).
- Idle timeout works (JS-written `last_seen_at` 3 h ago → 401); a fresh session's `last_seen_at` has no skew (P7-001 does not affect sessions, because Prisma fills the default on the client).
- Login:
  - Argon2id (19 MiB, t=2).
  - The same 401 for unknown email, wrong password and inactive account, with a dummy hash for unknown emails.
  - Throttle keyed by an email HMAC, with a row lock and at most 5 checks under parallel attempts (`auth.test.ts:106`, passing ×3); IP limit 10/min.
- Change password needs the current password, is rate-limited per user, has a 12–256 character rule, refuses reuse and the email local part, and kills the user's other sessions and streams.
- The forced-change gate allows only `me`, `change-password`, `logout`, `login` and health. Express case-insensitive paths cannot bypass it (an upper-case path is blocked, not allowed).
- Admin: last-admin protection with ordered row locks (`admin-users.test.ts:166`); deactivate deletes sessions and closes streams; temporary passwords are 144-bit and shown once; admin search escapes `%`/`_`.

**Authorisation**
- `docs/ROLES.md` matches the guards (the guard test passes); every module is mounted behind `requireAuth` + `requireRole(module.roles)`.
- Rides ownership returns 404 on offers, bookings, requests (including `?requestId=`), groups and trips.
- Hub: `/requests/:id`, `lockFor` and slot ownership (another mentor's `slotId` → 404, another mentor's slot on request → 409).
- Wellbeing: no user id in any URL or body; admin, driver and invigilator get 403.
- Activity: `/:id/read` returns 404 for others' events.

**Input**
- `.strict()` Zod on all bodies; page limits ≤ 100.
- No `$queryRawUnsafe`, `$executeRawUnsafe`, `Prisma.raw` or string-built SQL anywhere in `apps/api/src` or `prisma/seed`.
- Hub full-text input reduced to letters and digits; ILIKE escaped.

**Files**
- Type sniffed from bytes; per-purpose allow-list (PDF/PNG/JPEG/WebP only, so no HTML/SVG).
- Size enforced while streaming (busboy `fileSize`), with the temp file removed on any failure.
- Quota checked under a per-user advisory lock.
- UUID storage keys, never from the request; the storage directory must be outside the repo.
- Download: `attachment` with an RFC 5987 name, `nosniff`, `private, no-cache`, Range via `send` (416 mapped).
- Read authorised per purpose (404 otherwise); delete only by owner or admin; 409 `FILE_IN_USE`; the sweep skips referenced files.

**Privacy**
- Wellbeing: owner-only, never audited, logs keep the route pattern (except P7-016); `studyMinutesThisWeek` only for actor = owner with sharing on.
- No emails or passwords in audit metadata (failed logins store an email HMAC); the logger redacts cookie, authorization, CSRF and set-cookie.
- Rides gender is never returned about others (`gender.test.ts`).

**Concurrency** (all with passing tests ×3)
- Pooled seats: `grouping.test.ts:111`.
- Carpool 3-for-2 seats: `offers.test.ts:287`.
- Driver accept double-click: `drivers.test.ts:262`.
- Mentor slot accept race: `hub/requests.test.ts:139`.
- Last admin: `admin-users.test.ts:166`.
- Idempotent increments for the same key: `prep.test.ts:199`.
- Wellbeing 1440 limit under parallel uploads: `totals.test.ts:150`.
- Multi-step writes use `platform.transaction` with audit and activity in the same transaction.

**Performance** (`P7-evidence/explain.log`)

EXPLAIN (ANALYZE) on `universe_test` with 20k users, 300k events, 300k audit rows, 1.8 M wellbeing rows, 20k resources and 20k offers, all inside one rolled-back transaction:

| Query | Plan | Time |
| --- | --- | --- |
| Feed | `activity_events_feed_idx` | 0.17 ms |
| Unread count | partial index | 1.0 ms |
| Users by role | `users_list_idx` | 0.06 ms |
| Users search | seq scan on 20k rows | 12 ms (acceptable; trigram indexes exist for larger tables) |
| Audit prefix | list index | 0.08 ms |
| Audit `targetId` | target index | 0.1 ms |
| Wellbeing 31-day window | PK | 1.0 ms |
| Wellbeing records page | PK backward | 0.01 ms |
| Resources search | GIN / trigram, seq scan when 25 % of rows match | 16 ms |
| Resources list | `hub_resources_live_idx` | 0.08 ms |
| Offer matching window | `rides_offers_status_depart_at_idx` | 0.04 ms |

No N+1: query-count tests exist for rides lists and hub views and pass. The 200-offer matching budget test (`matching-perf.test.ts`, median < 200 ms) passes ×3.

**Reliability** (`P7-evidence/shutdown/summary.txt`)
- SIGTERM with an open SSE stream and a 3 MB upload throttled to 300 kB/s:
  - the stream closed at once;
  - the upload finished with 201;
  - the process exited 0 after 7.8 s, inside the 10 s hard limit;
  - the port was released.
- Timers are `unref`'d and cleared on stop.
- `/api/health/live` and `/ready` (DB with a 2 s timeout, plus storage writable) work.
- A failing or slow module provider becomes `error`/`timeout` for that module only (`dashboard.ts:29-55`, `dashboard.test.ts`).

**Frontend** (`P7-evidence/csp.log`)
- Built app served by the API with helmet's CSP, loaded in headless Chromium: sign in, then dashboard, inbox, admin users, admin audit, hub, rides and 404. There are no CSP violations and no page errors. The only console error is the expected 401 from `/api/auth/me` before sign-in.
- `localStorage` is empty after sign-in (only the theme key is ever written); the CSRF token is held in memory.
- One `EventSource` per tab (`ActivityProvider.tsx:112`), closed on unmount, with back-off.
- Queries pass AbortSignals; admin search is debounced.
- The axe check runs inside the visual suite (214/214).

---

## Requirements gap list (check 12)

### Problem statement, line by line

**Module A**

| Requirement | State | Gap |
| --- | --- | --- |
| Profiles with skills, interests, placement goals | Backend done and tested | Screen U2. P7-006 (privacy of the student card) |
| Placement preparation dashboard and progress tracking | Backend and dashboard card done | Prep screen U2. P7-007 |
| Peer mentor discovery and mentorship requests | Done (ranking, slots, requests, ride link) | Screens U2. P7-013, P7-014 (no notification on completion), P7-015 |
| Searchable resource repository (notes, question papers, study material) | Done | **Partly:** only PDF/PNG/JPEG uploads (`hub/index.ts:53`), so typical notes formats (DOCX, PPTX) can't be shared. Screen U2 |

**Module B**

| Requirement | State | Gap |
| --- | --- | --- |
| Drivers create rides, passengers request them | Done (carpool offers, bookings) | Screens U2 |
| Graph-based campus locations and routes | Done (22-stop graph, Dijkstra) | `GET rides/nodes` has no test |
| Matching on route compatibility, departure time, seats, maximum detour | Done at request time | **Partly:** the time window and women-only rule are not re-checked at accept (P7-005) |
| Savings dashboard | Backend and dashboard card done | Rides screen U2. Busy-hour analytics are shifted by P7-001 |

**Module D**

| Requirement | State | Gap |
| --- | --- | --- |
| Start and stop a focus session | Library only | **Partly:** no user can do it until U2 builds the screen |
| Categorise sample browsing events with user rules | Library only | **Partly:** no rule editor or sample import until U2 |
| Show duration, context switches, distracting-site time | Library metrics plus server daily totals | **Partly:** the session metrics have no screen yet (U2) |
| Pause, data inspection, deletion | Done (backend) | P7-022 (a) and (b) |
| Process locally; collect no page contents or credentials | Server side done | **Partly:** the local processing exists only as a library; no browser code imports it yet (U2). P7-016 |

**Integration**

| Requirement | State | Gap |
| --- | --- | --- |
| Unified dashboard | Done | — |
| Consistent navigation | Done for platform screens | Module screens U2 |
| Shared data model / defined interfaces | Done (`publicApi`, contracts) | — |
| Common notification mechanism | Done | P7-014 |
| Role-based access | Done | P7-013 |
| Sample data and test scenarios | Done (story seed, `TEST-SCENARIOS.md`, storyline test) | — |

### COVERAGE.md rows that need correcting
- B "Graph": `GET rides/nodes` is listed but no API test calls it.
- D "Show duration…": lists `PUT/GET wellbeing/totals`. There is no `GET /totals`; the read is `GET /summary`.
- D "Process locally…" is marked plain **done**. It should be "done (library and server); browser U2".
- The web tests are in `apps/web/test/`, not `apps/web/src/`.

---

## Reports versus reality (check 13)

At least five claims per report were checked against code and tests. TRUE unless listed. The false or overstated ones:

| Report | Claim | Verdict | Evidence |
| --- | --- | --- | --- |
| P1 §9 | "a 429 lockout appears only for existing accounts" | **False** (stale since P2) | `throttle.ts:19-36` treats all emails alike |
| P1 | Origin allow-list "on every unsafe request" | Partly | Checked only when the header is present (`guards.ts:50-52`). Requests without Origin still need the token, so this is safe |
| P2 | `audit_log` append-only in the database | Partly | `TRUNCATE` is not blocked (P7-027) |
| P3b | "200 open offers matched in a median of 23 ms" | Partly | Measured once; the test enforces < 200 ms |
| P5 | `no-store` on every wellbeing response "errors included" | Partly | The outer guard's 401/403 lack it (P7-022 c) |
| P5 | Time-zone finding (HIGH) | Partly wrong diagnosis | Defaults written by Prisma round-trip fine; the real defect is storage plus SQL-side maths (P7-001) |
| P5 | "Reads back no database-clock values" | Partly | `hub/prep.ts:207` writes `updated_at = now()` in SQL |
| P6 | `demo:reset` "tested against universe_test" | Partly | The test calls `resetDemoData` directly; the CLI `--yes` path is untested |
| P6 | Every route behind sign-in except login and health | Partly | `/api/docs` (non-production only) sits outside the route table |

Claims checked and **true** include:
- **P1:** Argon2id parameters, the same 401 for all failures, the login IP limit, token hashing, feed and unread indexes.
- **P2:** HMAC throttle with a row lock, last-admin lock, file sniffing/quota/nosniff, 144-bit temporary passwords, four audit indexes.
- **P3a:** group row lock, vehicle exclusion constraint, GIST stop index, `randomInt` rider codes, gender owner-only, 404 for non-members.
- **P3b:** 409 `FILE_IN_USE`, unique (offer, passenger), offer → request lock order, driver-only decide, `estimate: true`.
- **P4:** slot exclusion constraint, one live request per pair, solved ≤ total CHECK, GIN search, lock order, 404 on `/students/:id` for strangers (but see P7-006 for former parties).
- **P5:** 403 for non-owner roles, settings-row lock, CHECKs, route-pattern logs.
- **P6:** 500 ms `publicApi` with 503, study minutes owner and opt-in only, `arriveBy` exclusive, `platform.user_created`, `it.todo` hook.

## Unattended decisions (check 14)

All P4–P6 "decided … (unattended)" entries are implemented as described. Judgement:
- **Sound:**
  - every P6 seed and story decision (Neha's day-after-tomorrow ride, hidden 07:55 match, Diya at 08:02, re-booking in the storyline, Aditya inactive, the inbox cleanup, "Paused since" clamp);
  - 422 `STOP_NOT_FOUND`, drivable-only ride links, `platform.user_created`;
  - every P5 rule (wildcards, counted categories only, `studyMinutesThisWeek` null when study is uncounted, skipping deactivated accounts, `runOnce`, route-pattern logging);
  - every P4 rule (taken slot 409, cancel/complete rules, term and capacity definitions, ranking weakness, search configuration, prep for students, the `/students/:id` endpoint).
- **Questionable:**
  - P6 `demo:reset` scope and guard (P7-024).
  - P5 "delete everything" leaves summary events and allows a duplicate summary (P7-022 a).
  - P4, P5 and P3a each added a back-relation to the shared `platform.prisma` without Person 2's approval. It is technically required, but still needs that PR review.
  - P4 `GET /students/:id` is sound as an endpoint, but its access rule is too wide (P7-006).
- **Unsound:** none.

## Not verified
- Accessibility of module screens: not built yet (U2).
- Person 2's modules (C, E): not present on this branch.
- `npm run design:compare`: not run. It compares against the prototype, and the visual suite already covers the built screens.
- `pip-audit`: no Python service on this branch.
