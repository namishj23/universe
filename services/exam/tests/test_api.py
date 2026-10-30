import uuid

import pytest
from django.conf import settings
from django.test import Client

from surveillance.models import Clip, Exam, Flag

pytestmark = pytest.mark.django_db
USER = str(uuid.uuid4())


def headers(role="invigilator", token=None):
    return {"HTTP_X_SERVICE_TOKEN": token or settings.SERVICE_TOKEN_EXAM, "HTTP_X_UNIVERSE_USER_ID": USER,
            "HTTP_X_UNIVERSE_USER_ROLE": role, "HTTP_X_UNIVERSE_USER_NAME": "Asha%20Rao"}


@pytest.fixture(autouse=True)
def no_platform(monkeypatch):
    monkeypatch.setattr("surveillance.platform.after_commit", lambda *a: None)


@pytest.fixture
def flag():
    exam = Exam.objects.create(name="DBMS", room="T1")
    clip = Clip.objects.create(exam=exam, file="clips/x.mp4", content_type="video/mp4", size_bytes=1)
    return Flag.objects.create(clip=clip, exam=exam, signal="head_turn", start_seconds=1, end_seconds=3,
                               confidence=0.6, peak_confidence=0.8, frame_number=10)


def test_no_token_is_401():
    r = Client().get("/exam/flags")
    assert r.status_code == 401 and r.json()["error"]["code"] == "UNAUTHENTICATED"


def test_wrong_token_is_401():
    assert Client().get("/exam/flags", **headers(token="x" * 40)).status_code == 401


def test_non_loopback_is_403():
    assert Client().get("/exam/flags", REMOTE_ADDR="10.0.0.5", **headers()).status_code == 403


def test_student_is_403():
    assert Client().get("/exam/flags", **headers(role="student")).status_code == 403


def test_unknown_query_field_is_400():
    r = Client().get("/exam/flags?colour=red", **headers())
    assert r.status_code == 400 and r.json()["error"]["code"] == "VALIDATION_ERROR"


def test_404_shape():
    r = Client().get(f"/exam/flags/{uuid.uuid4()}", HTTP_X_REQUEST_ID="req-1", **headers())
    assert r.json() == {"error": {"code": "NOT_FOUND", "message": "That flag does not exist.", "requestId": "req-1"}}


def test_review_needs_note(flag):
    r = Client().post(f"/exam/flags/{flag.id}/review", {"decision": "dismiss", "note": "  "},
                      content_type="application/json", **headers())
    assert r.status_code == 400


def test_review_then_conflict_then_reopen(flag):
    c = Client()
    url = f"/exam/flags/{flag.id}"
    r = c.post(url + "/review", {"decision": "dismiss", "note": "Stretching"}, content_type="application/json", **headers())
    assert r.status_code == 200 and r.json()["status"] == "dismissed"
    r = c.post(url + "/review", {"decision": "follow_up", "note": "x"}, content_type="application/json", **headers())
    assert r.status_code == 409 and r.json()["error"]["code"] == "CONFLICT"
    r = c.post(url + "/reopen", {"note": "Look again"}, content_type="application/json", **headers())
    assert r.status_code == 200 and r.json()["status"] == "open" and len(r.json()["history"]) == 2
    counts = c.get("/exam/flags?status=all", **headers()).json()["counts"]
    assert counts == {"open": 1, "dismissed": 0, "resolved": 0}


def test_upload_wrong_magic_is_415(flag):
    from django.core.files.uploadedfile import SimpleUploadedFile
    f = SimpleUploadedFile("a.mp4", b"not a video at all", content_type="video/mp4")
    r = Client().post("/exam/clips", {"file": f, "examId": str(flag.exam_id)}, **headers())
    assert r.status_code == 415


def test_no_banned_words(flag):
    c = Client()
    body = c.get(f"/exam/flags/{flag.id}", **headers()).content.decode().lower()
    for word in ("cheating", "misconduct", "suspicious", "cctv", "surveillance"):
        assert word not in body
