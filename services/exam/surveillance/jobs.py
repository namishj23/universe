"""Background analysis: one job at a time (one GPU) in a worker thread; requests never wait."""

import logging
import math
import queue
import threading
import time
from datetime import timedelta

from django.conf import settings
from django.db import close_old_connections, transaction
from django.utils import timezone

from . import platform
from .models import Flag, Job

logger = logging.getLogger("exam.jobs")
_jobs = queue.Queue()
_worker = None
_lock = threading.Lock()


def enqueue(job_id):
    global _worker
    with _lock:
        if _worker is None or not _worker.is_alive():
            _worker = threading.Thread(target=_loop, name="exam-analysis", daemon=True)
            _worker.start()
    _jobs.put(job_id)


def _loop():
    while True:
        job_id = _jobs.get()
        try:
            run(job_id)
        except Exception:  # noqa: BLE001 - recorded on the job
            pass
        finally:
            close_old_connections()


def fail_stalled():
    limit = timezone.now() - timedelta(seconds=settings.STALLED_AFTER_SECONDS)
    Job.objects.filter(status=Job.RUNNING, last_progress_at__lt=limit).update(
        status=Job.FAILED, error="The analysis stopped (crash or restart).", finished_at=timezone.now())


def run(job_id):
    import cv2
    from ml.analyzer import FrameAnalyzer, load_models

    fail_stalled()
    job = Job.objects.select_related("clip").get(id=job_id)
    clip = job.clip
    Job.objects.filter(id=job.id).update(status=Job.RUNNING, started_at=timezone.now(), last_progress_at=timezone.now())
    try:
        models = load_models()
        cap = cv2.VideoCapture(str(settings.MEDIA_ROOT / clip.file))
        if not cap.isOpened():
            raise RuntimeError("The clip could not be read as a video.")
        fps = cap.get(cv2.CAP_PROP_FPS) or 25
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        stride = max(1, round(fps / settings.ANALYSIS_FPS))
        expected = math.ceil(total / stride) if total else 0
        analyzer = FrameAnalyzer(clip, models, sample_interval=stride / fps)
        index, last = 0, time.monotonic()
        try:
            while True:
                ok, frame = cap.read()
                if not ok:
                    break
                if index % stride == 0:
                    analyzer.analyze(frame, index / fps, index)
                    if time.monotonic() - last >= settings.PROGRESS_PUSH_SECONDS:
                        progress = min(99.0, 100 * analyzer.frames_analysed / expected) if expected else 0
                        Job.objects.filter(id=job.id).update(progress=progress, last_progress_at=timezone.now(),
                                                             frames_processed=analyzer.frames_analysed)
                        last = time.monotonic()
                index += 1
        finally:
            cap.release()
        flags = analyzer.finish()
        with transaction.atomic():
            clip.duration_seconds = total / fps if total else 0
            clip.save(update_fields=["duration_seconds"])
            Flag.objects.bulk_create(flags)
            Job.objects.filter(id=job.id).update(
                status=Job.COMPLETED, progress=100, frames_processed=analyzer.frames_analysed,
                total_frames_expected=analyzer.frames_analysed, finished_at=timezone.now())
            recipients = {"userIds": [str(clip.uploaded_by)]} if clip.uploaded_by else {"role": "invigilator"}
            platform.after_commit("activity", {
                "idempotencyKey": f"exam.clip_processed:{job.id}", "type": "exam.clip_processed",
                "recipients": recipients,
                "params": {"clipId": str(clip.id), "examId": str(clip.exam_id), "flagCount": len(flags)},
            })
            if flags:
                top = max(flags, key=lambda f: f.peak_confidence)
                platform.after_commit("activity", {
                    "idempotencyKey": f"exam.flag_created:{job.id}", "type": "exam.flag_created",
                    "recipients": {"role": "invigilator"},
                    "params": {"flagId": str(top.id), "clipId": str(clip.id), "examId": str(clip.exam_id)},
                })
        logger.info("job completed", extra={"jobId": str(job.id), "flags": len(flags)})
    except Exception as exc:
        logger.exception("job failed", extra={"jobId": str(job.id)})
        Job.objects.filter(id=job.id).update(status=Job.FAILED, error=str(exc)[:300], finished_at=timezone.now())
        raise
