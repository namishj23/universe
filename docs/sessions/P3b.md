# Session P3b: Rides — driver offers, campus graph, detour matching, savings (backend only)

## 1. Session details
- Owner: Person 1
- Model / effort: Opus 5.5 (claude-opus-5-5), high
- Started / finished: 2026-10-30 00:40 IST / 01:20 IST, duration about 40 minutes (reading and planning about 10, build and checks about 30)
- Branch: `p1/p3b-rides-offers` (from `p1/p3a-rides-move-in`, because PR #3 is not merged) · Commits: 5 · Pull request: https://github.com/namishj23/universe/pull/4 (stacked on #3; merge #3 first)

## 2. Summary
Module B now covers all four problem-statement requirements:
- **Ride creation:** students and mentors can apply to drive their own car or bike, get approved by an admin, and offer rides. Passengers book seats with their ride requests.
- **Graph:** the stop graph is a 22-stop branching network built from OpenStreetMap data (campus paths estimated). Shortest paths come from a heap-based Dijkstra with a cache.
- **Matching:** offers are matched by cheapest detour insertion, with hard limits on detour, seats, delay to confirmed passengers and ride length, and ranked with RoutePool's score.
- **Savings:** costs are split per road segment in exact paise. Savings and shared distance appear in the dashboard and in new stats endpoints.

Partway through, the user asked me not to rework RoutePool's existing backend, so the pooled-auto code is P3a's port, unchanged. The phase is complete except for that one deliberately dropped item (see §5).

## 3. What was done
0. Read `CLAUDE.md`, `PROGRESS.md`, `docs/sessions/P1.md`, `P2.md`, `P3a.md` and the rides module, then planned in plan mode (approved).
   - Mid-session, at the user's request, re-checked RoutePool's backend (`routepool2-react-` @ `69a08ea`). It has pooled autos, a driver portal, fares and savings, all already ported. It has no driver-created rides, carpool, branching graph, detour matching or weekly stats, so only those were written. Offer matches reuse the field names of RoutePool's `MatchCard`.
1. **Step 0:**
   - Platform `FilePurpose.inUse(ids)` hook. `DELETE /api/files/:id` returns 409 `FILE_IN_USE` for a referenced file, and `sweepFiles(modules)` skips referenced files.
   - Rides claims files referenced by driver documents and inspections, with new indexes on those columns.
   - The driver-document read rule is now "owner or admin", so carpool applicants can read their own documents.
2. **Step 1:**
   - `apps/api/scripts/rides-graph.mjs` (Nominatim + OSRM, User-Agent, one request per second, cached) generated `data/graph.json`.
   - The graph has 22 stops and 27 edges with branches (two paths Jogeshwari → Azad Nagar, two Jogeshwari → Saki Naka), walking paths on campus, and durations from documented speeds.
   - Validation runs at module load and after the seed. Dijkstra is binary-heap based, the graph is cached by fingerprint, and path trees sit in an LRU.
   - New routes `GET /graph` and `GET /route`.
3. **Step 2:**
   - `vehicle_type` auto | car | bike, with auto-only fields made nullable under a CHECK.
   - Carpool driver kind and status; apply, documents and admin review (approve, reject, suspend).
   - `rides_offers` and `rides_offer_bookings`.
   - Create, edit (with rules), cancel, depart and complete. Seat requests use auto or manual accept, and the passenger can cancel.
   - Row-locked seat safety: offer row, then request row.
4. **Step 3:**
   - SQL pre-filter, which also labels rows hidden by seats or the gender rules.
   - O(k²) insertion with detour (metres and seconds), delay, ride-length and per-segment seat limits.
   - RoutePool's 0.7/0.3 score with the full breakdown, ineligible offers returned with a reason, and hidden offers counted by reason.
5. **Step 4:**
   - `splitBySegments` (generalised from the pooled split), with the driver as one share and largest-remainder paise.
   - Savings against the solo auto fare, never negative.
   - The dashboard summary covers both ride types and adds carpool driver totals.
   - `GET /stats/me` and `GET /admin/stats` in one SQL query, with estimates and assumptions.
6. **Step 5:** 7 activity event types and 5 audit actions, registered in contracts.
7. **Step 6:** 31 new tests in 5 new files; 3 P3a tests updated for the new graph and dashboard shape.
8. **Seed:**
   - graph upsert and validation;
   - mentor (car) and student2 (bike) as approved carpool drivers;
   - two open offers and one completed shared ride, run through the real services.
9. **Docs:** created `docs/ASSUMPTIONS.md` and `docs/ALGORITHMS.md`; updated the README "Implemented vs simulated" table, PROGRESS.md and OpenAPI.

## 4. Issues hit
| Issue | Root cause | Fix | Files |
| --- | --- | --- | --- |
| `prisma migrate dev` refused the new `duration_s` column | NOT NULL without a default on a table with 5 rows | Hand-edited migration: add with `DEFAULT 1`, backfill from distance at 20 km/h, drop the default | `prisma/schema/migrations/20261029191650_p3b_rides_offers/migration.sql` |
| Passenger got 404 after cancelling their own booking | The route returned the offer view, which is members only, and they had just left | Cancel returns an acknowledgement `{ cancelled, bookingId, offerId }` | `services/offers.js`, `routes.js` |
| Delay-limit test failed | My expectation was wrong: the "after p1" plan made p1's ride 1.6× direct, over the 1.5 limit | Test uses a 2× ride factor for that case (the rule is correct) | `test/rides/offer-plan.test.ts` |
| Lokhandwala match missing from results | It was counted as hidden: the detour moves the pickup over 10 minutes past the time I asked for | Test asks for the time at Lokhandwala after the detour | `test/rides/offers.test.ts` |
| Hidden count 3 instead of 2 | Offers from earlier tests in the same file were still open | That test clears offers first | `test/rides/offers.test.ts` |
| Lint: `.mjs` script not in a TS project; untyped `res.body` in tests; `users()` items possibly undefined | Type-aware rules | `*.mjs` linted without type info; bodies parsed with contracts schemas; `Promise.all([...])` tuples | `eslint.config.js`, tests |
| Prettier failed on `apps/api/.vitest/json/output.json` | A Vitest output file committed by accident in P3a's report commit | `git rm --cached`, `.vitest/` ignored | `.gitignore` |
| EXPLAIN showed a seq scan for driver totals | The planner can't see an InitPlan's value, and the bookings table was tiny | Re-ran with literal ids (as the app sends) and 10,009 synthetic bookings | session scratchpad |

## 5. Changed vs the prompt
| Prompt asked for | What was done instead | Why |
| --- | --- | --- |
| Branch from current `main` | Branched from `p1/p3a-rides-move-in`; PR #4 stacked on #3 | PR #3 is not merged, so `main` has no rides module (same fallback as P2) |
| Test 0: pooled groups match prefix-then-split routes on the branching graph | Not done: pooled matching, join and fares are P3a's port unchanged; shared-then-split routes are matched by the carpool matcher | User instruction mid-session: "dont remake the backend for routepool module b" (then: check what exists, write only new code) |
| Pooled-auto "maximum detour" rules replacing the line rule (P3a §13) | Not done, same reason | Same |
| `GET /api/rides/stats` (admin) | `GET /api/rides/admin/stats` | `GET /api/rides/stats` is already RoutePool's rider totals route |
| File in use = "referenced by a current document or inspection" | Any document or inspection row that references it | Old rows are the review trail; a stricter rule is simpler and safe |
| Edges store `duration_min` | `duration_s` (integer seconds) | The prompt also says the API uses seconds; no conversions |
| Edges directed when a road is one-way | All undirected; no one-way flag | There are no one-way edges in this data (YAGNI, noted in ASSUMPTIONS) |
| Shortest-path cache "invalidated when the graph changes" | One md5 fingerprint query per request; rebuilt on change | The graph changes only through the seed, which may run in another process |
| "At least one free seat" pre-filter | Offers whose busiest stretch is full (`full`) are hidden; seats are checked per segment, so a seat freed at a drop is reused | Real carpooling; the prompt's "never exceeded at any point" rule is the hard check |
| Matching returns "the driver's first name and route" | Also `pickupNode`, `dropNode`, `womenOnly`, `vehicleType`, cost share, solo fare, savings | So RoutePool's `MatchCard` can be reused in U2 |
| Extra | `GET /bookings/mine`, `GET /graph`, `GET /route` | Passengers need their bookings; the graph requirement maps to endpoints |
| Extra | Removed the committed `.vitest` output file | It broke `npm run lint` |

## 6. Decisions made
- Scope: RoutePool's ported backend is not reworked; only new capabilities are written. Match responses use `MatchCard` field names.
- Graph source:
  - OSRM and Nominatim, generated once and committed;
  - campus points hand-placed, with edges at straight line × 1.3, marked `estimated`;
  - edge kinds road, campus road and walk;
  - speeds 20, 10 and 5 km/h;
  - validated at load and after the seed.
- Heap Dijkstra, fingerprint-cached graph and a 256-source LRU of path trees.
- Carpool drivers are `rides_drivers` rows (`kind = carpool`, `status`), authorised by the record, not a role. Approving needs verified documents; suspending cancels upcoming offers.
- Vehicle rules: auto-only permit, fitness, service, inspections and complaints. Cars and bikes need a valid plate plus insurance and PUC valid on the departure day; a bike carries 1 passenger.
- Limits:
  - detour 2,000 m by default (≤ 10,000), with a time budget equal to that distance at 20 km/h;
  - pickup delay ≤ 10 minutes; ride length ≤ 1.5× direct;
  - trips ≤ 180 minutes;
  - late cancellation means within 15 minutes; a ride can be departed from 30 minutes before.
- Cost per km: car ₹7, bike ₹2.50. The driver is one share. Largest-remainder rounding.
- Score weights shared with pooled matching (0.7/0.3); hard rules are not score terms.
- Offer edit rules: with confirmed passengers, only changes that can't hurt them.
- Seats are per segment, and `full` means the busiest stretch is full.
- `FilePurpose.inUse` platform hook.
- Admin stats are at `/admin/stats`.
- `.vitest/` ignored.

All are in PROGRESS.md with reasons.

## 7. Files
- **Created:**
  - `apps/api/scripts/rides-graph.mjs`, `apps/api/src/modules/rides/data/graph.json`
  - `apps/api/src/modules/rides/lib/graph.js`, `apps/api/src/modules/rides/lib/offerPlan.js`
  - `apps/api/src/modules/rides/services/offers.js`, `apps/api/src/modules/rides/services/stats.js`
  - `packages/contracts/src/rides/offers.ts`
  - `apps/api/test/rides/{graph,offer-plan,offers,stats,matching-perf}.test.ts`
  - `docs/ASSUMPTIONS.md`, `docs/ALGORITHMS.md`, `docs/sessions/P3b.md`
- **Changed:**
  - platform: `apps/api/src/platform/files/index.ts`, `apps/api/src/platform/modules/index.ts`, `apps/api/src/server.ts`
  - rides: `apps/api/src/modules/rides/{config.js,index.js,routes.js,seed.js}`, `data/stops.js`, `lib/{dijkstra,fare}.js`, `services/{core,history,admin,vehicles}.js`
  - contracts: `packages/contracts/src/rides/index.ts`, `packages/contracts/src/{activity,audit,dashboard}/rides.ts`
  - schema: `prisma/schema/rides.prisma`
  - tests: `apps/api/test/rides/{helpers,lib,dashboard}.test.ts` (helpers.ts, lib and dashboard tests)
  - config and docs: `docs/api/openapi.json`, `eslint.config.js`, `.gitignore`, `.prettierignore`, `README.md`, `PROGRESS.md`
- **Deleted:** `apps/api/.vitest/json/output.json` (accidentally committed test output)
- **Database migrations:**
  - `20261029191650_p3b_rides_offers`:
    - `rides_route_edges`: `duration_s` (backfilled), `mode`, `estimated`, CHECKs;
    - `rides_vehicles`: `vehicle_type`; nullable permit, fitness and last-service dates with an auto-only CHECK; bike seats = 1;
    - `rides_drivers`: `kind` CHECK widened to `carpool`, plus `status`, `reviewed_by_id`, `reviewed_at`, `review_note`;
    - new tables `rides_offers` and `rides_offer_bookings`, with FKs, indexes and CHECKs.
  - `20261029192926_p3b_file_reference_indexes`: indexes on `rides_driver_documents.file_id` and the four `rides_vehicle_inspections.*_file_id` columns.

## 8. Tests and checks
| Check | Command | Result |
| --- | --- | --- |
| Full chain | `npm ci && npm run build && npm run typecheck && npm run lint && npm test` (end of session) | All pass |
| Build | `npm run build` | Pass (contracts, API incl. `dist/modules/rides`, web) |
| Typecheck | `npm run typecheck` | Pass, 0 errors |
| Lint | `npm run lint` | Pass (ESLint + Prettier) |
| API tests | `npm test` (`@universe/api`) | **24 files, 177 tests passed, 0 failed** (146 from P1–P3a, 3 of them updated, + 31 new) |
| New: graph | `test/rides/graph.test.ts` | 8 passed: committed graph valid, 20+ stops and branching; disconnected caught; zero/negative/duplicate/self-loop caught; road network split by a walk link caught; Dijkstra = brute force on 60 random graphs; two different paths Jogeshwari → Azad Nagar; walking paths never used by vehicles; `GET /graph`, `GET /route` (+ 400 for a walk-only stop) |
| New: planner | `test/rides/offer-plan.test.ts` | 13 passed: detour 0 / +600 m (exact) / far off rejected (`detour`, 10,000 m); cheapest insertion, pickup before drop; delay moves the insertion; delay rejected; seats exceeded mid-route rejected and a freed seat reused; ride length; score adds up; identical inputs give identical output; directional shared metres; hand-worked cost split; shares always sum |
| New: offers API | `test/rides/offers.test.ts` | 7 passed: apply → documents → admin approval (plate normalised; duplicate plate 409; bike with 2 seats 400; bad plate 400; not approved 403; approval without documents 409); **file in use 409 and sweep keeps it**; non-driver 403; student on admin route 403; suspension cancels offers; on-route match (detour 0) and Lokhandwala (+3,064 m, rejected with reason; fits after raising the budget); hidden counts; **seat race 3 for 2 → exactly 2 accepted**, status full, shares sum; passenger can't accept their booking (404); non-member 404; edit rules; driver cancel notifies and reopens the request; passenger cancel re-plans; depart and complete audited |
| New: stats | `test/rides/stats.test.ts` | 2 passed: hand-worked totals (trip 16,633, share 4,121, saved 21,313, 11,775 m, occupancy 2) for passenger, driver, dashboard and admin; `/admin/stats` 403 for a student |
| New: performance | `test/rides/matching-perf.test.ts` | 1 passed: **200 open offers, median 22.7 ms** (runs 16.8–31.8 ms), budget 200 ms |
| Web tests | `npm test` (`@universe/web`) | 1 file, 1 test passed |
| Production audit | `npm audit --omit=dev` | 0 vulnerabilities |
| Migrations / drift | `npx prisma migrate status` and `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema --script --exit-code` (dev and test) | Up to date; empty migration, exit 0 |
| OpenAPI | `npm run api:docs`; `test/openapi.test.ts` | Committed file current; every route documented |
| Seed idempotent | `npm run db:seed` twice | Same counts: 22 stops, 27 edges, offers 2 open + 1 completed, 1 booking |

**EXPLAIN ANALYZE** (dev database, 20,000 synthetic offers and 10,009 synthetic bookings, inserted and rolled back in one transaction; script and full output in the session scratchpad, `explain.sql` / `explain.out`):
```
1. Offer pre-filter (services/offers.js matches)
 Index Scan using rides_offers_status_depart_at_idx on rides_offers o (actual rows=22)
   Index Cond: status = ANY('{open,full}') AND depart_at >= now()+80m-190m AND depart_at <= now()+100m
   SubPlan: Index Scan using rides_offer_bookings_offer_id_passenger_id_key (Index Cond: offer_id = o.id)
 Execution Time: 0.110 ms
2. My offers page (services/offers.js mine)
 Limit -> Index Scan Backward using rides_offers_driver_id_depart_at_id_idx (Index Cond: driver_id = '…')
 Execution Time: 0.016 ms
3. Driver totals (services/stats.js driverTotals), a driver with 10,008 completed offers
 Seq Scan on rides_offers / rides_offer_bookings (reads ~half of each table: the planner's right choice)
 Execution Time: 8.147 ms
 (for a driver with 2 offers: Index Scan using rides_offers_driver_id_depart_at_id_idx, 0.029 ms)
4. Rider stats, carpool part (services/stats.js aggregate), a rider with 2,002 bookings
 Bitmap Index Scan on rides_offer_bookings_passenger_id_status_planned_pickup_at_idx (passenger_id, status)
 Index Scan using rides_offer_bookings_offer_id_passenger_id_key (occupancy sub-count)
 Execution Time: 7.168 ms
```
The admin stats query aggregates every completed ride by design, so it scans; it is one query, not N.

## 9. Security and performance review
- **Validation:** every new body, query and param is parsed with a strict Zod schema from contracts (`CarpoolApplyRequest`, `CarpoolReviewRequest`, `CreateOfferRequest`, `UpdateOfferRequest`, `OfferMatchesQuery`, `BookSeatRequest`, `RouteQuery`, `IdParam`, `NoBody`, `NoQuery`); unknown fields are rejected. Plates are normalised and checked against Indian formats.
- **SQL:** Prisma and tagged `$queryRaw` / `$executeRaw` only (pre-filter, row locks, stats, graph fingerprint). No string-built SQL, no `Unsafe`.
- **Roles and ownership:**
  - Offer write routes need student/mentor **and** an approved, document-verified carpool record.
  - Offer details are members only (driver, or a passenger with a live booking); everyone else gets 404.
  - Accept and decline check that the caller is the offer's driver (the passenger gets 404). Cancel checks the passenger. Requests are checked against their owner.
  - Admin routes need admin (403 tested).
  - A driver can't book their own offer.
- **Privacy:**
  - Passengers see only first names.
  - The driver's gender is used only inside SQL (driver preference) and never returned.
  - Women-only offers need a female driver and are closed to non-female passengers.
  - Activity payloads carry ids, stop names and first names only.
- **CSRF, sessions and rate limits:** unchanged platform guards cover every new unsafe route. Uploads go through the platform's rate-limited file service.
- **Errors:** platform format, with new codes `FILE_IN_USE`, `PLATE_TAKEN`, `NOT_A_CARPOOL_DRIVER`, `CARPOOL_NOT_APPROVED`, `OFFER_HAS_PASSENGERS`, `NO_SEAT`, `GROUP_ACCESS`.
- **Reliability:**
  - Every multi-step write is one transaction with its audit entry and events (pushed after commit): apply, review (with cascading cancellations), create, edit, cancel, depart, complete, request, accept, decline, passenger cancel.
  - Locks are taken offer row first, then request row. Unique `(offer, passenger)` and CHECK constraints back the app rules.
  - The seat race is tested.
- **Performance:**
  - The pre-filter uses `(status, depart_at)`; "my offers" uses `(driver_id, depart_at, id)`; bookings use `(passenger_id, status, planned_pickup_at)` and `(offer_id, …)`. Every new FK is indexed, and so are the file-reference columns.
  - Lists are cursor-paged (default 20, max 100); matches are top-N (max 50).
  - Offers, bookings and names load in batched queries (no N+1).
  - The graph costs one fingerprint query per request instead of two table reads plus Dijkstra.
  - 200 offers are matched in 23 ms.
- **Honesty:** every money and distance figure in stats is labelled `estimate: true` and returned with its assumptions. The README table and `docs/ASSUMPTIONS.md` mark estimated edges and demo rates.
- **Not met / noted:**
  - Pooled autos keep RoutePool's one-line rule (user decision).
  - The admin stats query scans by design (whole-campus aggregate).
  - Single-instance limits from P1 are unchanged.

## 10. Done checklist
- [x] All gates pass (`npm ci && npm run build && npm run typecheck && npm run lint && npm test`); `npm audit --omit=dev` clean. (The full chain was run in order at the end of the session: `npm ci`, build, typecheck 0 errors, lint clean, 177 + 1 tests.)
- [x] Each problem-statement requirement maps to working, tested endpoints:
  1. **Driver ride creation and passenger requests:** `POST /carpool/driver`, `POST /carpool/driver/documents`, `POST /admin/drivers/:id/review`, `POST/PATCH /offers`, `POST /offers/:id/cancel|depart|complete`, `POST /requests` (RoutePool), `POST /offers/:id/bookings`, `POST /bookings/:id/accept|decline|cancel`. Tested in `offers.test.ts`.
  2. **Graph-based representation of campus locations and routes:** `GET /graph`, `GET /route`, `GET /nodes`, and the 22-stop graph with validation and Dijkstra. Tested in `graph.test.ts`.
  3. **Matching on route compatibility, departure time, seats and maximum detour:** `GET /offers/matches?requestId=`, plus the same rules enforced in `POST /offers/:id/bookings` and accept. Tested in `offer-plan.test.ts`, `offers.test.ts` and `matching-perf.test.ts`.
  4. **Dashboard of shared distance and cost savings:** `GET /api/dashboard` (rides summary), `GET /stats/me`, `GET /admin/stats`, `GET /offers/:id` (per-booking share and savings). Tested in `stats.test.ts`.
- [x] The seeded graph has 22 nodes with branching; its source and estimated distances are documented in `docs/ASSUMPTIONS.md` (created).
- [x] The matching algorithm, scoring formula and complexity are in `docs/ALGORITHMS.md` (created).
- [x] `EXPLAIN` shows the offer pre-filter and the per-rider and per-driver stats queries use indexes (§8).
- [x] `docs/api/openapi.json` is current.
- [x] Branch pushed; PR #4 open to `main` (stacked on #3).
- [ ] Test 0, part 1 (pooled groups match prefix-then-split routes): not done, per the user's instruction (§5). Part 2 (file in use → 409, sweep skips) is done.

## 11. Still open
| Item | Owner | Blocks what |
| --- | --- | --- |
| Merge PR #3, then review and merge PR #4 (shared areas: platform files hook, contracts, lint/ignore configs) | Person 2 | Person 2 building on `main` |
| Pooled autos for shared-then-split routes (decision needed; RoutePool backend intentionally untouched) | Team | Nothing; carpool covers it |
| Should carpool drivers need the inspection certificate, or only a licence? | Team | Nothing (both required today) |
| Person 2: add `inUse` to their file purposes if they store file ids | Person 2 | Their files could otherwise be deleted while still referenced |
| Six LOW P1–P2 findings | Person 1 (P8) | Hour 9 audit |
| UI for carpool (reuse RoutePool `MatchCard`, `RouteVisual`, `FareBreakup`) | Person 1 (U2) | Demo screens |

## 12. How to verify by hand
```bash
cd ~/Desktop/"mini project hackathon"
git checkout p1/p3b-rides-offers && npm ci && npm run db:deploy && npm run db:seed
npm test                       # 177 API + 1 web; the perf test logs "matching 200 open offers: median … ms"
npm run dev                    # API on :4000
```
In another terminal (replace PASSWORD with `SEED_DEMO_PASSWORD`):
```bash
B=http://localhost:4000/api
login() { curl -s -c "$1.jar" -H 'content-type: application/json' -d "{\"email\":\"$2\",\"password\":\"PASSWORD\"}" $B/auth/login | sed -E 's/.*"csrfToken":"([^"]+)".*/\1/' > "$1.csrf"; }
post() { curl -s -b "$1.jar" -H "x-csrf-token: $(cat $1.csrf)" -H 'content-type: application/json' -d "$3" "$B$2"; }
login s student@universe.test; login m mentor@universe.test; login a admin@universe.test
curl -s -b s.jar "$B/rides/graph" | head -c 300; echo                   # 22 stops, edges with mode/estimated
curl -s -b m.jar "$B/rides/offers/mine" | head -c 400; echo             # mentor's open Borivali -> SPIT offer (auto-accept)
curl -s -b s.jar "$B/rides/stats/me"; echo                             # yesterday's ride: 11775 m shared, 21313 paise saved (estimate)
curl -s -b a.jar "$B/rides/admin/stats" | head -c 300; echo
# Book a seat: a Malad -> Andheri request at the offer's Malad time (about departure + 27 min).
OFFER=$(curl -s -b m.jar "$B/rides/offers/mine" | sed -E 's/.*"items":\[\{"id":"([^"]+)".*/\1/')
DEPART=$(curl -s -b m.jar "$B/rides/offers/mine" | sed -E 's/.*"departAt":"([^"]+)".*/\1/')
NODES=$(curl -s -b s.jar "$B/rides/nodes")
id() { echo "$NODES" | sed -E "s/.*\"id\":\"([^\"]+)\",\"name\":\"$1\".*/\1/"; }
WHEN=$(node -e "console.log(new Date(Date.parse('$DEPART')+ (4103+4763)*3.6/20*1000).toISOString())")
REQ=$(post s /rides/requests "{\"pickupNodeId\":\"$(id Malad)\",\"dropNodeId\":\"$(id Andheri)\",\"pickupTime\":\"$WHEN\"}" | sed -E 's/.*"id":"([^"]+)".*/\1/')
curl -s -b s.jar "$B/rides/offers/matches?requestId=$REQ"; echo         # score breakdown, addedDetourMetres 0, hidden counts
post s /rides/offers/$OFFER/bookings "{\"requestId\":\"$REQ\"}" | head -c 600; echo   # accepted at once (auto-accept), cost share + savings
```
Then open http://localhost:4000/api/docs: the `rides-carpool` tag lists the new routes.

## 13. Next step
P4 — Module A backend (profiles, prep tracker, mentor ranking, mentorship requests, resource repository). It must know:
- Merge order: #3, then #4.
- Modules can now protect their stored file ids with `FilePurpose.inUse(ids)` (see `apps/api/src/modules/rides/index.js` `referenced()`). P4's `hub.resource` should use it once resources reference files.
- The rides dashboard summary shape changed (`upcomingRide.rideType`/`id`, `carpool`); U1/U2 build against `docs/api/openapi.json`.
- `docs/ASSUMPTIONS.md` and `docs/ALGORITHMS.md` exist; add Module A's ranking formula to ALGORITHMS.
