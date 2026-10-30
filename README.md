# UniVerse

One campus platform with five modules: Student Hub (A), Ride-Pooling (B), Sustainable Computing Observatory (C), Digital Wellbeing (D) and Responsible Examination Monitoring (E).

> **Placeholder (P9):** overview, screenshots and the demo storyline.

## Setup (macOS, no Docker)

You need Homebrew, Node.js 22.12+ or 24 (`.nvmrc` pins 24) and about 10 minutes.

### 1. PostgreSQL and PostGIS

```bash
brew info postgis              # note the postgresql@<N> it is built against
brew install postgresql@18 postgis
brew services start postgresql@18
```

### 2. Database role and databases

Pick a strong password and use it in step 3.

```bash
psql -d postgres <<'SQL'
CREATE ROLE universe LOGIN CREATEDB PASSWORD 'choose-a-strong-password';
CREATE DATABASE universe OWNER universe;
CREATE DATABASE universe_test OWNER universe;
CREATE DATABASE universe_shadow OWNER universe;
SQL

# PostGIS lives in its own schema, so Prisma never sees its tables and resets keep it.
# universe_shadow is Prisma's shadow database for `prisma migrate dev` (PostGIS migrations).
for db in universe universe_test universe_shadow; do
  psql -d "$db" <<SQL
CREATE SCHEMA IF NOT EXISTS extensions AUTHORIZATION universe;
CREATE EXTENSION IF NOT EXISTS postgis SCHEMA extensions;
ALTER DATABASE $db SET search_path = "\$user", public, extensions;
SQL
done
psql -d universe -c 'SELECT extensions.postgis_version();'
```

Recommended (all three databases): store and compute times in UTC. The API pins every connection to UTC itself, so this only makes `psql` and other tools agree with it:

```bash
for db in universe universe_test universe_shadow; do psql -d "$db" -c "ALTER DATABASE $db SET timezone TO 'UTC';"; done
```

`CREATE EXTENSION postgis` needs a superuser; on Homebrew that is your macOS user, which `psql -d postgres` connects as. The `extensions` schema must be owned by `universe` in all three databases (`AUTHORIZATION universe`): the rides migration also creates `btree_gist` there as `universe`. `prisma.config.ts` uses `universe_shadow` on the same server unless `SHADOW_DATABASE_URL` is set.

#### Exam Review (Module E, optional)

Module E runs as its own Django service in `services/exam/` (contract: `docs/integration/exam-service.md`) with its own database and role, which have no rights on `universe`:

```bash
psql -d postgres <<'SQL'
CREATE ROLE universe_exam LOGIN PASSWORD 'choose-another-strong-password';
CREATE DATABASE universe_exam OWNER universe_exam;
REVOKE ALL ON DATABASE universe FROM universe_exam;
SQL
```

Then set both `EXAM_SERVICE_URL=http://127.0.0.1:8000` and `SERVICE_TOKEN_EXAM` (`openssl rand -base64 32`, the same value in the service's env) in `apps/api/.env`, and start the service as `services/exam/README.md` says (it listens on 127.0.0.1 only, with `waitress`). With either variable unset, Exam Review is simply not installed: it is absent from the navigation and `/api/exam/*` is 404.

### 3. Environment files

```bash
cp apps/api/.env.example apps/api/.env
cp apps/api/.env.test.example apps/api/.env.test
```

In both files, put the role password into `DATABASE_URL` and generate `CSRF_SECRET` and `EMAIL_HMAC_SECRET` with `openssl rand -base64 32` (a different value for each variable and each file). In `apps/api/.env`, set `SEED_DEMO_PASSWORD` (12+ characters): every demo account uses it. `.env` files are git-ignored; never commit them.

Uploaded files are stored outside the repository. Create the folder and put its absolute path in `apps/api/.env` as `STORAGE_DIR` (tests use a fresh temporary folder on their own):

```bash
mkdir -p ~/universe-storage && chmod 700 ~/universe-storage
echo "STORAGE_DIR=$HOME/universe-storage" >> apps/api/.env
```

### 4. Install, migrate, seed

```bash
npm ci                 # also generates the Prisma client
npm run db:deploy      # apply migrations to universe
npm run db:seed        # demo accounts and welcome messages (safe to re-run)
```

### 5. Run

```bash
npm run dev            # API on :4000 (watch) + web on http://localhost:5173
```

or, as a judge would run it, one port:

```bash
npm run build && npm start   # http://localhost:4000 serves the API and the web app
```

### Demo accounts

All use the `SEED_DEMO_PASSWORD` from `apps/api/.env`.

| Email | Name | Role |
| --- | --- | --- |
| student@universe.test | Aarav Mehta | student |
| student2@universe.test | Diya Kulkarni | student (carpool driver: car, 3 seats; women-only rides off) |
| mentor@universe.test | Prof. Neha Iyer | mentor (carpool driver: car, 3 seats) |
| invigilator@universe.test | Rohan Desai | invigilator |
| admin@universe.test | Admin Office | admin |
| sameer.joshi@universe.test, kavita.nair@universe.test, arjun.menon@universe.test | Dr. Sameer Joshi, Prof. Kavita Nair, Prof. Arjun Menon | mentor (Student Hub: slots, Kavita has 5 mentees) |
| kabir.shah@universe.test, ishita.rao@universe.test | Kabir Shah, Ishita Rao | student (Student Hub sample data; carpool drivers, cars with 3 seats) |
| sneha.patil@universe.test | Sneha Patil | student (female rider with women-only rides on) |
| rahul.verma@universe.test | Rahul Verma | student |
| aditya.rane@universe.test | Aditya Rane | student, **inactive** (shows the INACTIVE state; cannot sign in) |
| priya.more@drivers.universe.test (and the other six roster drivers, `first.last@drivers.universe.test`) | Priya More | driver (auto, online, documents approved) |
| kiran.pawar@drivers.universe.test | Kiran Pawar | driver (licence expiring in ~10 days, no vehicle) |
| ganesh.salunkhe@drivers.universe.test | Ganesh Salunkhe | driver (no documents, no vehicle) |

The seed tells one story, relative to the time you run it (details in `docs/TEST-SCENARIOS.md`, "Demo data"):
- **Aarav (`student@`)**, week strip: today "Tracking paused"; tomorrow 08:10 Borivali → SPIT with Diya driving (confirmed) and a 17:30 return still searching; the Saturday prep-goal deadline (6 left); Sunday 09:00 weekly summary; Monday 15:30 mentor session with Prof. Neha Iyer at SPIT Main Gate, with a ride link. Inbox: the admin's "Library open until 23:00 through exam week." (2 hours ago), Diya's and Neha's acceptances (earlier today, unread), last week's wellbeing summary and the welcome (read). Wellbeing: today 3 h 32 m, 7-day average 4 h 24 m.
- **Rides:** Aarav's 08:10 request matches Diya (joined, 1 of 3 seats left), Kabir and Ishita (eligible), and hides Neha's 07:55 (outside ±10 min). Neha drives 08:30 from Malad the day after tomorrow (Ishita accepted; Kabir and Aarav requesting). Kabir drives to SPIT Main Gate on Monday, arriving about 15:07. One completed shared ride yesterday feeds Aarav's savings. Pooled autos: two forming groups and one open request.
- **Reset:** `npm run demo:reset -- --yes` empties every hub, rides and wellbeing table and the activity feed (never users, sessions or the audit log) and seeds again, so the story starts from now. It refuses unless the database is on `localhost`/`127.0.0.1` and is `universe` with `NODE_ENV=development` (or `universe_test` with `NODE_ENV=test`); without `--yes` it only prints what it would delete.

The web app has the platform screens (sign-in, forced and voluntary password change, dashboard "Your week", inbox, admin users and audit log) built from the team's Claude Design handoff; module screens arrive in U2, and every feature is reachable through the API (see `docs/api/openapi.json`). Set `VITE_DEMO_MODE=true` (e.g. in `apps/web/.env.local`) to list these accounts on the sign-in screen: a click fills the email only, never a password.

To run a second copy of the repo beside the first, put `WEB_PORT` and `API_PORT` in `apps/web/.env.local` (the dev server's port and the API it proxies to).

### Tests and checks

```bash
npm test               # API tests against universe_test (migrations applied first) + web tests
npm run typecheck
npm run lint
npm run db:test:reset  # optional: drop and re-create universe_test's tables from migrations
npm run api:docs       # regenerate docs/api/openapi.json after changing routes (a test checks it)
npm run docs:roles     # regenerate docs/ROLES.md (who may call each route) from the route guards (a test checks it)
npm run demo:reset -- --yes  # start the demo story again from now (local databases only)
npm run test:visual    # web screenshots vs committed baselines (route-mocked; no API needed)
npm run design:compare # prototype vs build pixel comparison -> docs/sessions/U1-compare/
```

First time only: `npx playwright install chromium`. Visual baselines are macOS Chromium; after a deliberate UI change run `npm run test:visual -- --update-snapshots` and review every changed image. The design rules are in `docs/design/DESIGN-SYSTEM.md`.

The API contract is `docs/api/openapi.json` (OpenAPI 3.1). With `npm run dev` running, browse it at http://localhost:4000/api/docs (not served in production).

API tests refuse to run unless `DATABASE_URL` in `apps/api/.env.test` points at a database whose name ends in `_test`.

## Known limitations

- **Times stored before P8 on an existing `universe` database are 5 h 30 m early** (P7-001: connections used the Mac's IST session time zone). The API now pins every connection to UTC, and `npm run demo:reset -- --yes && npm run db:seed` re-creates all demo data correctly. Rows the reset does not touch — users' `created_at`/`last_login_at`, sessions and the append-only audit log — keep the old shift on a local dev database; the audit log is deliberately not rewritten (its trigger forbids it). Existing sessions may expire early: sign in again. A fresh setup is not affected.

## Architecture

> **Placeholder (P9):** monorepo layout, request pipeline, sessions and CSRF, activity feed and SSE, link to `docs/ARCHITECTURE.md`.

## Modules

> **Placeholder (P9):** one section per module (A–E): what it does, main screens, API routes.

## Implemented vs simulated

| Feature | Status |
| --- | --- |
| Sign-in, sessions, roles (student, mentor, invigilator, driver, admin), CSRF, audit log, activity feed with live SSE, file storage | Implemented |
| Rides: stop graph and road distances | 22 stops with branches: OSRM road distances and Nominatim coordinates for 14 city stops (generated once, committed); 8 campus points hand-placed with straight-line x 1.3 edges, marked `estimated`; durations from documented average speeds. Not live routing or live traffic |
| Rides: carpool (students and mentors drive their own car or bike) | Implemented: application, document and admin approval, offers, seat requests, auto/manual accept, detour-based matching, cost sharing in paise, depart/complete |
| Rides: cost sharing and savings | Implemented as estimates: carpool cost per km (car Rs 7, bike Rs 2.50) and the solo auto fare it is compared with are fixed demo rates; no money moves |
| Rides: shared-ride statistics (per week, busiest routes, occupancy) | Implemented from completed rides; every figure labelled an estimate |
| Rides: requests, matching, groups, seat locking, leave lock, women-only groups, fares in paise | Implemented |
| Rides: auto-rickshaw tariff (Rs 27 first 1.5 km, Rs 18/km, x1.2) | Implemented with fixed Mumbai demo rates |
| Rides: drivers and vehicles | Seeded roster of 7 autos and 9 driver accounts; driver assignment, accept/decline, trip steps, document review implemented |
| Rides: driver documents and inspection photos | Implemented uploads and review; the seeded documents are placeholder PDFs |
| Rides: payment | **Simulated**: records that the rider finished the payment step and the method; no money moves |
| Rides: driver ETA | **Simulated**: random 3–8 minutes at assignment |
| Rides: ride to a mentor session (`arriveBy`) | Implemented: pickup time = arrival time minus the shortest-path driving time on the stop graph (an estimate from average speeds) |
| Rides: group chat | Implemented (stored, live over SSE) |
| Hub: profiles, placement goals, prep tracker with weekly goal, readiness and 30-day progress | Implemented (backend; screens in U2). The prep catalogue's problem counts are demo sizes |
| Hub: mentor ranking, slots and mentorship requests | Implemented: ranking from prep weakness, interests, free slots and load; row-locked accept; activity events |
| Hub: resource repository with search | Implemented: uploads checked from the bytes, full-text plus uploader-name search, soft delete. The six seeded files are generated title pages padded to the design's sizes |
| Wellbeing: browsing events, sanitising, rules, focus sessions, metrics | Implemented as a browser-side library (`packages/wellbeing-core`), tested with three synthetic sample days; the UI and IndexedDB storage come in U2. **Simulated input:** there is no browser extension; browsing events come from the sample files (import demo) |
| Wellbeing → Student Hub: focus study minutes | Implemented, opt-in: the hub shows this week's study minutes only when the student turns sharing on; nothing else leaves Wellbeing |
| Wellbeing: daily totals, consent per category, pause, see my data, export, delete | Implemented (backend; screens in U2). The server stores only one total in minutes per category per day and the settings |
| Wellbeing: weekly summary, retention | Implemented (hourly job; notification text only, no numbers) |
| Web: platform screens (sign-in, password change, dashboard, inbox, admin) | Implemented against the real API, light and dark, 360px and up |
| Web: dashboard week strip | Implemented (`GET /api/dashboard/week`) with items from Hub, Rides and Wellbeing |
| Web: dashboard cards for Hub, Rides, Wellbeing; inbox wording | Implemented from each module's summary and activity contracts |
| Cross-module links (`platform.modules.get`) | Implemented: read-only, validated, 500 ms limit; a missing module never breaks another |
| Role-based access | Implemented on every route; `docs/ROLES.md` is generated from the guards |
| Demo data | Seeded, time-relative and consistent across modules; `npm run demo:reset` |
| Web: Hub, Rides, Wellbeing, Observatory, Exam screens | Placeholder "Coming in the next build" (U2 / Person 2) |
| Observatory (Module C) | **Dropped** by team decision |
| Exam Review (Module E): platform gateway | Implemented: `/api/exam/*` forwarded to the exam service after the platform's session, role, CSRF, password-change and rate-limit checks (streamed bodies, 200 MB limit, header allow-list, 503 when down); internal activity, audit and live-progress routes for the service |
| Exam Review: the service (clips, flags for human review) | Being built in `services/exam/` (phase E1). Flags are for human review only; nothing is decided automatically |
