"""
Clip analysis for the exam service (Person 2's detection logic).

For every sampled frame (ANALYSIS_FPS per second of video):
  1. The pretrained pose model finds people with nose/shoulder keypoints, and
     the pretrained detector finds mobile phones.
  2. A small IoU tracker gives each student a number that stays the same
     across frames (students sit still in exams, so box overlap is enough).
  3. Each student's crop is scored by the behaviour classifier.
  4. Observable events are checked per student:
       - head_turn:          the nose moves sideways from that student's usual
                             position by HEAD_TURN_OFFSET shoulder widths or more
       - phone_visible:      a phone box, attributed to the student holding it
       - restricted_zone:    the student's foot point inside the video's zone
       - unusual_posture: classifier score >= POSTURE_THRESHOLD (only when
                             POSTURE_FLAGS_ENABLED; otherwise the score is kept
                             as supporting detail on head-turn flags)
  5. Consecutive observations of the same event for the same student are
     merged into one Flag with a start/end time, mean and peak confidence and
     one annotated snapshot. Events shorter than FLAG_MIN_DURATION are dropped.

Flags are observations for a human to review. Nothing here decides anything, and there is no video-level verdict.

Uploads are processed one at a time by a single background worker thread so
long videos never block a web request and two jobs never compete for the GPU.
"""

import logging
import os
import statistics
import uuid
from collections import defaultdict, deque

import cv2
from django.conf import settings

from surveillance.models import Flag

os.environ.setdefault("YOLO_OFFLINE", "1")
logger = logging.getLogger("exam.ml")

PERSON_CLASS = 0        # COCO "person"
PHONE_CLASS = 67        # COCO "cell phone"
NOSE, LEFT_EYE, RIGHT_EYE, LEFT_SHOULDER, RIGHT_SHOULDER = 0, 1, 2, 5, 6   # COCO keypoints
KEYPOINT_CONFIDENCE = 0.5
CROP_PADDING = 0.1
SNAPSHOT_MAX_WIDTH = 1280
_model_cache = {}


def _sha256(path):
    import hashlib
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def pick_device():
    import torch
    if settings.DEVICE != "auto":
        return settings.DEVICE
    if torch.cuda.is_available():
        return "cuda"
    return "mps" if torch.backends.mps.is_available() else "cpu"


def load_models():
    """Load models from ML_DIR only; the posture classifier is optional and never blocks start-up."""
    if "models" in _model_cache:
        return _model_cache["models"]
    from ultralytics import YOLO
    device = pick_device()
    loaded = {}
    for name in (settings.DETECTION_MODEL_FILE, settings.POSE_MODEL_FILE):
        path = settings.ML_DIR / name
        if not path.is_file():
            raise FileNotFoundError(f"Model {name} is missing from ML_DIR (run scripts/fetch_weights.py).")
        logger.info("model loaded", extra={"file": name, "sha256": _sha256(path), "device": device})
        loaded[name] = YOLO(str(path))
    cls, posture_index = None, None
    if settings.POSTURE_FLAGS_ENABLED:
        path = settings.ML_DIR / settings.CLASSIFIER_MODEL_FILE
        digest = _sha256(path) if path.is_file() else None
        if digest != settings.CLASSIFIER_SHA256:
            logger.warning("posture classifier missing or altered; posture flags off", extra={"sha256": digest})
        else:
            logger.info("model loaded", extra={"file": path.name, "sha256": digest, "device": device})
            cls = YOLO(str(path))
            posture_index = next(i for i, n in cls.names.items() if n.lower() != "normal")
    _model_cache["models"] = _Models(loaded[settings.DETECTION_MODEL_FILE], loaded[settings.POSE_MODEL_FILE],
                                     cls, posture_index, device)
    return _model_cache["models"]


class _Models:
    def __init__(self, det, pose, cls, posture_index, device):
        self.det, self.pose, self.cls, self.posture_index, self.device = det, pose, cls, posture_index, device


class FrameAnalyzer:
    """Everything one recording needs across frames: tracker, head baselines, open events.

    Used frame by frame both for uploaded files (_run_pipeline) and for the live
    webcam (live.py), so both produce exactly the same flags.
    """

    def __init__(self, video, models, sample_interval):
        self.video = video
        self.models = models
        self.zone = _zone_fractions(video)
        self.tracker = _IouTracker()
        self.heads = _HeadBaselines(
            warmup_samples=max(1, round(settings.HEAD_TURN_WARMUP_SECONDS / sample_interval))
        )
        self.events = _EventBuilder(sample_interval=sample_interval)
        self.frames_analysed = 0
        self.ended = []
        self.overlay = []  # [(box, is_flagged, label)] from the latest analysed frame

    def analyze(self, frame, t, frame_index):
        active, persons, track_ids, phones = _observe_frame(
            frame, t, self.models, self.tracker, self.heads, self.zone
        )
        self.ended.extend(self.events.observe(t, active, frame_index, frame))
        self.overlay = _overlay(persons, track_ids, phones, active)
        self.frames_analysed += 1

    def finish(self):
        self.ended.extend(self.events.finish())
        return [build_flag(self.video, e, self.zone) for e in self.ended]


def _overlay(persons, track_ids, phones, active):
    labels = dict(Flag.TYPE_CHOICES)
    flagged = defaultdict(list)
    for flag_type, track_id in active:
        if track_id is not None and flag_type != Flag.TYPE_PHONE:
            flagged[track_id].append(labels[flag_type])
    items = []
    for (box, _), track_id in zip(persons, track_ids):
        reasons = flagged.get(track_id)
        label = f"Person {track_id}" + (f" | {', '.join(reasons)}" if reasons else "")
        items.append((box, bool(reasons), label))
    for box, conf in phones:
        items.append((box, True, f"Phone {conf:.2f}"))
    return items


def draw_overlay(frame, overlay):
    """Draw the latest boxes on a frame: green for students, red for anything flagged."""
    width = frame.shape[1]
    thickness = max(2, width // 640)
    for box, is_flagged, label in overlay:
        color = (0, 0, 255) if is_flagged else (0, 200, 0)
        x1, y1, x2, y2 = (int(v) for v in box)
        cv2.rectangle(frame, (x1, y1), (x2, y2), color, thickness)
        cv2.putText(frame, label, (x1, max(y1 - 8, 18)), cv2.FONT_HERSHEY_SIMPLEX,
                    0.3 * thickness, color, thickness)
    return frame


def _observe_frame(frame, t, models, tracker, heads, zone):
    """Detect, track and check every event in one frame.

    Returns (active, persons, track_ids, phones), where active is
    {(flag_type, track_id): (score, box, info)} for every event seen in this frame.
    """
    height, width = frame.shape[:2]

    people = models.pose(frame, classes=[PERSON_CLASS], conf=settings.PERSON_CONFIDENCE, device=models.device, verbose=False)[0]
    persons = list(zip(people.boxes.xyxy.tolist(), people.boxes.conf.tolist()))
    keypoints = people.keypoints
    kp_xy = keypoints.xy.tolist() if keypoints is not None and len(persons) else []
    kp_conf = keypoints.conf.tolist() if keypoints is not None and keypoints.conf is not None and len(persons) else []

    phone_boxes = models.det(frame, classes=[PHONE_CLASS], conf=settings.PHONE_CONFIDENCE, device=models.device, verbose=False)[0].boxes
    phones = list(zip(phone_boxes.xyxy.tolist(), phone_boxes.conf.tolist()))

    track_ids = tracker.update([box for box, _ in persons], t)
    active = {}

    if persons:
        crops = [_crop(frame, box) for box, _ in persons]
        results = models.cls(crops, device=models.device, verbose=False) if models.cls else [None] * len(persons)
        for i, ((box, conf), track_id, result) in enumerate(zip(persons, track_ids, results)):
            posture = float(result.probs.data[models.posture_index]) if result is not None else None
            if posture is not None and posture >= settings.POSTURE_THRESHOLD:
                active[(Flag.TYPE_POSTURE, track_id)] = (posture, box, {})

            measured = _head_offset(kp_xy[i], kp_conf[i]) if i < len(kp_conf) else None
            if measured is not None:
                method, offset, threshold = measured
                change = heads.update((track_id, method), offset, threshold)
                if change is not None and abs(change) >= threshold:
                    # 0.5 at the threshold, 1.0 at twice the threshold or more.
                    strength = min(1.0, abs(change) / (2 * threshold))
                    active[(Flag.TYPE_HEAD_TURN, track_id)] = (
                        strength, box, {"offset": abs(change), **({"posture": posture} if posture is not None else {})},
                    )

            if zone and _foot_in_zone(box, zone, width, height):
                active[(Flag.TYPE_ZONE, track_id)] = (conf, box, {})

    for box, conf in phones:
        key = (Flag.TYPE_PHONE, _phone_owner(box, persons, track_ids))
        if key not in active or active[key][0] < conf:
            active[key] = (conf, box, {})

    return active, persons, track_ids, phones


def _head_offset(xy, conf):
    """Sideways nose position, as (method, offset, turn threshold), or None.

    Preferred: nose relative to the shoulder centre, in shoulder widths (works
    from a classroom camera). Fallback when the shoulders are out of frame, as
    with a laptop webcam: nose relative to the midpoint of the eyes, in eye
    distances; about 0.58 x tan(yaw), so the default 0.35 is roughly 30 degrees.
    """
    def visible(*points):
        return min(conf[p] for p in points) >= KEYPOINT_CONFIDENCE

    if visible(NOSE, LEFT_SHOULDER, RIGHT_SHOULDER):
        width = abs(xy[LEFT_SHOULDER][0] - xy[RIGHT_SHOULDER][0])
        if width >= 1:
            centre = (xy[LEFT_SHOULDER][0] + xy[RIGHT_SHOULDER][0]) / 2
            return "shoulders", (xy[NOSE][0] - centre) / width, settings.HEAD_TURN_OFFSET
    if visible(NOSE, LEFT_EYE, RIGHT_EYE):
        width = abs(xy[LEFT_EYE][0] - xy[RIGHT_EYE][0])
        if width >= 1:
            centre = (xy[LEFT_EYE][0] + xy[RIGHT_EYE][0]) / 2
            return "eyes", (xy[NOSE][0] - centre) / width, settings.HEAD_TURN_FACE_OFFSET
    return None


class _HeadBaselines:
    """Each student's usual head offset, learned from their own frames.

    The camera angle makes the offset differ per seat (a student facing their
    paper can sit at -0.44 or +0.30), so a turn is a change from that student's
    median, not an absolute value. Only frames that are not turns update the
    median, so a long turn does not become the new normal. Each measuring
    method keeps its own median because their scales differ.
    """

    def __init__(self, warmup_samples, history=150):
        self.warmup = warmup_samples
        self.samples = defaultdict(lambda: deque(maxlen=history))

    def update(self, key, offset, threshold):
        """Returns the change from the usual offset, or None while still learning it."""
        samples = self.samples[key]
        if len(samples) < self.warmup:
            samples.append(offset)
            return None
        change = offset - statistics.median(samples)
        if abs(change) < threshold:
            samples.append(offset)
        return change


def _crop(frame, box):
    height, width = frame.shape[:2]
    x1, y1, x2, y2 = box
    pad_x, pad_y = (x2 - x1) * CROP_PADDING, (y2 - y1) * CROP_PADDING
    x1, y1 = max(0, int(x1 - pad_x)), max(0, int(y1 - pad_y))
    x2, y2 = min(width, int(x2 + pad_x)), min(height, int(y2 + pad_y))
    return frame[y1:y2, x1:x2]


def _zone_fractions(video):
    if not video.zone:
        return None
    return (video.zone_x1 / 100, video.zone_y1 / 100, video.zone_x2 / 100, video.zone_y2 / 100)


def _foot_in_zone(box, zone, width, height):
    """The bottom-centre of a person's box is where they stand or sit."""
    x1, _, x2, y2 = box
    fx, fy = (x1 + x2) / 2 / width, y2 / height
    zx1, zy1, zx2, zy2 = zone
    return zx1 <= fx <= zx2 and zy1 <= fy <= zy2


def _phone_owner(phone_box, persons, track_ids):
    """Track id of the student whose (slightly widened) box contains the phone's centre."""
    cx, cy = (phone_box[0] + phone_box[2]) / 2, (phone_box[1] + phone_box[3]) / 2
    best, best_dist = None, None
    for (box, _), track_id in zip(persons, track_ids):
        x1, y1, x2, y2 = box
        pad_x, pad_y = (x2 - x1) * 0.15, (y2 - y1) * 0.15
        if x1 - pad_x <= cx <= x2 + pad_x and y1 - pad_y <= cy <= y2 + pad_y:
            dist = (cx - (x1 + x2) / 2) ** 2 + (cy - (y1 + y2) / 2) ** 2
            if best_dist is None or dist < best_dist:
                best, best_dist = track_id, dist
    return best


def _iou(a, b):
    ix1, iy1, ix2, iy2 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


class _IouTracker:
    """Greedy IoU matching of this frame's person boxes to recently seen ones."""

    def __init__(self, min_iou=0.3, max_age_seconds=2.0):
        self.min_iou = min_iou
        self.max_age = max_age_seconds
        self.tracks = {}  # track_id -> (box, last_seen_t)
        self.next_id = 1

    def update(self, boxes, t):
        self.tracks = {tid: (b, seen) for tid, (b, seen) in self.tracks.items() if t - seen <= self.max_age}
        pairs = sorted(
            ((_iou(box, tbox), i, tid) for i, box in enumerate(boxes) for tid, (tbox, _) in self.tracks.items()),
            reverse=True,
        )
        assigned, used = {}, set()
        for overlap, i, tid in pairs:
            if overlap < self.min_iou:
                break
            if i not in assigned and tid not in used:
                assigned[i] = tid
                used.add(tid)

        ids = []
        for i, box in enumerate(boxes):
            tid = assigned.get(i)
            if tid is None:
                tid = self.next_id
                self.next_id += 1
            self.tracks[tid] = (box, t)
            ids.append(tid)
        return ids


class _Event:
    """One ongoing observation of a flag type for one student."""

    def __init__(self, flag_type, track_id, t):
        self.flag_type = flag_type
        self.track_id = track_id
        self.start = t
        self.last = t
        self.end = t
        self.scores = []
        self.peak = -1.0
        self.peak_frame_number = 0
        self.peak_image = None
        self.peak_box = None
        self.segments = 0          # separate stretches inside the event, e.g. head turns
        self.max_offset = 0.0
        self.posture_scores = []

    def add(self, t, score, frame_number, image, box, info, sample_interval):
        if not self.scores or t - self.last > 1.5 * sample_interval:
            self.segments += 1
        self.last = t
        self.scores.append(score)
        self.max_offset = max(self.max_offset, info.get("offset", 0.0))
        if "posture" in info:
            self.posture_scores.append(info["posture"])
        if score > self.peak:
            self.peak = score
            self.peak_frame_number = frame_number
            self.peak_image = image
            self.peak_box = box

    def detail(self):
        if self.flag_type != Flag.TYPE_HEAD_TURN:
            return {}
        detail = {"turns": self.segments, "maxOffset": round(self.max_offset, 2)}
        if self.posture_scores:
            detail["postureScore"] = round(sum(self.posture_scores) / len(self.posture_scores), 2)
        return detail


class _EventBuilder:
    """Merges per-frame observations into events, bridging short gaps."""

    def __init__(self, sample_interval):
        self.sample_interval = sample_interval
        self.open = {}

    def observe(self, t, active, frame_number, image):
        """Feed one sampled frame; returns events that just ended and are long enough."""
        for (flag_type, track_id), (score, box, info) in active.items():
            event = self.open.get((flag_type, track_id))
            if event is None:
                event = self.open[(flag_type, track_id)] = _Event(flag_type, track_id, t)
            event.add(t, score, frame_number, image, box, info, self.sample_interval)

        ended = [
            key for key, event in self.open.items()
            if key not in active and t - event.last > settings.FLAG_GAP_SECONDS[event.flag_type]
        ]
        return [e for e in (self._close(key) for key in ended) if e]

    def finish(self):
        return [e for e in (self._close(key) for key in list(self.open)) if e]

    def _close(self, key):
        event = self.open.pop(key)
        event.end = event.last + self.sample_interval
        if event.end - event.start >= settings.FLAG_MIN_DURATION[event.flag_type]:
            return event
        return None


def build_flag(video, event, zone):
    """An unsaved Flag with its snapshot written to SNAPSHOT_DIR (saved by the caller in one transaction)."""
    image = event.peak_image.copy()
    height, width = image.shape[:2]
    thickness = max(2, width // 480)
    red, yellow = (0, 0, 255), (0, 215, 255)

    if zone:
        zx1, zy1, zx2, zy2 = zone
        cv2.rectangle(image, (int(zx1 * width), int(zy1 * height)), (int(zx2 * width), int(zy2 * height)),
                      yellow, thickness)

    x1, y1, x2, y2 = (int(v) for v in event.peak_box)
    cv2.rectangle(image, (x1, y1), (x2, y2), red, thickness)
    subject = f"Person {event.track_id}" if event.track_id else "Unassigned"
    label = f"{subject} | {dict(Flag.TYPE_CHOICES)[event.flag_type]} {event.peak:.2f}"
    font_scale = 0.35 * thickness
    (text_width, _), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, font_scale, thickness)
    text_x = max(0, min(x1, width - text_width))  # keep the label inside the frame
    cv2.putText(image, label, (text_x, max(y1 - 3 * thickness, 12 * thickness)),
                cv2.FONT_HERSHEY_SIMPLEX, font_scale, red, thickness)

    if width > SNAPSHOT_MAX_WIDTH:
        scale = SNAPSHOT_MAX_WIDTH / width
        image = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)

    name = ""
    success, buffer = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 85])
    if success:
        # Random name: snapshots show people; served only through the API.
        name = f"snapshots/{uuid.uuid4().hex}.jpg"
        (settings.MEDIA_ROOT / name).write_bytes(buffer.tobytes())
    return Flag(
        clip=video, exam_id=video.exam_id, signal=event.flag_type, track_id=event.track_id,
        start_seconds=round(event.start, 2), end_seconds=round(event.end, 2),
        confidence=min(1.0, round(sum(event.scores) / len(event.scores), 4)),
        peak_confidence=min(1.0, round(event.peak, 4)), frame_number=event.peak_frame_number,
        bbox=[round(x1 / width * 100, 2), round(y1 / height * 100, 2),
              round(x2 / width * 100, 2), round(y2 / height * 100, 2)],
        snapshot=name, evidence=event.detail(),
    )
