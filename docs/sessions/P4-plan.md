# P4 plan — Module A: Student Hub backend (unattended)

Branch `p1/p4-hub` from `p1/p3b-rides-offers` (PR #4 not merged). Backend only.

## Shape

- `apps/api/src/modules/hub/` (TypeScript, factory `(platform) => ModuleDefinition`, roles student/mentor/admin, order 10):
  - `index.ts` definition (file purpose, dashboard, seed, openapi); `routes.ts` one route table that builds both the Express router and the OpenAPI paths (same idea as rides);
  - `config.ts` weights and limits; `ranking.ts` pure normalisation, coverage, Jaccard, score, reason (unit-tested);
  - `profiles.ts`, `prep.ts`, `mentors.ts`, `requests.ts` (slots + requests), `resources.ts`, `dashboard.ts`, `seed.ts` (+ `seedFiles.ts` for valid padded PDF/PNG/JPEG bytes).
- `packages/contracts/src/hub/index.ts` (all request/response schemas, exported as `hub`), `activity/hub.ts`, `audit/hub.ts`, `dashboard/hub.ts` (real summary), `week.ts` (shared IST week helper: Sunday 00:00 → Saturday 23:59:59.999 Asia/Kolkata, fixed +05:30, no DST).
- `prisma/schema/hub.prisma` + one migration (`SET search_path TO public, extensions;` for `btree_gist`).
  - **One shared-schema line is unavoidable:** Prisma needs a back-relation on `User`, so `platform.prisma` gets `hubProfile HubProfile?` (one line). Every other hub table points at `hub_profiles(user_id)` (the rides pattern), so no more `User` relations. Recorded as a decision.

## Tables

`hub_profiles` (PK user_id → users; year CHECK FE/SE/TE/BE; text[] with cardinality and length CHECKs; capacity 0–20), `hub_topics` (text slug id, track CHECK, unique `(id, total_items)`), `hub_topic_progress` (`(user_id, topic_id)` PK, `total_items` copy with composite FK → `hub_topics(id, total_items) ON UPDATE CASCADE`, CHECK `0 <= solved <= total_items`, `tracked_since`), `hub_progress_events` (append-only, index `(user_id, created_at)`), `hub_weekly_goals` (`(user_id, week_start date)` PK, target 1–200), `hub_mentor_slots` (duration CHECK 30–180 min; `location_stop_id uuid` = rides node id type, no FK; partial unique `(mentor_id, starts_at) WHERE status <> 'cancelled'`; `EXCLUDE USING gist (mentor_id WITH =, tstzrange(starts_at, ends_at) WITH &&) WHERE (status <> 'cancelled')`), `hub_mentorship_requests` (partial unique `(student_id, mentor_id) WHERE status IN ('pending','accepted')`; indexes on mentor/status/created and student/status/created and slot), `hub_subjects` (code PK), `hub_resources` (file_id unique, no FK to files like rides; subject FK; generated weighted `tsvector` + GIN; indexes for filters and newest-first paging).

## Behaviour

- Profiles: `GET/PUT /me` (strict, partial update; name/email rejected). `GET /students/:id` — admin, or a mentor the student has sent a request to; else 404.
- Prep: `PUT /prep/topics`, `GET /prep` (tracks, untracked catalogue, `dsa`, readiness, week goal + pace, 30-day series computed backwards from current solved using events since `tracked_since`), `POST /prep/:topicId/increment` (one conditional `UPDATE … WHERE solved+delta BETWEEN 0 AND total RETURNING` = row lock, + event, one transaction; 409 out of range; `Idempotency-Key` in-memory TTL map of in-flight/finished promises, 10 min), `PUT /prep/goal`.
- Readiness = Σ weight_track × (Σsolved/Σtotal over tracked topics of the track), weights DSA .5, core .2, aptitude .15, interview .1, resume .05; an untracked track counts 0.
- Mentors: one raw query for candidates with open-slot counts (next 7 days), loads, next 3 open slots and the caller's live request; rank in memory O(M·(T+E) + M log M).
- Requests/slots: as the prompt; accept locks mentor profile row then slot row; requested slot no longer open → 409 `SLOT_TAKEN`; no slot → earliest open ≥ 1 h away else 409 `NO_OPEN_SLOT`. Either party may cancel (other party notified). Complete only after the session started.
- Resources: attach (owner, purpose, not deleted, unique), search = one raw SQL (FTS prefix query built from letters/digits only, `UNION` with uploader names via trigram ILIKE with escaped wildcards), joined to files and users; cursor `(rank, created_at, id)` when `q`, `(created_at, id)` otherwise; 60/min/user limiter. `authorizeRead` = hub role AND (attached to a live resource OR uploader OR admin); `inUse` = any resource row.
- Admin: `GET /admin/mentors` (combined W3 = weakness of Σsolved/Σtotal per topic over all students; interests = union of students' interests), `GET /admin/resources?status=active|deleted|all`, delete audited.
- Activity: `hub.request_received`, `hub.request_accepted`, `hub.request_declined`, `hub.request_cancelled`. Audit: `hub.resource_deleted` (admin only).

## Hand-worked mentor ranking (seed; Aarav)

Weakness: Arrays .12, Linked lists .10, Trees .30, Graphs .4667, DP .6857, Greedy .68. W3 = DP .6857, Greedy .68, Graphs .4667; ΣW3 = 1.8324. Aarav interests {graphs, dp, system design}.

| Mentor | coverage | Jaccard | match | avail | 1−load | score |
| --- | --- | --- | --- | --- | --- | --- |
| Neha (DP, Graphs, System design; 2 open; 1/3) | 1.1524/1.8324 = .6289 | 3/3 = 1 | .7217 | .50 | .6667 | **.6663** |
| Sameer (Graphs, Greedy; 1 open; 0/3) | 1.1467/1.8324 = .6258 | 1/4 = .25 | .5318 | .25 | 1 | **.5691** |
| Arjun (Greedy, CN; 4 open; 0/3) | .68/1.8324 = .3711 | 0 | .2783 | 1 | 1 | **.5670** |
| Kavita (Trees, DP, OS; 3 open; 5/8) | .6857/1.8324 = .3742 | 1/5 = .2 | .3307 | .75 | .375 | **.4234** |

Order: Neha, Sameer, Arjun, Kavita. Second state (tracks only Trees 3/30 and OS 2/20): Kavita covers both → top.

## Tests

`test/hub/`: ranking unit, prep (bounds, idempotency, IST week boundary, series, readiness), profiles/privacy, requests (lifecycle, one-click, NO_OPEN_SLOT, slot race, capacity, cancel frees slot, 404s, activity), slots (exclusion, re-create cancelled), resources (full flow, other's file, renamed executable, wildcards/injection, driver and invigilator 404, FILE_IN_USE, sweep), roles (driver/invigilator 403 on every hub route, admin routes refuse students), dashboard summary vs seed.
