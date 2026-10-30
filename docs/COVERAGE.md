# Requirements coverage

Every requirement of the problem statement for Person 1's scope (Modules A, B and D in full, the integration requirements, the deliverables) and where it is met. Routes are relative to `/api`; the full contract is `docs/api/openapi.json`, who may call what is `docs/ROLES.md`, and the manual checks are `docs/TEST-SCENARIOS.md` (scenario ids in brackets). "U2" means the module's screens, which the U2 phase builds from the design; the backend behind them is done and tested.

Status: **done**; **partial** (with the reason); **Person 2** (Modules C and E); **P9** / **U2** (a later phase owns it).

## A · Student Intelligence and Academic Hub

| Requirement | Endpoints / library | Tests | Design screen | Status |
| --- | --- | --- | --- | --- |
| Student profiles with skills, interests and placement goals | `GET/PUT hub/me`, `GET hub/students/:id` (admin, or a mentor the student asked) | `hub/profiles.test.ts` [A12] | Hub · Profile | done (backend); screen U2 |
| Placement preparation dashboard and progress tracking | `GET hub/prep`, `PUT hub/prep/topics`, `PUT hub/prep/goal`, `POST hub/prep/:topicId/increment` (Idempotency-Key); dashboard card (`GET dashboard`), week strip "Prep goal ends, N left" | `hub/prep.test.ts`, `hub/dashboard.test.ts`, `demo.test.ts` [A1–A3] | Hub · Prep tracker; Dashboard | done (backend + dashboard card); screen U2 |
| Peer mentor discovery and mentorship requests | `GET hub/mentors` (ranked: weak-topic coverage, interests, free slots, load), `GET hub/mentors/:id`, `GET/POST hub/slots`, `POST hub/requests`, `GET hub/requests/mine|incoming|:id`, `POST hub/requests/:id/accept|decline|complete|cancel`; activity `hub.request_*`; ride link to the session | `hub/ranking.test.ts`, `hub/mentors.test.ts`, `hub/requests.test.ts`, `integration.test.ts`, `storyline.test.ts` [A4–A10] | Hub · Mentors, Requests | done (backend); screens U2 |
| Searchable academic resource repository (notes, question papers, study materials) | `POST files/hub.resource`, `GET/POST hub/resources?q=&subject=`, `DELETE hub/resources/:id`, `GET hub/subjects`, `GET files/:id` | `hub/resources.test.ts`, `files.test.ts` [A13–A14] | Hub · Resources | done (backend); screen U2 |

## B · Smart Campus Ride-Pooling

| Requirement | Endpoints / library | Tests | Design screen | Status |
| --- | --- | --- | --- | --- |
| Drivers create rides; passengers request them | `POST/GET rides/carpool/driver`, `POST rides/carpool/driver/documents`, `POST rides/admin/drivers/:id/review`, `POST/PATCH rides/offers`, `POST rides/offers/:id/cancel|depart|complete`, `POST rides/requests` (`pickupTime` or `arriveBy`), `POST rides/offers/:id/bookings`, `POST rides/bookings/:id/accept|decline|cancel`; pooled autos (RoutePool port) | `rides/offers.test.ts`, `rides/drivers.test.ts`, `integration.test.ts` [B3–B6, B10–B11] | Rides · Find a ride, Offer a ride | done (backend); screens U2 |
| Graph-based representation of campus locations and routes | 22-stop graph (`data/graph.json`), heap Dijkstra; `GET rides/graph`, `GET rides/route`, `GET rides/nodes`; `rides.findStop` / `searchStops` for other modules | `rides/graph.test.ts`, `integration.test.ts` [B1] | Rides · Matches (stop graph) | done (backend); screen U2 |
| Matching on route compatibility, departure time, seats and maximum detour | `GET rides/offers/matches?requestId=` (cheapest detour insertion, 0.7 route + 0.3 time, hidden counts, the request's own bookings), `GET rides/matches` (pooled) | `rides/offer-plan.test.ts`, `rides/offers.test.ts`, `rides/matching-perf.test.ts`, `rides/grouping.test.ts`, `demo.test.ts` [B2, B4, B5, B7, B8] | Rides · Matches | done (backend); screen U2 |
| Dashboard of shared distance and cost savings | `GET dashboard` (rides card), `GET rides/stats/me`, `GET rides/admin/stats`, `GET rides/offers/:id` (per-booking share and savings) | `rides/stats.test.ts`, `rides/dashboard.test.ts`, `demo.test.ts` [B9] | Dashboard; Rides | done (backend + dashboard card); module screen U2. All money and distance figures are estimates |

## D · Privacy-Aware Digital Wellbeing

| Requirement | Endpoints / library | Tests | Design screen | Status |
| --- | --- | --- | --- | --- |
| Start and stop a user-controlled focus session | `startSession`, `pauseSession`, `resumeSession`, `stopSession` (`packages/wellbeing-core`) | `packages/wellbeing-core/test/session.test.ts` | Wellbeing | done (library); screen U2 |
| Categorise sample browsing events with user-defined rules | `sanitiseEvents`, `validateRules`, `compileRules`, `DEFAULT_RULES`; sample days in `packages/wellbeing-core/samples/` | `rules.test.ts`, `events.test.ts`, `samples.test.ts` [D9] | Wellbeing | done (library); screen U2. Events come from sample files (no browser extension) |
| Show focus-session duration, context switches and time on user-designated distracting sites | `computeMetrics`, `attribute`, `dailyTotals`; `PUT/GET wellbeing/totals|summary` for daily totals | `metrics.test.ts` (incl. fast-check), `wellbeing/totals.test.ts` [D1, D3] | Wellbeing · Today, Last 7 days | done (library + backend); screen U2 |
| Pause, data inspection and deletion controls | `POST wellbeing/tracking`, `GET wellbeing/records`, `GET wellbeing/export`, `DELETE wellbeing/records…`, `DELETE wellbeing/data` | `wellbeing/records.test.ts`, `wellbeing/totals.test.ts`, `storyline.test.ts` [D2, D5, D6] | Wellbeing · privacy bar, See my data, Delete | done (backend); screen U2 |
| Process locally where feasible; no page contents, credentials or unnecessary personal data | Raw events, domains, rules and sessions stay in the browser; the server keeps one total per category per day and settings; owner-only routes; no audit entries and route-pattern-only logs; focus minutes reach the hub only by opt-in (`wellbeing.studyMinutesThisWeek`) | `wellbeing/roles.test.ts`, `wellbeing/logs.test.ts`, `integration.test.ts`, `storyline.test.ts` [D7, D8, A11, I2] | Wellbeing · Consent | done |

## Integration

| Requirement | How it is met | Tests | Design screen | Status |
| --- | --- | --- | --- | --- |
| A unified landing page or dashboard | `GET dashboard` (per-module cards, each isolated with a 1.5 s budget), `GET dashboard/week` (week strip from every module's `weekItems`), inbox preview | `dashboard.test.ts`, `dashboard-week.test.ts`, `integration.test.ts`, `demo.test.ts`; web `dashboard.test.tsx`, `module-cards.test.ts` [P5, P6, I3] | Dashboard "Your week" | done (screen built in U1; hub and wellbeing cards added in P6) |
| Consistent navigation and user experience | One shell from `GET modules` (role-aware sidebar, top bar under 1024 px), shared components and states, design tokens | web `shell.test.tsx`, `states.test.tsx`, `npm run test:visual` | Shell | done for platform screens (U1); module screens U2 |
| A shared data model or clearly defined interfaces between modules | One PostgreSQL database, one Prisma schema per owner area; modules never import each other: `platform.modules.get(id)` returns a module's read-only `publicApi` (contracts `*/public.ts`, validated, 500 ms, actor-scoped); shared Zod contracts in `packages/contracts` | `integration.test.ts`, `modules.test.ts`, `openapi.test.ts` [I1, I4] | — | done |
| A common notification or activity mechanism | `activity_events` + live SSE (`GET activity/stream`), one registry of typed events: platform announcements and new accounts, hub requests, rides joins/accepts/cancellations, wellbeing weekly summary | `activity.test.ts`, `stream.test.ts`, `storyline.test.ts`, `integration.test.ts` [P7, P11] | Inbox | done |
| Role-based access | `requireAuth` + `requireRole` on every route (module outer guard ∩ route guard), ownership checks inside; `docs/ROLES.md` generated from the guards (`npm run docs:roles`) | `route-guards.test.ts`, `roles.test.ts`, each module's roles tests [P8, P9, A15, B12, D7] | 403 page | done |
| Sample data and test scenarios for the implemented modules | One time-relative, idempotent seed across platform, hub, rides and wellbeing (`npm run db:seed`), `npm run demo:reset`; `docs/TEST-SCENARIOS.md`; the storyline test | `demo.test.ts`, `storyline.test.ts` | — | done |

## Deliverables

| Deliverable | Where | Status |
| --- | --- | --- |
| Working source code for Platform, A, B, D | this repository | done (backend and platform screens); A, B, D screens U2 |
| Setup instructions | `README.md` "Setup" | done |
| API documentation | `docs/api/openapi.json` (`npm run api:docs`, test-checked), `/api/docs` in dev | done |
| Role and access matrix | `docs/ROLES.md` (`npm run docs:roles`, test-checked) | done |
| Algorithms and assumptions | `docs/ALGORITHMS.md`, `docs/ASSUMPTIONS.md` | done for A, B, D |
| Implemented vs simulated | `README.md` table (simulated: payments, driver ETA, browsing events from sample files instead of a browser extension; energy figures are estimates) | done |
| Test scenarios and automated tests | `docs/TEST-SCENARIOS.md`; `npm test` (API against `universe_test`, web, wellbeing-core) | done |
| Requirements coverage | this file | done |
| Architecture diagram | `docs/ARCHITECTURE.md` | P9 |
| Disclosure of AI tools and models | `docs/DISCLOSURES.md` | P9 (started; completed in P9) |
| README known limitations, overview, module sections | `README.md` placeholders | P9 |
| Presentation and live demo | — | P9 (the storyline in `docs/TEST-SCENARIOS.md` is the demo script) |
| Module C (Observatory), Module E (Exam monitoring) | — | Person 2 |
