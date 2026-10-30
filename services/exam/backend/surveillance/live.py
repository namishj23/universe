"""
Live webcam sessions: the "controlled webcam feed" option of Module E.

One session at a time (there is one webcam). While it runs:
  - the capture thread reads the camera as fast as it delivers frames, keeps the
    newest one, and records at a constant LIVE_RECORD_FPS to a fast Motion-JPEG
    file, so a second of recording is always a second of real time;
  - the analysis thread takes the newest frame up to LIVE_ANALYSIS_FPS times a
    second and runs the same FrameAnalyzer as uploaded videos, so flags are
    saved live with timestamps that match the recording;
  - the live view (stream_frames) draws the latest boxes onto the newest frame.

After Stop, the recording is converted once to WebM (VP8), which browsers can
play, and the session becomes an ordinary Video for review. VP8 is too slow to
encode live at 720p on a laptop CPU, hence the two steps.
"""

import logging
import os
import sys
import threading
import time
import uuid
from pathlib import Path

import cv2
from django.conf import settings
from django.db import close_old_connections
from django.utils import timezone

from . import detection
from .models import Video

logger = logging.getLogger(__name__)

PLAYBACK_WIDTH = 854        # converted recording size (854x480 for a 16:9 camera)
STREAM_WIDTH = 960          # live-view JPEG size
CAMERA_ERROR = (
    "Could not open the webcam. Close other apps using it (Zoom, Teams, Camera) and check "
    "Windows Settings > Privacy & security > Camera > 'Let desktop apps access your camera'."
)

_session = None
_session_lock = threading.Lock()


class LiveError(Exception):
    """A user-facing reason a live session cannot start."""


def current():
    return _session


def start(user, room, exam_name=""):
    """Open the webcam and start a session; returns it, or raises LiveError."""
    global _session
    with _session_lock:
        if _session is not None and not _session.finished:
            raise LiveError("A live session is already running.")
        # Uploads and live sessions share the models and the GPU; never run both.
        if not detection._process_lock.acquire(blocking=False):
            raise LiveError("An uploaded video is being processed. Try again when it finishes.")
        try:
            models = detection._load_models()
            # DirectShow opens Windows webcams fastest; it doesn't exist on macOS/Linux.
            backend = cv2.CAP_DSHOW if sys.platform == "win32" else cv2.CAP_ANY
            camera = cv2.VideoCapture(settings.LIVE_CAMERA_INDEX, backend)
            camera.set(cv2.CAP_PROP_FRAME_WIDTH, settings.LIVE_CAMERA_WIDTH)
            camera.set(cv2.CAP_PROP_FRAME_HEIGHT, settings.LIVE_CAMERA_HEIGHT)
            ok, frame = camera.read() if camera.isOpened() else (False, None)
            if not ok:
                camera.release()
                raise LiveError(CAMERA_ERROR)

            video = Video.objects.create(
                room=room,
                exam_name=exam_name,
                source=Video.SOURCE_LIVE,
                uploaded_by=user,
                status=Video.STATUS_PROCESSING,
                last_progress_at=timezone.now(),
            )
            _session = _LiveSession(video, models, camera, frame)
        except Exception:
            detection._process_lock.release()
            raise
        _session.start()
        return _session


def stop():
    session = _session
    if session is None or session.finished:
        raise LiveError("No live session is running.")
    session.stop_event.set()
    return session


class _LiveSession:
    def __init__(self, video, models, camera, first_frame):
        self.video = video
        self.models = models
        self.camera = camera
        self.stop_event = threading.Event()
        self.lock = threading.Lock()
        self.started = time.monotonic()
        self.frame = first_frame
        self.frame_t = 0.0
        self.frame_seq = 0
        self.overlay = []
        self.analysed_fps = 0.0
        self.frames_analysed = 0
        self.recorded_frames = 0
        self.error = None
        self.finished = False

        height, width = first_frame.shape[:2]
        self.size = (width, height)
        media = Path(settings.MEDIA_ROOT)
        token = uuid.uuid4().hex
        self.raw_path = media / "videos" / f"live_{token}.avi"
        self.final_name = f"videos/live_{token}.webm"
        self.writer = cv2.VideoWriter(
            str(self.raw_path), cv2.VideoWriter_fourcc(*"MJPG"), settings.LIVE_RECORD_FPS, self.size
        )
        if not self.writer.isOpened():
            camera.release()
            raise LiveError("Could not create the recording file.")

    @property
    def elapsed(self):
        return time.monotonic() - self.started

    def start(self):
        threading.Thread(target=self._run, name=f"live-session-{self.video.id}", daemon=True).start()

    def _run(self):
        capture = threading.Thread(target=self._capture_loop, name="live-capture", daemon=True)
        analysis = threading.Thread(target=self._analysis_loop, name="live-analysis", daemon=True)
        capture.start()
        analysis.start()
        capture.join()
        analysis.join()
        try:
            self._finalize()
        finally:
            self.finished = True
            detection._process_lock.release()
            close_old_connections()

    def _capture_loop(self):
        interval = 1 / settings.LIVE_RECORD_FPS
        next_slot = self.started
        limit = settings.LIVE_MAX_MINUTES * 60
        try:
            while not self.stop_event.is_set():
                ok, frame = self.camera.read()
                now = time.monotonic()
                if not ok:
                    self.error = "The webcam stopped sending frames."
                    self.stop_event.set()
                    break
                with self.lock:
                    self.frame = frame
                    self.frame_t = now - self.started
                    self.frame_seq += 1
                # Constant-rate recording: repeat or skip camera frames so the
                # recording's clock matches the flags' timestamps.
                while next_slot <= now:
                    self.writer.write(frame)
                    self.recorded_frames += 1
                    next_slot += interval
                if now - self.started > limit:
                    self.stop_event.set()
        finally:
            self.camera.release()
            self.writer.release()

    def _analysis_loop(self):
        min_interval = 1 / settings.LIVE_ANALYSIS_FPS
        analyzer = detection.FrameAnalyzer(self.video, self.models, sample_interval=min_interval)
        last_seq = -1
        last_progress = time.monotonic()
        window_start, window_count = time.monotonic(), 0
        try:
            while not self.stop_event.is_set():
                with self.lock:
                    frame, t, seq = self.frame, self.frame_t, self.frame_seq
                if seq == last_seq:
                    time.sleep(0.005)
                    continue
                last_seq = seq
                began = time.monotonic()

                # Frame number in the recording, so a flag's snapshot matches the video.
                analyzer.analyze(frame, t, frame_index=round(t * settings.LIVE_RECORD_FPS))
                self.overlay = analyzer.overlay

                window_count += 1
                if began - window_start >= 2:
                    self.analysed_fps = window_count / (began - window_start)
                    window_start, window_count = began, 0
                if began - last_progress >= detection.PROGRESS_EVERY_SECONDS:
                    self.video.frames_processed = analyzer.frames_analysed
                    self.video.duration_seconds = t
                    self.video.last_progress_at = timezone.now()
                    self.video.save(update_fields=["frames_processed", "duration_seconds", "last_progress_at"])
                    last_progress = began

                time.sleep(max(0.0, min_interval - (time.monotonic() - began)))
            analyzer.finish()
            self.frames_analysed = analyzer.frames_analysed
        except Exception as exc:  # noqa: BLE001 - surfaced on the Video row
            logger.exception("Live analysis failed for video %s", self.video.id)
            self.error = f"Analysis failed: {exc}"
            self.stop_event.set()

    def _finalize(self):
        video = self.video
        video.duration_seconds = self.recorded_frames / settings.LIVE_RECORD_FPS
        video.total_frames_expected = self.recorded_frames
        video.frames_processed = 0
        video.last_progress_at = timezone.now()
        video.save(update_fields=["duration_seconds", "total_frames_expected", "frames_processed", "last_progress_at"])
        try:
            self._convert_recording()
            video.file.name = self.final_name
            # Progress fields were reused for the conversion; restore the analysis count.
            video.frames_processed = video.total_frames_expected = self.frames_analysed
            video.status = Video.STATUS_FAILED if self.error else Video.STATUS_COMPLETED
            video.error_message = self.error or ""
            video.processed_at = timezone.now()
            video.save(update_fields=["file", "frames_processed", "total_frames_expected", "status",
                                      "error_message", "processed_at"])
        except Exception as exc:  # noqa: BLE001
            logger.exception("Could not save the recording for video %s", video.id)
            video.status = Video.STATUS_FAILED
            video.error_message = f"Could not save the recording: {exc}"
            video.save(update_fields=["status", "error_message"])
        finally:
            if self.raw_path.exists():
                os.remove(self.raw_path)

    def _convert_recording(self):
        """Motion-JPEG -> WebM/VP8 at playback size; reports progress for the report page."""
        source = cv2.VideoCapture(str(self.raw_path))
        width, height = self.size
        out_size = (PLAYBACK_WIDTH, round(height * PLAYBACK_WIDTH / width / 2) * 2)
        target = Path(settings.MEDIA_ROOT) / self.final_name
        writer = cv2.VideoWriter(str(target), cv2.VideoWriter_fourcc(*"VP80"), settings.LIVE_RECORD_FPS, out_size)
        if not writer.isOpened():
            source.release()
            raise RuntimeError("WebM (VP8) encoder is not available")
        done = 0
        last_report = time.monotonic()
        try:
            while True:
                ok, frame = source.read()
                if not ok:
                    break
                writer.write(cv2.resize(frame, out_size, interpolation=cv2.INTER_AREA))
                done += 1
                if time.monotonic() - last_report >= detection.PROGRESS_EVERY_SECONDS:
                    self.video.frames_processed = done
                    self.video.last_progress_at = timezone.now()
                    self.video.save(update_fields=["frames_processed", "last_progress_at"])
                    last_report = time.monotonic()
        finally:
            source.release()
            writer.release()
        self.video.frames_processed = done
        self.video.save(update_fields=["frames_processed"])


def stream_frames(session):
    """MJPEG parts for the live view: newest frame with the latest boxes drawn on it."""
    interval = 1 / settings.LIVE_RECORD_FPS
    while not session.stop_event.is_set():
        with session.lock:
            frame = session.frame
        image = detection.draw_overlay(frame.copy(), session.overlay)
        if image.shape[1] > STREAM_WIDTH:
            scale = STREAM_WIDTH / image.shape[1]
            image = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
        ok, buffer = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 75])
        if ok:
            data = buffer.tobytes()
            yield (b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
                   + str(len(data)).encode() + b"\r\n\r\n" + data + b"\r\n")
        time.sleep(interval)
