from datetime import timedelta

from django.conf import settings
from django.contrib.auth.models import User
from django.db import models
from django.utils import timezone


def video_upload_path(instance, filename):
    return f"videos/{filename}"


def format_seconds(seconds):
    total = int(seconds)
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    return f"{h:02d}:{m:02d}:{s:02d}"


class Video(models.Model):
    """A single exam recording uploaded for a given room."""

    STATUS_PENDING = "pending"
    STATUS_PROCESSING = "processing"
    STATUS_COMPLETED = "completed"
    STATUS_FAILED = "failed"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Pending"),
        (STATUS_PROCESSING, "Processing"),
        (STATUS_COMPLETED, "Completed"),
        (STATUS_FAILED, "Failed"),
    ]

    SOURCE_UPLOAD = "upload"
    SOURCE_LIVE = "live"
    SOURCE_CHOICES = [
        (SOURCE_UPLOAD, "Uploaded video"),
        (SOURCE_LIVE, "Live webcam session"),
    ]

    room = models.CharField(max_length=50)
    exam_name = models.CharField(max_length=150, blank=True)
    source = models.CharField(max_length=10, choices=SOURCE_CHOICES, default=SOURCE_UPLOAD)
    # Blank only while a live session is still recording.
    file = models.FileField(upload_to=video_upload_path, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_PENDING)
    duration_seconds = models.FloatField(default=0)
    uploaded_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)
    processed_at = models.DateTimeField(null=True, blank=True)
    error_message = models.TextField(blank=True)

    # Live progress while status == "processing", so the frontend can show a
    # percentage, and so a run that died silently can be shown as stalled.
    total_frames_expected = models.IntegerField(default=0)
    frames_processed = models.IntegerField(default=0)
    last_progress_at = models.DateTimeField(null=True, blank=True)

    # Optional restricted zone, as percentages of frame width/height (0-100).
    zone_x1 = models.FloatField(null=True, blank=True)
    zone_y1 = models.FloatField(null=True, blank=True)
    zone_x2 = models.FloatField(null=True, blank=True)
    zone_y2 = models.FloatField(null=True, blank=True)

    class Meta:
        db_table = "exam_videos"  # the plan's exam_* tables in the shared Postgres
        ordering = ["-uploaded_at"]

    def __str__(self):
        return f"{self.room} - {self.file.name}"

    @property
    def progress_percentage(self):
        if not self.total_frames_expected:
            return 0
        return min(100, round((self.frames_processed / self.total_frames_expected) * 100, 1))

    @property
    def has_zone(self):
        return None not in (self.zone_x1, self.zone_y1, self.zone_x2, self.zone_y2)

    @property
    def is_stalled(self):
        """Processing, but no progress for a while: the worker died (e.g. server restart)."""
        if self.status != self.STATUS_PROCESSING or not self.last_progress_at:
            return False
        limit = timedelta(seconds=settings.STALLED_AFTER_SECONDS)
        return timezone.now() - self.last_progress_at > limit


class Flag(models.Model):
    """One observed event for human review: a time span, never a verdict."""

    TYPE_HEAD_TURN = "head_turn"
    TYPE_POSTURE = "suspicious_posture"
    TYPE_PHONE = "phone_visible"
    TYPE_ZONE = "restricted_zone"
    TYPE_CHOICES = [
        (TYPE_HEAD_TURN, "Head turned away"),
        (TYPE_POSTURE, "Suspicious posture"),
        (TYPE_PHONE, "Mobile phone visible"),
        (TYPE_ZONE, "Restricted zone entry"),
    ]

    video = models.ForeignKey(Video, related_name="flags", on_delete=models.CASCADE)
    flag_type = models.CharField(max_length=30, choices=TYPE_CHOICES, db_index=True)

    # Tracked student this flag belongs to (None for a phone with no nearby student).
    track_id = models.IntegerField(null=True, blank=True)

    start_seconds = models.FloatField()
    end_seconds = models.FloatField()

    # Mean model score over the event, and its highest single score.
    confidence = models.FloatField()
    peak_confidence = models.FloatField()

    # The frame the snapshot was taken from (the peak), and the box drawn on it.
    frame_number = models.IntegerField()
    bbox = models.JSONField(default=list, blank=True)
    snapshot = models.ImageField(upload_to="flags/", null=True, blank=True)

    # Why it was flagged, e.g. {"turns": 2, "max_offset": 0.41, "posture_score": 0.72}.
    detail = models.JSONField(default=dict, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "exam_flags"
        ordering = ["start_seconds"]
        indexes = [models.Index(fields=["video", "start_seconds"])]

    def __str__(self):
        return f"{self.get_flag_type_display()} {self.start_display}-{self.end_display}"

    @property
    def start_display(self):
        return format_seconds(self.start_seconds)

    @property
    def end_display(self):
        return format_seconds(self.end_seconds)

    @property
    def duration_seconds(self):
        return round(self.end_seconds - self.start_seconds, 1)

    @property
    def subject_display(self):
        return f"Student #{self.track_id}" if self.track_id else "Unassigned"
