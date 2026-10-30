"""Exam service endpoints under /exam/ (contract §4). Identity is set by PlatformIdentity."""

import base64
import json
import os
import re
import uuid
from datetime import datetime, timezone as dt_tz

from django.conf import settings
from django.db import transaction
from django.db.models import Count, Max, Q
from django.http import FileResponse, StreamingHttpResponse
from rest_framework import serializers
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from . import jobs, platform
from .errors import ApiError, not_found
from .explanations import explain
from .models import Clip, Exam, Flag, FlagReview, Job
from .uploads import too_large


def iso(dt):
    return dt.astimezone(dt_tz.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z") if dt else None


class Strict(serializers.Serializer):
    """Rejects unknown fields (400 VALIDATION_ERROR)."""

    def validate(self, attrs):
        unknown = set(self.initial_data) - set(self.fields)
        if unknown:
            raise serializers.ValidationError(f"Unknown field: {sorted(unknown)[0]}.")
        return attrs


def parse(serializer_class, data):
    s = serializer_class(data=data)
    s.is_valid(raise_exception=True)
    return s.validated_data


class PageQuery(Strict):
    limit = serializers.IntegerField(min_value=1, max_value=100, default=20)
    cursor = serializers.CharField(required=False, max_length=200)


def page(qs, q, serialize):
    """Cursor paging on (-created_at, -id); the cursor is opaque base64 JSON."""
    if q.get("cursor"):
        try:
            c = json.loads(base64.urlsafe_b64decode(q["cursor"]))
            t, last = datetime.fromisoformat(c["t"]), uuid.UUID(c["id"])
        except (ValueError, KeyError, TypeError):
            raise ApiError(400, "VALIDATION_ERROR", "cursor: This cursor is not valid.")
        qs = qs.filter(Q(created_at__lt=t) | Q(created_at=t, id__lt=last))
    rows = list(qs.order_by("-created_at", "-id")[: q["limit"] + 1])
    more = len(rows) > q["limit"]
    rows = rows[: q["limit"]]
    nxt = None
    if more:
        raw = json.dumps({"t": rows[-1].created_at.isoformat(), "id": str(rows[-1].id)})
        nxt = base64.urlsafe_b64encode(raw.encode()).decode()
    return {"items": [serialize(r) for r in rows], "nextCursor": nxt}


def exam_json(e):
    return {"id": str(e.id), "name": e.name, "room": e.room, "label": e.label, "createdAt": iso(e.created_at)}


def clip_json(c):
    job = getattr(c, "job", None)
    return {
        "id": str(c.id), "examId": str(c.exam_id), "source": c.source, "contentType": c.content_type,
        "sizeBytes": c.size_bytes, "durationSeconds": round(c.duration_seconds, 2),
        "zone": list(c.zone) if c.zone else None, "createdAt": iso(c.created_at),
        "uploadedBy": {"id": str(c.uploaded_by), "name": c.uploaded_by_name} if c.uploaded_by else None,
        "flagCount": getattr(c, "flag_count", None),
        "videoUrl": f"/api/exam/clips/{c.id}/video",
        "job": job and {
            "id": str(job.id), "status": job.status, "progress": round(job.progress, 1),
            "error": job.error or None, "startedAt": iso(job.started_at), "finishedAt": iso(job.finished_at),
        },
    }


def flag_json(f, detail=False):
    out = {
        "id": str(f.id), "clipId": str(f.clip_id), "examId": str(f.exam_id),
        "signal": f.signal, "signalLabel": f.get_signal_display(),
        "startAt": round(f.start_seconds, 2), "endAt": round(f.end_seconds, 2),
        "confidence": round(f.confidence, 3), "peakConfidence": round(f.peak_confidence, 3),
        "track": {"id": f.track_id, "label": f"Person {f.track_id}"} if f.track_id else None,
        "seatLabel": None, "status": f.status, "decision": f.decision,
        "snapshotUrl": f"/api/exam/flags/{f.id}/snapshot" if f.snapshot else None,
        "createdAt": iso(f.created_at),
    }
    if detail:
        out.update({
            "explanation": explain(f), "evidence": f.evidence, "bbox": f.bbox, "note": f.note or None,
            "decidedBy": {"id": str(f.decided_by), "name": f.decided_by_name} if f.decided_by else None,
            "decidedAt": iso(f.decided_at),
            "history": [{
                "action": h.action, "decision": h.decision, "fromStatus": h.from_status, "toStatus": h.to_status,
                "note": h.note, "actor": {"id": str(h.actor_id), "name": h.actor_name}, "at": iso(h.created_at),
            } for h in f.history.order_by("created_at")],
        })
    return out


class ExamList(APIView):
    def get(self, request):
        return Response(page(Exam.objects.all(), parse(PageQuery, request.query_params), exam_json))


ZONE = re.compile(r"^\s*(\d+(\.\d+)?)\s*,\s*(\d+(\.\d+)?)\s*,\s*(\d+(\.\d+)?)\s*,\s*(\d+(\.\d+)?)\s*$")


class UploadForm(Strict):
    file = serializers.FileField()
    examId = serializers.UUIDField()
    zone = serializers.CharField(required=False, max_length=60)

    def validate_zone(self, value):
        m = ZONE.match(value)
        if not m:
            raise serializers.ValidationError("Give the zone as x1,y1,x2,y2 percentages.")
        x1, y1, x2, y2 = (float(m.group(i)) for i in (1, 3, 5, 7))
        if not (0 <= x1 < x2 <= 100 and 0 <= y1 < y2 <= 100):
            raise serializers.ValidationError("Zone: 0 ≤ x1 < x2 ≤ 100 and 0 ≤ y1 < y2 ≤ 100.")
        return (x1, y1, x2, y2)


def sniff(head):
    if head[4:8] == b"ftyp":
        return "video/mp4", "mp4"
    if head[:4] == b"\x1a\x45\xdf\xa3":
        return "video/webm", "webm"
    return None


class ClipQuery(PageQuery):
    examId = serializers.UUIDField(required=False)


class Clips(APIView):
    parser_classes = [MultiPartParser]

    def get(self, request):
        q = parse(ClipQuery, request.query_params)
        qs = Clip.objects.select_related("job").annotate(flag_count=Count("flags"))
        if q.get("examId"):
            qs = qs.filter(exam_id=q["examId"])
        return Response(page(qs, q, clip_json))

    def post(self, request):
        if int(request.META.get("CONTENT_LENGTH") or 0) > settings.MAX_CLIP_BYTES + 64 * 1024:
            raise too_large()
        form = parse(UploadForm, request.data)
        upload = form["file"]
        head = upload.read(12)
        kind = sniff(head)
        if not kind:
            raise ApiError(415, "UNSUPPORTED_TYPE", "Only mp4 and webm clips are accepted.")
        exam = Exam.objects.filter(id=form["examId"]).first()
        if not exam:
            raise not_found("exam")
        clip_id = uuid.uuid4()
        rel = f"clips/{clip_id}.{kind[1]}"
        dest = settings.MEDIA_ROOT / rel
        upload.seek(0)
        with open(dest, "wb") as out:
            for chunk in upload.chunks():
                out.write(chunk)
        os.chmod(dest, 0o600)
        zone = form.get("zone") or (None,) * 4
        who = request.identity
        with transaction.atomic():
            clip = Clip.objects.create(
                id=clip_id, exam=exam, file=rel, content_type=kind[0], size_bytes=upload.size,
                zone_x1=zone[0], zone_y1=zone[1], zone_x2=zone[2], zone_y2=zone[3],
                uploaded_by=who.id, uploaded_by_name=who.name,
            )
            job = Job.objects.create(clip=clip)
            platform.after_commit("audit", {
                "idempotencyKey": f"exam.clip_uploaded:{clip.id}", "actorUserId": str(who.id),
                "action": "exam.clip_uploaded", "targetType": "exam_clip", "targetId": str(clip.id),
                "meta": {"examId": str(exam.id), "sizeBytes": clip.size_bytes},
            })
            transaction.on_commit(lambda: jobs.enqueue(job.id))
        return Response({"clipId": str(clip.id), "jobId": str(job.id)}, status=202)


class ClipDetail(APIView):
    def get(self, request, pk):
        c = Clip.objects.select_related("job").annotate(flag_count=Count("flags")).filter(id=pk).first()
        if not c:
            raise not_found("clip")
        return Response(clip_json(c))


RANGE = re.compile(r"^bytes=(\d*)-(\d*)$")


class ClipVideo(APIView):
    def get(self, request, pk):
        c = Clip.objects.filter(id=pk).first()
        if not c:
            raise not_found("clip")
        path = settings.MEDIA_ROOT / c.file
        size = path.stat().st_size
        m = RANGE.match(request.headers.get("Range", ""))
        if not m or (not m.group(1) and not m.group(2)):
            res = FileResponse(open(path, "rb"), content_type=c.content_type)
            res["Accept-Ranges"] = "bytes"
            return res
        if m.group(1):
            start = int(m.group(1))
            end = min(int(m.group(2)), size - 1) if m.group(2) else size - 1
        else:
            start, end = max(0, size - int(m.group(2))), size - 1
        if start > end or start >= size:
            raise ApiError(416, "RANGE_NOT_SATISFIABLE", "That byte range is outside the clip.")

        def body():
            with open(path, "rb") as fh:
                fh.seek(start)
                left = end - start + 1
                while left > 0:
                    chunk = fh.read(min(64 * 1024, left))
                    if not chunk:
                        return
                    left -= len(chunk)
                    yield chunk

        res = StreamingHttpResponse(body(), status=206, content_type=c.content_type)
        res["Content-Range"] = f"bytes {start}-{end}/{size}"
        res["Content-Length"] = str(end - start + 1)
        res["Accept-Ranges"] = "bytes"
        return res


class FlagQuery(PageQuery):
    status = serializers.ChoiceField(["open", "dismissed", "resolved", "all"], default="open")
    examId = serializers.UUIDField(required=False)


class FlagList(APIView):
    def get(self, request):
        q = parse(FlagQuery, request.query_params)
        qs = Flag.objects.all()
        if q.get("examId"):
            qs = qs.filter(exam_id=q["examId"])
        counts = {s: 0 for s in ("open", "dismissed", "resolved")}
        counts.update({r["status"]: r["n"] for r in qs.values("status").annotate(n=Count("id")).order_by()})
        if q["status"] != "all":
            qs = qs.filter(status=q["status"])
        return Response({**page(qs, q, flag_json), "counts": counts})


def get_flag(pk, lock=False):
    qs = Flag.objects.select_for_update() if lock else Flag.objects
    f = qs.filter(id=pk).first()
    if not f:
        raise not_found()
    return f


class FlagDetail(APIView):
    def get(self, request, pk):
        return Response(flag_json(get_flag(pk), detail=True))


class FlagSnapshot(APIView):
    def get(self, request, pk):
        f = get_flag(pk)
        if not f.snapshot:
            raise not_found("snapshot")
        res = FileResponse(open(settings.MEDIA_ROOT / f.snapshot, "rb"), content_type="image/jpeg")
        res["Cache-Control"] = "private, max-age=3600"
        return res


class Note(serializers.CharField):
    def __init__(self):
        super().__init__(min_length=1, max_length=1000, trim_whitespace=True)


class ReviewBody(Strict):
    decision = serializers.ChoiceField(["dismiss", "follow_up"])
    note = Note()


class ReopenBody(Strict):
    note = Note()


def _decide(request, pk, body, reopen):
    who = request.identity
    with transaction.atomic():
        f = get_flag(pk, lock=True)
        before = f.status
        if reopen:
            if f.status == Flag.OPEN:
                raise ApiError(409, "CONFLICT", "This flag is already open.")
            f.status, f.decision, f.decided_by, f.decided_by_name, f.decided_at, f.note = (
                Flag.OPEN, None, None, "", None, "")
        else:
            if f.status != Flag.OPEN:
                raise ApiError(409, "CONFLICT", "This flag has already been reviewed.")
            f.status = Flag.STATUS_FOR_DECISION[body["decision"]]
            f.decision, f.decided_by, f.decided_by_name, f.note = body["decision"], who.id, who.name, body["note"]
            from django.utils import timezone
            f.decided_at = timezone.now()
        f.save()
        h = FlagReview.objects.create(
            flag=f, action="reopen" if reopen else "review", decision=None if reopen else body["decision"],
            from_status=before, to_status=f.status, note=body["note"], actor_id=who.id, actor_name=who.name,
        )
        action = "exam.flag_reopened" if reopen else "exam.flag_reviewed"
        platform.after_commit("audit", {
            "idempotencyKey": f"{action}:{h.id}", "actorUserId": str(who.id), "action": action,
            "targetType": "exam_flag", "targetId": str(f.id),
            "meta": {"signal": f.signal, "fromStatus": before, "toStatus": f.status},
        })
    return Response(flag_json(f, detail=True))


class FlagReviewView(APIView):
    def post(self, request, pk):
        return _decide(request, pk, parse(ReviewBody, request.data), reopen=False)


class FlagReopen(APIView):
    def post(self, request, pk):
        return _decide(request, pk, parse(ReopenBody, request.data), reopen=True)


class DashboardSummary(APIView):
    def get(self, request):
        last = Job.objects.filter(status=Job.COMPLETED).aggregate(t=Max("finished_at"))["t"]
        return Response({"openFlags": Flag.objects.filter(status=Flag.OPEN).count(), "lastProcessedAt": iso(last)})
