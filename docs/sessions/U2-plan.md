# U2 plan: Hub, Rides and Wellbeing screens (unattended)

Branch `p1/u2-modules` (main with P1–P7 and U1 merged in). Started 2026-10-30 07:55 IST.

1. **Shared groundwork** (lead):
   - `apps/web/src/shell/ui/Widgets.tsx`: Card, CardLabel, Switch (`role="switch"`), Stepper, ProgressBar, GoalGrid, BarChart, KpiCard, from the prototype's values.
   - `WebModule.invalidates`: each module's `module.ts` maps stored activity types to query keys; `ActivityProvider` invalidates them (the one EventSource, no polling).
   - `tools/design-compare/u2/`: per-module screens + route mocks, `u2-compare.spec.ts` (project `u2`, 1440 light normal, results in `docs/sessions/U2-compare/`); pixel helpers moved to `pixels.ts`.
2. **Hub** (`apps/web/src/modules/hub/`): role tabs, Prep tracker (+1 with Idempotency-Key, optimistic), Mentors (request modal with slots, cancel confirm, ride link), Requests (accept/decline/complete, student drawer), Resources (debounced search, subject chips, upload, download, admin delete, load more), Profile, admin Mentor ranking; undrawn: mentor Slots tab.
3. **Rides** (`apps/web/src/modules/rides/`, all calls in `api.ts`): Find a ride (searchable stops, arriveBy from hub link, YOUR RIDES), Matches (API scores, SVG stop graph memoised), Offer a ride (stepper, join requests, depart/complete); undrawn: Auto pools (+ group detail, chat, feedback), Savings, driver Trips + Earnings, admin Overview/Drivers/Vehicles/Rides.
4. **Wellbeing** (`apps/web/src/modules/wellbeing/`): privacy bar in every state, today/7 days/consent, drawer, export, delete; IndexedDB store (per user, in-memory fallback); undrawn: Focus session and Rules cards, drawer device section; P7-022 (d) in `packages/wellbeing-core`.
5. Modules 2–4 are built in parallel by three sub-agents in this folder (disjoint folders); the lead integrates, runs the gates and commits + pushes after each module, in the order Hub → Rides → Wellbeing → undrawn screens.
6. Tests: wellbeing request-body privacy + sign-out clearing, hub Idempotency-Key, wellbeing 403 for admin/invigilator/driver.
7. Smoke: `tools/smoke/u2.spec.ts` against the built app on 4100 / `universe_u1`.
8. Gates, chunk sizes, P8 merge check, PROGRESS.md, `docs/sessions/U2.md`, PR, `U2.status`.
