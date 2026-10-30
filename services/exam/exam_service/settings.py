"""
Settings for the UniVerse exam service (Module E).

The service sits behind the platform on 127.0.0.1 and never faces the browser
(docs/integration/exam-service.md). Every secret comes from the environment
(services/exam/.env, git-ignored); a missing one stops the service at start-up.
"""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _load_env_file(path):
    """Read KEY=VALUE lines from services/exam/.env without overriding real env vars."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())


_load_env_file(BASE_DIR / ".env")


def _required(name):
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Set {name} in services/exam/.env (see README).")
    return value


def _path(name):
    path = Path(_required(name)).expanduser().resolve()
    if path == BASE_DIR or BASE_DIR in path.parents:
        raise RuntimeError(f"{name} must be outside the repository.")
    return path


SECRET_KEY = _required("DJANGO_SECRET_KEY")
DEBUG = os.environ.get("DJANGO_DEBUG", "0") == "1"
ALLOWED_HOSTS = ["127.0.0.1", "localhost"]

# Shared with the platform: sent by it as X-Service-Token, sent back on /internal/exam/*.
SERVICE_TOKEN_EXAM = _required("SERVICE_TOKEN_EXAM")
if len(SERVICE_TOKEN_EXAM) < 32:
    raise RuntimeError("SERVICE_TOKEN_EXAM must be at least 32 characters.")
PLATFORM_INTERNAL_URL = _required("PLATFORM_INTERNAL_URL").rstrip("/")

# No admin, auth, sessions, messages or CORS: identity comes only from the platform's headers.
INSTALLED_APPS = [
    "rest_framework",
    "drf_spectacular",
    "surveillance",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "surveillance.middleware.PlatformIdentity",
    "django.middleware.common.CommonMiddleware",
]

ROOT_URLCONF = "exam_service.urls"
WSGI_APPLICATION = "exam_service.wsgi.application"
TEMPLATES = []

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": _required("POSTGRES_DB"),
        "USER": _required("POSTGRES_USER"),
        "PASSWORD": _required("POSTGRES_PASSWORD"),
        "HOST": os.environ.get("POSTGRES_HOST", "127.0.0.1"),
        "PORT": os.environ.get("POSTGRES_PORT", "5432"),
        "CONN_MAX_AGE": 60,
        "CONN_HEALTH_CHECKS": True,
    }
}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = False
USE_TZ = True

# Clips and snapshots show people: stored outside the repo, served only through the API.
MEDIA_ROOT = _path("MEDIA_ROOT")
CLIP_DIR = MEDIA_ROOT / "clips"
SNAPSHOT_DIR = MEDIA_ROOT / "snapshots"
UPLOAD_TMP_DIR = MEDIA_ROOT / "tmp"
for _dir in (CLIP_DIR, SNAPSHOT_DIR, UPLOAD_TMP_DIR):
    _dir.mkdir(parents=True, exist_ok=True)

MAX_CLIP_BYTES = 200 * 1024 * 1024
# Uploads stream to a temporary file next to the clips (never held in memory).
FILE_UPLOAD_MAX_MEMORY_SIZE = 0
FILE_UPLOAD_TEMP_DIR = str(UPLOAD_TMP_DIR)
FILE_UPLOAD_HANDLERS = ["surveillance.uploads.LimitedUploadHandler"]
DATA_UPLOAD_MAX_MEMORY_SIZE = 64 * 1024        # the non-file fields of a request
DATA_UPLOAD_MAX_NUMBER_FIELDS = 20
FILE_UPLOAD_PERMISSIONS = 0o600

SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "no-referrer"
X_FRAME_OPTIONS = "DENY"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [],
    "DEFAULT_PERMISSION_CLASSES": [],
    "UNAUTHENTICATED_USER": None,
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": ["rest_framework.parsers.JSONParser"],
    "EXCEPTION_HANDLER": "surveillance.errors.exception_handler",
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_VERSIONING_CLASS": None,
}

SPECTACULAR_SETTINGS = {
    "TITLE": "UniVerse exam service",
    "DESCRIPTION": (
        "Module E behind the platform (docs/integration/exam-service.md). The browser sees these "
        "paths under /api/exam/. Flags are observed events for human review; the service never "
        "decides anything."
    ),
    "VERSION": "1",
    "SERVE_INCLUDE_SCHEMA": False,
}

# One JSON line per event; never personal data (no names, notes or file names).
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"json": {"()": "surveillance.logs.JsonFormatter"}},
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "json"}},
    "root": {"handlers": ["console"], "level": os.environ.get("LOG_LEVEL", "INFO")},
    "loggers": {
        # Django's request logger would print the path of every 4xx; our handler logs instead.
        "django.request": {"handlers": ["console"], "level": "ERROR", "propagate": False},
        "ultralytics": {"level": "WARNING"},
    },
}

# ---------------------------------------------------------------------------
# Models and detection. Every model file is loaded from ML_DIR only.
# ---------------------------------------------------------------------------
ML_DIR = _path("ML_DIR")
DETECTION_MODEL_FILE = "yolov8n.pt"
POSE_MODEL_FILE = "yolov8n-pose.pt"
CLASSIFIER_MODEL_FILE = "exam_behaviour_cls.pt"
CLASSIFIER_SHA256 = "e990cc6f47272be1371619b349b9a00e05617cb651966c74903dc9e656a09054"
# auto = cuda, else mps, else cpu (chosen and logged when the worker starts).
DEVICE = os.environ.get("DEVICE", "auto")

# Frames analysed per second of video (the rest are skipped).
ANALYSIS_FPS = float(os.environ.get("ANALYSIS_FPS", "5"))
PERSON_CONFIDENCE = float(os.environ.get("PERSON_CONFIDENCE", "0.4"))
PHONE_CONFIDENCE = float(os.environ.get("PHONE_CONFIDENCE", "0.35"))

# The optional posture classifier is off by default: on the sample clips it was confidently
# wrong on people sitting close to the camera. When on, its signal is "unusual posture
# (supporting detail)". A missing or altered file turns it off with one warning.
POSTURE_FLAGS_ENABLED = os.environ.get("POSTURE_FLAGS_ENABLED", "0") == "1"
POSTURE_THRESHOLD = float(os.environ.get("POSTURE_THRESHOLD", "0.85"))

# Head turn: nose offset from the shoulder centre (in shoulder widths), compared with that
# person's own usual offset; with no shoulders in frame, from the eye midpoint (eye distances).
HEAD_TURN_OFFSET = float(os.environ.get("HEAD_TURN_OFFSET", "0.25"))
HEAD_TURN_FACE_OFFSET = float(os.environ.get("HEAD_TURN_FACE_OFFSET", "0.35"))
HEAD_TURN_WARMUP_SECONDS = float(os.environ.get("HEAD_TURN_WARMUP_SECONDS", "1.0"))

# An observed event becomes a flag only if it lasts at least this long (seconds).
FLAG_MIN_DURATION = {
    "head_turn": float(os.environ.get("HEAD_TURN_MIN_SECONDS", "1.5")),
    "unusual_posture": float(os.environ.get("POSTURE_MIN_SECONDS", "2.0")),
    "phone_visible": float(os.environ.get("PHONE_MIN_SECONDS", "1.0")),
    "restricted_zone": float(os.environ.get("ZONE_MIN_SECONDS", "1.5")),
}
# Gaps shorter than this inside one event are bridged; glances within 3 s become one flag.
FLAG_GAP_SECONDS = {
    "head_turn": float(os.environ.get("HEAD_TURN_GAP_SECONDS", "3.0")),
    "unusual_posture": float(os.environ.get("FLAG_GAP_SECONDS", "1.0")),
    "phone_visible": float(os.environ.get("FLAG_GAP_SECONDS", "1.0")),
    "restricted_zone": float(os.environ.get("FLAG_GAP_SECONDS", "1.0")),
}

# A running job with no progress for this long is marked failed (crash or restart).
STALLED_AFTER_SECONDS = int(os.environ.get("STALLED_AFTER_SECONDS", "120"))
# Live progress to the uploader's tabs, at most this often.
PROGRESS_PUSH_SECONDS = 2.0
# Outbox delivery: retries with exponential backoff up to this many attempts.
OUTBOX_MAX_ATTEMPTS = int(os.environ.get("OUTBOX_MAX_ATTEMPTS", "12"))
OUTBOX_TIMEOUT_SECONDS = 5
