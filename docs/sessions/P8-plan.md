# P8 plan — fix the P7 audit findings (Person 1, unattended)

Branch `p1/p8-fixes` from `origin/main` (P1–P7 merged). Time box ≈ 3 h; report at ≈ 2.5 h.

## Tier 0 — exam-service gateway (push at once)
1. Contract verbatim → `docs/integration/exam-service.md`.
2. Env (optional): `EXAM_SERVICE_URL`, `SERVICE_TOKEN_EXAM` (≥ 32 chars), `SERVICE_ALLOW_REMOTE`.
3. Platform: `platform.services.get(id)` (url + token of that module's service, or undefined);
   a factory may return `null` (= not installed); definition fields `internalRoutes(router)`
   (mounted at `/internal/<id>`: SHA-256 + `timingSafeEqual` token check, loopback only,
   64 kB JSON, rate limit) and `rawBody` (global JSON parser skipped so the gateway streams);
   `platform.streams.track(req, res, { maxMs })` (closed on logout, deactivation, maxMs ≤ 2 h, shutdown);
   `platform.serviceEvents.once(tx, module, key)` idempotency on new table `platform_service_events` + 7-day sweep.
4. `apps/api/src/modules/exam/`: gateway (Node `http`, `pipeline`, header allow-list, 413 past 200 MB,
   connect 2 s / headers 30 s, 503 `MODULE_UNAVAILABLE`), dashboard provider, OpenAPI, internal
   `activity` / `audit` / `push`; contracts `activity/exam.ts` (fixed templates), `audit/exam.ts`.
5. Tests with a fake upstream; `.gitattributes` + renormalise; `.gitignore`; Person 2's Windows fix
   merged on a throwaway branch if green; PROGRESS/README; push.

## Tier 1 — HIGH: P7-001 … P7-006 (each with its permanent test; probes moved into the test folders)
## Tier 2 — MEDIUM in the prompt's order: 008, 013, 014, 016, 007, 009, 010, 011, 012, 015, 022abc, 017
## Tier 3 — LOW in the prompt's order, as time allows

Gates after each tier; one commit per finding (message starts with the ID); report + status last.
