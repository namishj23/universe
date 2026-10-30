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

`CREATE EXTENSION postgis` needs a superuser; on Homebrew that is your macOS user, which `psql -d postgres` connects as. The `extensions` schema must be owned by `universe` in all three databases (`AUTHORIZATION universe`): the rides migration also creates `btree_gist` there as `universe`. `prisma.config.ts` uses `universe_shadow` on the same server unless `SHADOW_DATABASE_URL` is set.

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
| student2@universe.test | Diya Kulkarni | student |
| mentor@universe.test | Prof. Neha Iyer | mentor |
| invigilator@universe.test | Rohan Desai | invigilator |
| admin@universe.test | Admin Office | admin |
| sameer.joshi@universe.test, kavita.nair@universe.test, arjun.menon@universe.test | Dr. Sameer Joshi, Prof. Kavita Nair, Prof. Arjun Menon | mentor (Student Hub: slots, Kavita has 5 mentees) |
| kabir.shah@universe.test, ishita.rao@universe.test, sneha.patil@universe.test, rahul.verma@universe.test | Kabir Shah, Ishita Rao, Sneha Patil, Rahul Verma | student (Student Hub sample data) |
| priya.more@drivers.universe.test (and the other six roster drivers, `first.last@drivers.universe.test`) | Priya More | driver (auto, online, documents approved) |
| kiran.pawar@drivers.universe.test | Kiran Pawar | driver (licence expiring in ~10 days, no vehicle) |
| ganesh.salunkhe@drivers.universe.test | Ganesh Salunkhe | driver (no documents, no vehicle) |

`student2` is the female demo rider with women-only groups on. The seed also adds two forming ride groups and one open request relative to the time you run it.

The web app is a placeholder until the team's UI design arrives (phases U1–U2); every feature is reachable through the API (see `docs/api/openapi.json`).

### Tests and checks

```bash
npm test               # API tests against universe_test (migrations applied first) + web tests
npm run typecheck
npm run lint
npm run db:test:reset  # optional: drop and re-create universe_test's tables from migrations
npm run api:docs       # regenerate docs/api/openapi.json after changing routes (a test checks it)
```

The API contract is `docs/api/openapi.json` (OpenAPI 3.1). With `npm run dev` running, browse it at http://localhost:4000/api/docs (not served in production).

API tests refuse to run unless `DATABASE_URL` in `apps/api/.env.test` points at a database whose name ends in `_test`.

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
| Rides: payment | Simulated: records that the rider finished the payment step and the method; no money moves |
| Rides: driver ETA | Simulated: random 3–8 minutes at assignment |
| Rides: group chat | Implemented (stored, live over SSE) |
| Hub: profiles, placement goals, prep tracker with weekly goal, readiness and 30-day progress | Implemented (backend; screens in U2). The prep catalogue's problem counts are demo sizes |
| Hub: mentor ranking, slots and mentorship requests | Implemented: ranking from prep weakness, interests, free slots and load; row-locked accept; activity events |
| Hub: resource repository with search | Implemented: uploads checked from the bytes, full-text plus uploader-name search, soft delete. The six seeded files are generated title pages padded to the design's sizes |
| Wellbeing | Not built yet (stub) |
| Observatory, Exam monitoring | Person 2 (not started) |
