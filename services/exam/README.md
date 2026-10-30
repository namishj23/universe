# Exam service (Module E)

A Python/Django service behind the UniVerse platform. The browser never calls it: the platform forwards `/api/exam/*` to `http://127.0.0.1:8000/exam/*` with a shared service token and the signed-in user's identity. Contract: `docs/integration/exam-service.md`.

Upload a clip and a background analysis job raises **flags for human review** (head turned away, phone visible, restricted-zone entry; "unusual posture (supporting detail)" only when the optional classifier is on). The service never decides anything: a person dismisses a flag or marks it for follow-up.

## Setup (macOS and Windows, Python 3.11)

```bash
cd services/exam
python3.11 -m venv .venv
source .venv/bin/activate              # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
```

**Windows + NVIDIA GPU:** install the CUDA build of PyTorch first, then the file:

```bash
pip install torch==2.15.0 torchvision==0.29.2 --index-url https://download.pytorch.org/whl/cu126
pip install -r requirements-dev.txt
```

### Database (PostgreSQL, own role and database)

```bash
psql -h 127.0.0.1 -d postgres -c "CREATE ROLE universe_exam LOGIN CREATEDB PASSWORD 'choose-a-password';"
psql -h 127.0.0.1 -d postgres -c "CREATE DATABASE universe_exam OWNER universe_exam;"
```

`CREATEDB` lets Django create its own test database. The role has no rights on `universe`.

### Environment (`services/exam/.env`, git-ignored)

| Name | Meaning |
| --- | --- |
| `DJANGO_SECRET_KEY` | random, ≥ 50 characters |
| `DJANGO_DEBUG` | `0` |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_HOST`, `POSTGRES_PORT` | `universe_exam` connection |
| `SERVICE_TOKEN_EXAM` | ≥ 32 random characters, the same value as in `apps/api/.env` |
| `PLATFORM_INTERNAL_URL` | e.g. `http://127.0.0.1:4000` (activity and audit calls) |
| `MEDIA_ROOT` | folder outside the repo for clips and snapshots |
| `ML_DIR` | folder outside the repo with the model weights |
| `DEVICE` | `auto` (cuda, else mps, else cpu), or one of those |
| `POSTURE_FLAGS_ENABLED` | `0` (default) or `1` |

### Model weights (in `ML_DIR`)

- `yolov8n.pt` and `yolov8n-pose.pt` from https://github.com/ultralytics/assets/releases/tag/v8.2.0
- `exam_behaviour_cls.pt` is optional: loaded only when `POSTURE_FLAGS_ENABLED=1`; if missing or altered the service logs one warning and runs without it.

```bash
python manage.py migrate
```

## Run

```bash
waitress-serve --host 127.0.0.1 --port 8000 --max-request-body-size 210000000 exam_service.wsgi:application
```

Analysis runs in a background thread inside that process, one job at a time. Never use `runserver` for the demo.

**Demo data:** put the sample clips in `~/Desktop/exam-samples/`, then

```bash
python manage.py seed_demo
```

creates the exam "DBMS Mid-sem · Room T1" and processes each clip; running it again changes nothing.

## Try it with curl

```bash
TOKEN=...   # SERVICE_TOKEN_EXAM, never paste it into a shared place
curl -s http://127.0.0.1:8000/exam/flags?status=open \
  -H "X-Service-Token: $TOKEN" \
  -H "X-UniVerse-User-Id: 00000000-0000-4000-8000-000000000001" \
  -H "X-UniVerse-User-Role: invigilator"
```

Without the token: 401. With role `student`: 403. From a non-loopback address: 403.

## Tests

```bash
scripts/test.sh        # pytest -m "not slow"
```

## Limitations

- A GPU is optional; CPU is slower but fine for short clips.
- The live webcam must be on the same machine as the service.
- The restricted zone is a rectangle (percent of the frame).
- The outbox is deferred: activity and audit calls go straight to the platform with 3 retries and are logged if they still fail.

## Not committed

`.env`, media (clips and snapshots show people), model weights, videos, datasets, `.venv`.
