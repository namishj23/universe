# P5 plan — Module D: Privacy-Aware Digital Wellbeing (core logic and backend)

Unattended run; written before building, on branch `p1/p5-wellbeing` (from `p1/p4-hub`).

## Privacy architecture
- Raw events, domains, rules and focus-session detail stay in the browser. They are processed by `packages/wellbeing-core` (dependency-free TypeScript, runs in browser and Node).
- The server stores only `wb_settings` (tracking state, counted categories, retention, hub-share flag) and `wb_daily_totals` (one minutes value per user, day, category), plus `wb_weekly_summaries` (which weeks were announced).
- No wellbeing audit entries; the request logger logs only the route pattern for `/api/wellbeing/*`; module errors are re-thrown without values before the platform logs them.

## Step 1 — `packages/wellbeing-core`
- `events.ts`: `BrowsingEvent`, `sanitiseEvent(raw, now)` → `{ ok, event } | { ok: false, reason }` (WHATWG `URL` does credentials/port/path stripping and IDN → punycode; IPs and localhost → `local`).
- `rules.ts`: `validatePattern`, `validateRules`, `compileRules` + `classify(domain)` (exact > longer wildcard > shorter; `*.x.com` also matches `x.com`), `DEFAULT_RULES` (distracting all off).
- `session.ts`: `startSession`, `pauseSession`, `resumeSession`, `stopSession` (typed errors).
- `metrics.ts`: `attribute()` (time slices per counted event), `computeMetrics()` (active, paused, switches, distracting, per category, per domain).
- `daily.ts`: `dailyTotals(slices, { timeZone, categories })` split at local midnight (any IANA zone via `Intl`), largest-remainder minutes per day.
- `samples/day-{1,2,3}.json` with hand-checked expected metrics and daily rows.
- Tests: unit (hand-worked numbers), fast-check properties, samples.
- Workspace wiring: root `workspaces` + build, `@universe/source` export condition, Vite alias in `apps/web`, Vitest alias in `apps/api`.

## Step 2 — backend
- Contracts: `packages/contracts/src/wellbeing/index.ts` (namespace `wellbeing`), `activity/wellbeing.ts` (`wellbeing.weekly_summary`, fixed text, no numbers), real `dashboard/wellbeing.ts`.
- Platform: `platform.schedule(name, everyMs, fn)` (`platform/scheduler.ts`, started after listen, stopped on SIGTERM/SIGINT); pino-http serializers log only `method` + route pattern for `/api/wellbeing/*`.
- `prisma/schema/wellbeing.prisma`: `wb_settings`, `wb_daily_totals`, `wb_weekly_summaries` with CHECKs; one back-relation line on `User` (as P4 did).
- Module `apps/api/src/modules/wellbeing/`: routes table (router + OpenAPI), settings, tracking, totals upload (row lock on settings, 409/422 rules, 1440 cap), summary, records (cursor), deletes, export, delete-everything, jobs (`runOnce(now)`: retention + weekly summary), dashboard summary, `studyMinutesThisWeek`, seed.

## Step 3 — seed (Aarav, design numbers, relative dates)

## Step 4 — tests (library, owner-only, upload rules, records/export/delete, jobs, logs, hub read)

## Finish
`docs/ALGORITHMS.md` Module D, `ASSUMPTIONS.md`, README table, OpenAPI, PROGRESS.md, `docs/sessions/P5.md`, `P5.status`, push, PR.
