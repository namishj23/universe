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
SQL

# PostGIS lives in its own schema, so Prisma never sees its tables and resets keep it.
for db in universe universe_test; do
  psql -d "$db" <<SQL
CREATE SCHEMA IF NOT EXISTS extensions AUTHORIZATION universe;
CREATE EXTENSION IF NOT EXISTS postgis SCHEMA extensions;
ALTER DATABASE $db SET search_path = "\$user", public, extensions;
SQL
done
psql -d universe -c 'SELECT extensions.postgis_version();'
```

`CREATE EXTENSION postgis` needs a superuser; on Homebrew that is your macOS user, which `psql -d postgres` connects as.

### 3. Environment files

```bash
cp apps/api/.env.example apps/api/.env
cp apps/api/.env.test.example apps/api/.env.test
```

In both files, put the role password into `DATABASE_URL` and generate `CSRF_SECRET` with `openssl rand -base64 32` (use a different one for each file). In `apps/api/.env`, set `SEED_DEMO_PASSWORD` (12+ characters): every demo account uses it. `.env` files are git-ignored; never commit them.

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

To see the live feed, sign in as the admin in one browser and as a student in another (or a private window), then send an announcement from the admin page.

### Tests and checks

```bash
npm test               # API tests against universe_test (migrations applied first) + web tests
npm run typecheck
npm run lint
npm run db:test:reset  # optional: drop and re-create universe_test's tables from migrations
```

API tests refuse to run unless `DATABASE_URL` in `apps/api/.env.test` points at a database whose name ends in `_test`.

## Architecture

> **Placeholder (P9):** monorepo layout, request pipeline, sessions and CSRF, activity feed and SSE, link to `docs/ARCHITECTURE.md`.

## Modules

> **Placeholder (P9):** one section per module (A–E): what it does, main screens, API routes.

## Implemented vs simulated

> **Placeholder (P9):** table of every feature and whether it is real, seeded or simulated.
