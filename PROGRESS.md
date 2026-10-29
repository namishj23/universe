# UniVerse — progress and project memory

This file is the single memory of the project. Every Claude Code session reads it first and updates it last. Newest entries go at the top of each log.

Master plan (scope, architecture, rubric): the "UniVerse — Implementation Plan" doc. If this file and the plan disagree, this file holds the latest decision.

## Current status

| Area | Owner | Phase now | Status |
| --- | --- | --- | --- |
| Platform | Person 1 | P1 Platform core | Not started |
| A · Student Hub | Person 1 | — | Not started |
| B · Ride-Pooling | Person 1 | — | Existing code, not moved in |
| D · Digital Wellbeing | Person 1 | — | Not started |
| C · Observatory | Person 2 | — | Not started |
| E · Exam Monitoring | Person 2 | — | Not started |

## Person 1 phases

| Phase | Hours | What | Model / effort | Status |
| --- | --- | --- | --- | --- |
| P1 | 1–2.5 | Platform core: monorepo, PostgreSQL + PostGIS, contracts, auth and sessions, roles, activity feed with live stream, minimal login page | Opus 5.5 / high | Not started |
| P2 | 2.5–3.5 | App shell: layout, navigation by role, unified dashboard, notification bell, design system | Sonnet 5.5 / high | Not started |
| P3 | 3.5–4.5 | Move Module B in: Prisma schema onto shared database and users, mount routers, replace emailed-code login with platform session, remove mock DB, activity events | Opus 5.5 / high | Not started |
| P4 | 4.5–6.5 | Module A: profiles, placement prep tracker, mentor ranking, mentorship requests, resource repository | Opus 5.5 / high | Not started |
| P5 | 6.5–8 | Module D: focus sessions, rules, sample import, metrics, inspect/delete/export, local-only storage | Sonnet 5.5 / high | Not started |
| P6 | 8–9 | Cross-module links (A→B, D→A), seed data, test scenarios, demo storyline run | Sonnet 5.5 / medium | Not started |
| P7 | 9–9.5 | Independent read-only audit of Platform, A, B, D (fresh session) | Opus 5.5 / xhigh | Not started |
| P8 | 9.5–10 | Fix own audit findings | Sonnet 5.5 / high | Not started |
| P9 | 10–11 | README, architecture doc, docs and slides for Platform, A, B, D | Sonnet 5.5 / medium | Not started |

Checkpoints with Person 2: merge to `main` at Hour 5 and Hour 7. Feature freeze at Hour 9.

## Decisions (newest first)

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

(none yet)

## Open questions

- GitHub usernames of both people (for CODEOWNERS).
- Which laptop runs the demo, and does it have PostgreSQL + PostGIS installed?

## Session log (newest first)

(no sessions yet)
