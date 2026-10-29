# P6 plan — Integration: one platform, demo data, test scenarios (Person 1, unattended)

Branch `p1/p6-integration` from P5's HEAD.

## 0. Merges (done first)
- `origin/main` on `tmp/merge-main`: only the P3a/P3b merge commits, already in history (empty diff) → fast-forward.
- `origin/p1/u1-shell` (U1 finished: `docs/sessions/U1.md` exists) on `tmp/merge-u1`: conflicts in `PROGRESS.md` (both kept, newest first), `README.md` (both rows kept, U1's stale "Hub, Wellbeing not built" row dropped), `apps/web/package.json` and `vite.config.ts` (both dependencies; U1's port-aware config plus the wellbeing-core alias), `package-lock.json` (U1's side, then `npm install`). Gates: build, typecheck, lint, 290 API + 86 core + 49 web tests pass → fast-forward.
- `origin/p1/p3b-rides-offers` has nothing new.
- U1's visual tests are route-mocked (no API, no database), so nothing points at `universe_u1`; `npm run test:visual` is run and reported at the end, not a gate.

## 1. Cross-module interface (`publicApi`)
- Contracts: `packages/contracts/src/{rides,hub,wellbeing}/public.ts` (input/output Zod schemas per function, every input has `actor: { id, role }`), `packages/contracts/src/publicApi.ts` registry.
- Platform: `ModuleDefinition.publicApi` (validated at load: exactly the registry's functions); `platform.modules.get(id)` resolved at call time from a per-platform registry filled by `loadModules`; returns a wrapper that parses the input, runs the function with a 500 ms `AbortSignal`, parses the output and turns any failure into 503 `MODULE_UNAVAILABLE` (logged); `undefined` when the module is not installed.
- Rides: `findStop`, `searchStops`, `upcomingForUser` (own rides only). Hub: `sessionsForUser`, `weeklyGoal`. Wellbeing: `studyMinutesThisWeek` (null unless actor = user and sharing on).
- Tests: boundary validation, timeout, missing module, mentor gets null from wellbeing.

## 2. Week providers (U1 merged → registered in each definition)
- Rides: confirmed bookings, driven offers, requested bookings / searching requests (unconfirmed), pooled groups.
- Hub: student accepted sessions + Saturday goal deadline; mentor pending count now, accepted sessions, pending requests naming a slot (unconfirmed).
- Wellbeing (owner): "Tracking paused" at `paused_since`; "Weekly summary" Sunday 09:00 when on/paused.
- Tests: per role, isolation of a failing provider.

## 3. Cross-module features
- Hub slot creation validates `locationStopId` with `rides.findStop` (422 `STOP_NOT_FOUND`, also when rides is missing).
- `rideLink` on accepted sessions with a drivable stop: `/rides?to=<stopId>&date=YYYY-MM-DD&arriveBy=HH:MM` (15 min before, IST).
- Rides `POST /requests` accepts `arriveBy` instead of `pickupTime` (pickup = arriveBy − shortest-path duration); additive.
- Rides `GET /offers/matches` also returns the offers this request already booked (`booking` field) and works for a request matched through a carpool booking, so the design's JOINED / REQUESTED cards have data (additive; pooled matching untouched).
- Hub prep + dashboard summary: `focusStudyMinutesThisWeek` only when shared.
- Activity events audit vs design inbox; add any missing.
- Route-guard metadata: `requireRole` tags its roles, `anyRole` for any-signed-in routes, mounted table includes module guards; `npm run docs:roles` writes `docs/ROLES.md`; test fails on a route without auth (except login, health) or role metadata, and on a stale ROLES.md.

## 4. Demo data
- `seedAfter` on definitions (hub after rides) and one `seedModules()` used by the seed, demo:reset and tests.
- Platform seed: inactive demo account, design copy for the welcome message.
- Rides seed: Diya car 3 seats, women-only off; Kabir, Ishita approved carpool drivers; Sneha female + women-only; Aarav's tomorrow 08:10 Borivali → SPIT with Diya (accepted, 1 of 3 left), 17:30 return searching, Kabir + Ishita eligible, one hidden by time (Neha's Borivali → SPIT); Neha's 08:30 Malad offer (Ishita accepted, Kabir + Aarav requesting) on a day Ishita isn't driving; Kabir's Monday offer to the campus stop ≈ 15:07; P3b completed ride kept; P3a pooled demo groups moved off Aarav.
- Hub seed: Monday 15:30 slot at the campus stop (via `rides.searchStops`), Diya's pending request names a slot, request events.
- Story seed (`prisma/seed/story.ts`): admin announcement, inbox order and read state for Aarav.
- `npm run demo:reset` (guards: localhost, NODE_ENV + database pairs, `--yes`), test against `universe_test`.

## 5. Scenarios and storyline
- `docs/TEST-SCENARIOS.md`; `apps/api/test/storyline.test.ts` with live SSE checks; hook for Person 2's modules.

## 6. Coverage and README
- `docs/COVERAGE.md`; README "Implemented vs simulated".

## 7. Finish
- Gates, `api:docs`, `docs:roles`, `test:visual` reported, storyline ×3, `db:deploy` + `demo:reset --yes` + `db:seed` on `universe`, PROGRESS.md, report, status file, push, PR.
