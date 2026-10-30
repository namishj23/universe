"""
Django settings for the Exam Surveillance System.
"""

import os
from pathlib import Path
from datetime import timedelta

BASE_DIR = Path(__file__).resolve().parent.parent


def _load_env_file(path):
    """Read KEY=VALUE lines from the project's .env without overriding real env vars."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())


_load_env_file(BASE_DIR.parent / ".env")

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "dev-secret-key-change-in-production")

DEBUG = os.environ.get("DJANGO_DEBUG", "True") == "True"

ALLOWED_HOSTS = ["*"]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",

    # Third party
    "rest_framework",
    "rest_framework_simplejwt",
    "corsheaders",

    # Local
    "surveillance",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "exam_surveillance.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "exam_surveillance.wsgi.application"
ASGI_APPLICATION = "exam_surveillance.asgi.application"

# Database - PostgreSQL (the implementation plan's shared database) when
# POSTGRES_DB is set in .env; otherwise the local SQLite file.
if os.environ.get("POSTGRES_DB"):
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": os.environ["POSTGRES_DB"],
            "USER": os.environ.get("POSTGRES_USER", ""),
            "PASSWORD": os.environ.get("POSTGRES_PASSWORD", ""),
            "HOST": os.environ.get("POSTGRES_HOST", "127.0.0.1"),
            "PORT": os.environ.get("POSTGRES_PORT", "5432"),
            "CONN_MAX_AGE": 60,
        }
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
            # The background worker writes while web requests read; wait for the
            # lock instead of failing with "database is locked".
            "OPTIONS": {"timeout": 20},
        }
    }

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "Asia/Kolkata"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

# Where uploaded videos and flag snapshots are stored
VIDEO_UPLOAD_DIR = MEDIA_ROOT / "videos"
SNAPSHOT_DIR = MEDIA_ROOT / "flags"
os.makedirs(VIDEO_UPLOAD_DIR, exist_ok=True)
os.makedirs(SNAPSHOT_DIR, exist_ok=True)

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.IsAuthenticated",
    ),
    "DEFAULT_PARSER_CLASSES": (
        "rest_framework.parsers.JSONParser",
        "rest_framework.parsers.MultiPartParser",
        "rest_framework.parsers.FormParser",
    ),
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(hours=8),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=1),
}

CORS_ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]
CORS_ALLOW_CREDENTIALS = True

# ---------------------------------------------------------------------------
# YOLO / detection settings
# ---------------------------------------------------------------------------
# Two models, both under ML/weights/:
#   1. Detector: pretrained COCO yolov8n.pt, used for its "person" and
#      "cell phone" classes only (no custom training needed).
#   2. Classifier: exam_behaviour_cls.pt (normal / suspicious), trained by
#      ML/train_classification.py and run on each detected student's crop.
# Every value below is a starting point to tune on our own clips; override any
# of them with an environment variable of the same name.
PROJECT_ROOT = BASE_DIR.parent
ML_DIR = Path(os.environ.get("ML_DIR", str(PROJECT_ROOT / "ML")))

DETECTION_MODEL_PATH = os.environ.get(
    "DETECTION_MODEL_PATH", str(ML_DIR / "weights" / "yolov8n.pt")
)
CLASSIFICATION_MODEL_PATH = os.environ.get(
    "CLASSIFICATION_MODEL_PATH", str(ML_DIR / "weights" / "exam_behaviour_cls.pt")
)
# Pretrained COCO pose model: person boxes plus nose/eye/ear/shoulder keypoints,
# used for the head-turn event.
POSE_MODEL_PATH = os.environ.get("POSE_MODEL_PATH", str(ML_DIR / "weights" / "yolov8n-pose.pt"))

# Frames analysed per second of video (the rest are skipped).
ANALYSIS_FPS = float(os.environ.get("ANALYSIS_FPS", "5"))

# Minimum detector confidence for a person / phone box to count.
PERSON_CONFIDENCE = float(os.environ.get("PERSON_CONFIDENCE", "0.4"))
PHONE_CONFIDENCE = float(os.environ.get("PHONE_CONFIDENCE", "0.35"))

# A student's crop counts as "suspicious posture" at or above this classifier score.
POSTURE_THRESHOLD = float(os.environ.get("POSTURE_THRESHOLD", "0.85"))

# On our sample clips the posture classifier was confidently wrong on students
# sitting close to the camera, so by default it is only supporting evidence on
# head-turn flags, not a flag of its own. Set to "1" to flag it on its own again.
POSTURE_FLAGS_ENABLED = os.environ.get("POSTURE_FLAGS_ENABLED", "0") == "1"

# Head turn: horizontal offset of the nose from the shoulder centre, in shoulder
# widths, compared with that student's own usual offset (camera angle makes the
# usual offset differ per seat). At or past this change the head counts as turned.
HEAD_TURN_OFFSET = float(os.environ.get("HEAD_TURN_OFFSET", "0.25"))
# Same idea when the shoulders are out of frame (laptop webcam): nose offset from
# the eye midpoint, in eye distances. 0.35 is roughly a 30 degree turn.
HEAD_TURN_FACE_OFFSET = float(os.environ.get("HEAD_TURN_FACE_OFFSET", "0.35"))
# Seconds of a student's first observations used to learn their usual offset.
HEAD_TURN_WARMUP_SECONDS = float(os.environ.get("HEAD_TURN_WARMUP_SECONDS", "1.0"))

# An observed event becomes a flag only if it lasts at least this long (seconds).
FLAG_MIN_DURATION = {
    "head_turn": float(os.environ.get("HEAD_TURN_MIN_SECONDS", "1.5")),
    "suspicious_posture": float(os.environ.get("POSTURE_MIN_SECONDS", "2.0")),
    "phone_visible": float(os.environ.get("PHONE_MIN_SECONDS", "1.0")),
    "restricted_zone": float(os.environ.get("ZONE_MIN_SECONDS", "1.5")),
}

# Gaps shorter than this inside one event (e.g. a missed detection) are bridged.
# Head turns use a longer gap so several glances close together become one
# "repeated head turns" flag instead of many short ones.
FLAG_GAP_SECONDS = {
    "head_turn": float(os.environ.get("HEAD_TURN_GAP_SECONDS", "3.0")),
    "suspicious_posture": float(os.environ.get("FLAG_GAP_SECONDS", "1.0")),
    "phone_visible": float(os.environ.get("FLAG_GAP_SECONDS", "1.0")),
    "restricted_zone": float(os.environ.get("FLAG_GAP_SECONDS", "1.0")),
}

# A video still "processing" with no progress for this long is shown as stalled.
STALLED_AFTER_SECONDS = int(os.environ.get("STALLED_AFTER_SECONDS", "120"))

# ---------------------------------------------------------------------------
# Live webcam sessions
# ---------------------------------------------------------------------------
# The webcam on the machine running the backend (0 = built-in camera).
LIVE_CAMERA_INDEX = int(os.environ.get("LIVE_CAMERA_INDEX", "0"))
LIVE_CAMERA_WIDTH = int(os.environ.get("LIVE_CAMERA_WIDTH", "1280"))
LIVE_CAMERA_HEIGHT = int(os.environ.get("LIVE_CAMERA_HEIGHT", "720"))
# Frames analysed per second while live; the newest frame is always used, so a
# slow GPU skips frames instead of falling behind.
LIVE_ANALYSIS_FPS = float(os.environ.get("LIVE_ANALYSIS_FPS", "8"))
# Recording frame rate (WebM/VP8, which browsers can play) and live-view rate.
LIVE_RECORD_FPS = float(os.environ.get("LIVE_RECORD_FPS", "15"))
# Live sessions stop on their own after this long, in case Stop is never pressed.
LIVE_MAX_MINUTES = int(os.environ.get("LIVE_MAX_MINUTES", "30"))
