# UniVerse — rules for every Claude Code session

Read this file and `PROGRESS.md` fully before doing anything else. `PROGRESS.md` is the project memory: what is done, what was decided, what is open.

## What we are building

UniVerse is one campus platform with five modules, built in a 12-hour hackathon by two people. It must run on a laptop for a live demo, but every workflow we ship is built to production standard: secure, fast, tested. When time is short, we cut scope, never quality.

| Module | Name | Owner |
| --- | --- | --- |
| Platform | Auth, roles, app shell, unified dashboard, activity feed, setup | Person 1 |
| A | Student Intelligence and Academic Hub | Person 1 |
| B | Smart Campus Ride-Pooling (existing RoutePool code, moved in) | Person 1 |
| D | Privacy-Aware Digital Wellbeing | Person 1 |
| C | Sustainable Computing Observatory | Person 2 |
| E | Responsible Examination Monitoring | Person 2 |

## Ownership rules

- Each module has exactly one owner. Only the owner edits that module's folders.
- Shared areas change only through a pull request the other person approves: `packages/contracts/`, `apps/web/src/shell/`, `apps/api/src/platform/`, the root `package.json`, `prisma/schema/base.prisma`, `prisma/schema/platform.prisma`, and `prisma/seed/index.ts`.
- If a session needs a change in someone else's module or a shared area, stop and write it up under "Requests for the other owner" in `PROGRESS.md` instead of editing it.

## Stack (do not change without recording a decision in PROGRESS.md)

- Monorepo with npm workspaces. TypeScript for all new code (strict mode). Module B stays JavaScript until it is moved in.
- API: Node.js + Express 4 (same major version as Module B so its routers mount unchanged), one process.
- Database: PostgreSQL with the PostGIS extension, installed with Homebrew on the Mac. No Docker. One database, `universe`; tests use `universe_test`.
- ORM: Prisma, multi-file schema in `prisma/schema/`, one file per owner area: `platform.prisma`, `hub.prisma`, `rides.prisma`, `wellbeing.prisma`, `observatory.prisma`, `exam.prisma`.
- Validation: Zod, schemas shared through `packages/contracts`.
- Web: React + Vite + TypeScript + React Router.
- Vision service (Module E only): Python + FastAPI in `services/vision/`.
- Tests: Vitest + Supertest for the API against the real `universe_test` database; Vitest + Testing Library for the web; pytest for Python.

Before writing code against any library, check its current documentation with Context7. Do not rely on memory for library APIs (Prisma, Express, React Router and Vite change between major versions).

## Repo layout

```
apps/api/src/platform/       auth, sessions, roles, activity feed, health (Person 1)
apps/api/src/modules/hub/    Module A (Person 1)
apps/api/src/modules/rides/  Module B (Person 1)
apps/api/src/modules/observatory/  Module C (Person 2)
apps/api/src/modules/exam/   Module E (Person 2)
apps/web/src/shell/          layout, navigation, dashboard, notification bell (Person 1)
apps/web/src/modules/{hub,rides,wellbeing,observatory,exam}/
packages/contracts/          shared Zod schemas and types
packages/wellbeing-core/     Module D browser-side library (Person 1)
prisma/schema/               one .prisma file per owner area
services/vision/             Python vision service (Person 2)
tools/loadsim/               Module C load simulator (Person 2)
docs/                        ARCHITECTURE, ALGORITHMS, ASSUMPTIONS, TEST-SCENARIOS, DISCLOSURES
```

## Quality bar (the Hour 9 audit checks every item)

Security
- Validate every request body, query, param and upload with a Zod schema; reject unknown fields (`.strict()`).
- Database access only through Prisma or tagged-template `$queryRaw`. Never build SQL with string concatenation or `$queryRawUnsafe`.
- Every route checks the role AND ownership, so changing an ID in a URL can never expose another user's data.
- Passwords hashed with Argon2id. Sessions are random opaque tokens in an httpOnly, SameSite=Lax cookie (Secure when served over HTTPS); only a SHA-256 hash of the token is stored. No tokens in localStorage.
- Every state-changing request (POST, PUT, PATCH, DELETE) requires the CSRF token header.
- Rate-limit login and uploads. Same error message for a wrong email and a wrong password.
- Errors return `{ error: { code, message, requestId } }`. Stack traces only in server logs, never in responses. Never log passwords, cookies, tokens, CSRF tokens or browsing data.
- Secrets only from environment variables, validated at startup. Never commit `.env`. Never copy Module B's `backend/.env` anywhere: it contains real credentials.
- `npm audit --omit=dev` and `pip-audit` show no high or critical issues before submission.

Performance
- Index every foreign key and every column used to filter or sort. Run `EXPLAIN` on any new query that filters a table expected to grow.
- Every list endpoint is paged on the server (cursor paging, default 20, max 100).
- No N+1 queries: load related data with `include`/`select` or one batched query.
- Live updates use Server-Sent Events, never polling. Heavy work (vision) runs outside the request.
- Web: debounce search inputs, cancel stale requests with AbortController, and clean up every timer, listener and EventSource on unmount.

Reliability
- Multi-step writes run in one transaction. Unique constraints, not app checks, prevent duplicates.
- Every screen has loading, empty and error states.
- The API shuts down cleanly on SIGTERM/SIGINT: stop accepting requests, close SSE streams, disconnect Prisma.

Honesty
- Energy and carbon numbers are always labelled "estimate".
- Exam monitoring only raises "flags" for human review. Never use the words "cheating" or "misconduct" for a flag, and never apply a penalty automatically.
- The README keeps an "Implemented vs simulated" table up to date.

## How every session works

1. Read `CLAUDE.md` and `PROGRESS.md`. Confirm `git status` is clean and you are on a new branch named `p1/<phase>-<short-name>` or `p2/<phase>-<short-name>`.
2. Use plan mode: present the plan, wait for approval, then build.
3. Build in small commits with clear messages. Run the owner's tests and `npm run typecheck` and `npm run lint` before finishing.
4. Never delete data, drop tables, force-push, rewrite history or change another owner's files without asking first.
5. Fix root causes. No temporary workarounds, no disabled tests, no `any` to silence the type checker, no `// @ts-ignore`.
6. Backend first: until the team's UI design arrives (phases U1–U2), sessions build no screens, styling or layout. Front-end logic that already exists in `apps/web/src/platform/` is kept for reuse.
7. End the session by:
   - updating `PROGRESS.md` (phase status, decisions, issues, requests, next step) with exact file paths;
   - updating this `CLAUDE.md` only if a rule or the stack changed;
   - writing the full session report below to `docs/sessions/<phase id>.md`, committing it, and printing the same report in full at the end of the session so it can be pasted into the implementation plan.

## Session report format (every section is required; write "none" if empty)

```
# Session <phase id>: <title>

## 1. Session details
- Owner: <Person 1 or Person 2>
- Model / effort: <model>, <effort>
- Started / finished: <local times>, duration <minutes>
- Branch: <branch name> · Commits: <count> · Pull request: <link or "not opened">

## 2. Summary
<3–5 lines in plain language: what this phase delivered and whether it is complete>

## 3. What was done
<numbered list, one line per item, matching the prompt's steps>

## 4. Issues hit
| Issue | Root cause | Fix | Files |
| --- | --- | --- | --- |

## 5. Changed vs the prompt
| Prompt asked for | What was done instead | Why |
| --- | --- | --- |

## 6. Decisions made
<each decision and its reason; also added to PROGRESS.md>

## 7. Files
- Created: <paths>
- Changed: <paths>
- Deleted: <paths>
- Database migrations: <names, and what each changes>

## 8. Tests and checks
| Check | Command | Result |
| --- | --- | --- |
(include typecheck, lint, every test suite with pass/fail counts, `npm audit --omit=dev`, and any EXPLAIN output the prompt asked for)

## 9. Security and performance review
<how this phase meets each relevant rule in CLAUDE.md's quality bar; anything not met and why>

## 10. Done checklist
<the prompt's "Done when" list, each item ticked or marked not done with the reason>

## 11. Still open
| Item | Owner | Blocks what |
| --- | --- | --- |

## 12. How to verify by hand
<exact commands and clicks for a person to confirm the phase works in 5 minutes>

## 13. Next step
<the next phase and anything it must know>
```
