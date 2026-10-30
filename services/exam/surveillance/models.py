"""
Exam service data (database `universe_exam`).

Users live in the platform's database, so user ids are plain UUID columns with the
display name copied at the time of the action: there are no foreign keys to the platform.
A flag is an observed event for human review, never a verdict; only a person changes its status.
"""

import uuid

from django.db import models
from django.db.models import Q


class Exam(models.Model):
    """An exam sitting in one room, used to group clips (the exam select)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=150)
    room = models.CharField(max_length=50)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "exam_exams"
        constraints = [models.UniqueConstraint(fields=["name", "room"], name="exam_exams_name_room_uniq")]
        indexes = [models.Index(fields=["-created_at", "-id"], name="exam_exams_page_idx")]

    @property
    def label(self):
        return f"{self.name} · Room {self.room}"


class Clip(models.Model):
    """One recording of an exam: an uploaded file or a live webcam session."""

    SOURCE_UPLOAD = "upload"
    SOURCE_LIVE = "live"
    SOURCE_CHOICES = [(SOURCE_UPLOAD, "Uploaded clip"), (SOURCE_LIVE, "Live webcam session")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    exam = models.ForeignKey(Exam, related_name="clips", on_delete=models.PROTECT)
    source = models.CharField(max_length=10, choices=SOURCE_CHOICES, default=SOURCE_UPLOAD)
    # Relative to MEDIA_ROOT (clips/<uuid>.mp4); never the uploader's file name.
    file = models.CharField(max_length=200)
    content_type = models.CharField(max_length=20)
    size_bytes = models.BigIntegerField()
    duration_seconds = models.FloatField(default=0)
    # Optional restricted zone, percentages of the frame (0-100), all four or none.
    zone_x1 = models.FloatField(null=True, blank=True)
    zone_y1 = models.FloatField(null=True, blank=True)
    zone_x2 = models.FloatField(null=True, blank=True)
    zone_y2 = models.FloatField(null=True, blank=True)
    uploaded_by = models.UUIDField(null=True, blank=True)
    uploaded_by_name = models.CharField(max_length=200, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "exam_clips"
        indexes = [
            models.Index(fields=["-created_at", "-id"], name="exam_clips_page_idx"),
            models.Index(fields=["exam", "-created_at", "-id"], name="exam_clips_exam_page_idx"),
        ]
        constraints = [
            models.CheckConstraint(
                name="exam_clips_zone_all_or_none",
                condition=(
                    Q(zone_x1__isnull=True, zone_y1__isnull=True, zone_x2__isnull=True, zone_y2__isnull=True)
                    | Q(zone_x1__gte=0, zone_y1__gte=0, zone_x2__lte=100, zone_y2__lte=100,
                        zone_x1__lt=models.F("zone_x2"), zone_y1__lt=models.F("zone_y2"))
                ),
            ),
            models.CheckConstraint(name="exam_clips_size_positive", condition=Q(size_bytes__gt=0)),
        ]

    @property
    def zone(self):
        values = (self.zone_x1, self.zone_y1, self.zone_x2, self.zone_y2)
        return None if None in values else values


class Job(models.Model):
    """The analysis of one clip. The worker runs one job at a time, oldest first."""

    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    STATUS_CHOICES = [(s, s.title()) for s in (QUEUED, RUNNING, COMPLETED, FAILED)]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    clip = models.OneToOneField(Clip, related_name="job", on_delete=models.CASCADE)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=QUEUED)
    progress = models.FloatField(default=0)   # 0-100
    frames_processed = models.IntegerField(default=0)
    total_frames_expected = models.IntegerField(default=0)
    error = models.CharField(max_length=300, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    last_progress_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "exam_jobs"
        indexes = [
            # The worker's queue (oldest queued first) and the stalled-job sweep.
            models.Index(fields=["status", "created_at"], name="exam_jobs_queue_idx"),
            models.Index(fields=["-finished_at"], name="exam_jobs_finished_idx",
                         condition=Q(status="completed")),
        ]
        constraints = [
            models.CheckConstraint(name="exam_jobs_progress_range", condition=Q(progress__gte=0, progress__lte=100)),
        ]


class Flag(models.Model):
    """One observed event for human review: a time span with a confidence, never a verdict."""

    SIGNAL_HEAD_TURN = "head_turn"
    SIGNAL_PHONE = "phone_visible"
    SIGNAL_ZONE = "restricted_zone"
    SIGNAL_POSTURE = "unusual_posture"
    # Names used by the detection code.
    TYPE_HEAD_TURN, TYPE_PHONE, TYPE_ZONE, TYPE_POSTURE = SIGNAL_HEAD_TURN, SIGNAL_PHONE, SIGNAL_ZONE, SIGNAL_POSTURE
    SIGNAL_CHOICES = [
        (SIGNAL_HEAD_TURN, "Head turned away"),
        (SIGNAL_PHONE, "Phone visible"),
        (SIGNAL_ZONE, "Restricted zone entry"),
        (SIGNAL_POSTURE, "Unusual posture (supporting detail)"),
    ]

    OPEN = "open"
    DISMISSED = "dismissed"
    RESOLVED = "resolved"
    TYPE_CHOICES = SIGNAL_CHOICES
    STATUS_CHOICES = [(OPEN, "Open"), (DISMISSED, "Dismissed"), (RESOLVED, "Resolved (follow-up)")]

    DECISION_DISMISS = "dismiss"
    DECISION_FOLLOW_UP = "follow_up"
    DECISION_CHOICES = [(DECISION_DISMISS, "Dismiss"), (DECISION_FOLLOW_UP, "Follow up")]
    STATUS_FOR_DECISION = {DECISION_DISMISS: DISMISSED, DECISION_FOLLOW_UP: RESOLVED}

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    clip = models.ForeignKey(Clip, related_name="flags", on_delete=models.CASCADE)
    # Copied from the clip so the review list filters and pages on one index.
    exam = models.ForeignKey(Exam, related_name="flags", on_delete=models.PROTECT)
    signal = models.CharField(max_length=20, choices=SIGNAL_CHOICES)
    # The tracked person in the clip (None for a phone with nobody near it).
    track_id = models.IntegerField(null=True, blank=True)
    start_seconds = models.FloatField()
    end_seconds = models.FloatField()
    confidence = models.FloatField()        # mean model score over the event, 0-1
    peak_confidence = models.FloatField()   # its highest single score, 0-1
    frame_number = models.IntegerField()    # the snapshot's frame
    bbox = models.JSONField(default=list)   # [x1, y1, x2, y2] in % of the frame
    snapshot = models.CharField(max_length=200, blank=True)  # relative to MEDIA_ROOT
    evidence = models.JSONField(default=dict)  # e.g. {"turns": 2, "maxOffset": 0.41}

    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=OPEN)
    decision = models.CharField(max_length=10, choices=DECISION_CHOICES, null=True, blank=True)
    decided_by = models.UUIDField(null=True, blank=True)
    decided_by_name = models.CharField(max_length=200, blank=True)
    decided_at = models.DateTimeField(null=True, blank=True)
    note = models.CharField(max_length=1000, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "exam_flags"
        indexes = [
            models.Index(fields=["status", "-created_at", "-id"], name="exam_flags_status_page_idx"),
            models.Index(fields=["exam", "status", "-created_at", "-id"], name="exam_flags_exam_page_idx"),
            models.Index(fields=["-created_at", "-id"], name="exam_flags_page_idx"),
            models.Index(fields=["clip", "start_seconds"], name="exam_flags_clip_idx"),
        ]
        constraints = [
            models.CheckConstraint(
                name="exam_flags_decision_matches_status",
                condition=(
                    Q(status="open", decision__isnull=True)
                    | Q(status="dismissed", decision="dismiss")
                    | Q(status="resolved", decision="follow_up")
                ),
            ),
            models.CheckConstraint(
                name="exam_flags_confidence_range",
                condition=Q(confidence__gte=0, confidence__lte=1, peak_confidence__gte=0, peak_confidence__lte=1),
            ),
            models.CheckConstraint(name="exam_flags_span", condition=Q(end_seconds__gte=models.F("start_seconds"))),
        ]


class FlagReview(models.Model):
    """History of every decision and reopen on a flag (append-only)."""

    ACTION_REVIEW = "review"
    ACTION_REOPEN = "reopen"
    ACTION_CHOICES = [(ACTION_REVIEW, "Review"), (ACTION_REOPEN, "Reopen")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    flag = models.ForeignKey(Flag, related_name="history", on_delete=models.CASCADE)
    action = models.CharField(max_length=10, choices=ACTION_CHOICES)
    decision = models.CharField(max_length=10, choices=Flag.DECISION_CHOICES, null=True, blank=True)
    from_status = models.CharField(max_length=10, choices=Flag.STATUS_CHOICES)
    to_status = models.CharField(max_length=10, choices=Flag.STATUS_CHOICES)
    note = models.CharField(max_length=1000)
    actor_id = models.UUIDField()
    actor_name = models.CharField(max_length=200, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "exam_flag_reviews"
        indexes = [models.Index(fields=["flag", "created_at"], name="exam_flag_reviews_flag_idx")]


class Outbox(models.Model):
    """A call to the platform, written in the same transaction as the change it reports."""

    KIND_ACTIVITY = "activity"
    KIND_AUDIT = "audit"
    KIND_PUSH = "push"
    KIND_CHOICES = [(KIND_ACTIVITY, "Activity"), (KIND_AUDIT, "Audit"), (KIND_PUSH, "Push")]

    PENDING = "pending"
    DELIVERED = "delivered"
    FAILED = "failed"
    STATUS_CHOICES = [(PENDING, "Pending"), (DELIVERED, "Delivered"), (FAILED, "Failed")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    kind = models.CharField(max_length=10, choices=KIND_CHOICES)
    # Sent to the platform, which ignores a key it has seen in the last 7 days.
    idempotency_key = models.CharField(max_length=200, unique=True)
    payload = models.JSONField()
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=PENDING)
    attempts = models.IntegerField(default=0)
    next_attempt_at = models.DateTimeField()
    last_error = models.CharField(max_length=200, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    delivered_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "exam_outbox"
        indexes = [
            models.Index(fields=["next_attempt_at"], name="exam_outbox_due_idx", condition=Q(status="pending")),
        ]
