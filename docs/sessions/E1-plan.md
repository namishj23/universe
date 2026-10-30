# E1 plan: Module E exam service (unattended)

Branch `p1/e1-exam-service` from `origin/main` (Person 2's code is under `services/exam/`).
Contract: `docs/integration/exam-service.md` on `origin/p1/p8-fixes` (same text as the E1 prompt). P8's
`packages/contracts/src/{activity,audit,exam}/exam.ts` define the exact params the platform accepts;
the service sends exactly those.

## Layout after step 1

```
services/exam/
  manage.py  requirements.txt  requirements-dev.txt  pytest.ini  README.md  openapi.json
  .gitignore  .gitattributes  .env (ignored)
  exam_service/          Django project (settings, urls, wsgi)
  surveillance/          the app: models, middleware, errors, views, serializers, jobs, outbox,
                         explanations, management commands (process_video, run_worker, seed_demo)
  ml/                    inference: model loading (ML_DIR only, SHA-256 logged, DEVICE), FrameAnalyzer,
                         tracker, head baselines, event builder (Person 2's detection logic, unchanged maths)
  ml/training/           prepare_dataset.py, train_classification.py, README (how the classifier was trained)
  scripts/               fetch_weights.py, fetch_samples.py, test.sh
  tests/                 pytest-django
```

## Steps and commit groups

1. Steps 1–4: LF + `.gitattributes`; restructure; pinned requirements (no simplejwt/CORS, + waitress,
   drf-spectacular); fetch scripts; Postgres only (no SQLite, no Docker); fresh `0001_initial` with UUID
   ids and plain UUID user columns (Person 2's 0001–0004 only ever ran on her SQLite and depend on
   `auth.User`); `PlatformIdentity` middleware (loopback, HMAC token, identity headers, role); one error
   handler for every error. Push.
2. Steps 5–6: `/exam/` endpoints with strict serializers, cursor paging, magic-byte uploads streamed to
   `MEDIA_ROOT`, Range video, API-only snapshots, review/reopen with row lock + history + outbox in one
   transaction, explanations. Push.
3. Steps 7–8: `Outbox` + delivery (retries, backoff, idempotency keys); one worker process
   (`manage.py run_worker`) that runs jobs one at a time from a DB queue (survives restarts) and delivers
   the outbox; stalled jobs → failed. Push.
4. Steps 9–10: wording sweep; tests + `scripts/test.sh`. Push.
5. Steps 11–12: 4-clip accuracy note; README, `openapi.json`, integration notes, DISCLOSURES rows. Push.
6. If time: 14 `seed_demo`, then 13 live webcam. E2E against P8's gateway on a throwaway branch.
7. `PROGRESS.md` (own commit), `docs/sessions/E1.md`, PR, `E1.status` last.
