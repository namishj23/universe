from django.conf import settings
from django.core import signing
from django.db.models import Count
from django.http import HttpResponseForbidden, HttpResponseNotFound, StreamingHttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone

from rest_framework import generics, permissions, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework_simplejwt.views import TokenObtainPairView

from .models import Flag, Video
from .serializers import (
    VideoDetailSerializer,
    VideoListSerializer,
    VideoUploadSerializer,
)
from . import detection, live

STREAM_TOKEN_SALT = "live-stream"


class LoginView(TokenObtainPairView):
    """POST { username, password } -> { access, refresh }"""

    permission_classes = [permissions.AllowAny]


class VideoUploadView(generics.CreateAPIView):
    """POST /api/upload-video/  (multipart form: room, exam_name, file, optional zone_x1..zone_y2)"""

    serializer_class = VideoUploadSerializer
    permission_classes = [permissions.IsAuthenticated]

    def perform_create(self, serializer):
        video = serializer.save(uploaded_by=self.request.user)
        # The upload request returns immediately; a background worker runs detection.
        detection.enqueue(video.id)


class VideoListView(generics.ListAPIView):
    """GET /api/videos/  -> table of all uploaded videos"""

    serializer_class = VideoListSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        qs = Video.objects.annotate(flag_count=Count("flags"))
        room = self.request.query_params.get("room")
        status_filter = self.request.query_params.get("status")
        if room:
            qs = qs.filter(room__icontains=room)
        if status_filter:
            qs = qs.filter(status=status_filter)
        return qs


class VideoDetailView(generics.RetrieveAPIView):
    """GET /api/video/<id>/ -> full video + zone + flags"""

    queryset = Video.objects.prefetch_related("flags")
    serializer_class = VideoDetailSerializer
    permission_classes = [permissions.IsAuthenticated]


@api_view(["POST"])
@permission_classes([permissions.IsAuthenticated])
def reprocess_video(request, pk):
    """POST /api/video/<id>/reprocess/ -> run detection again (e.g. after a failure or stall)"""

    video = get_object_or_404(Video, pk=pk)
    if video.status == Video.STATUS_PROCESSING and not video.is_stalled:
        return Response({"detail": "This video is already being processed."}, status=status.HTTP_409_CONFLICT)
    video.status = Video.STATUS_PENDING
    video.save(update_fields=["status"])
    detection.enqueue(video.id)
    return Response({"detail": "Queued for processing."}, status=status.HTTP_202_ACCEPTED)


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def dashboard_stats(request):
    """GET /api/dashboard/stats/ -> summary cards + most recent flags"""

    today = timezone.localdate()
    recent = Flag.objects.select_related("video").order_by("-created_at")[:10]

    return Response(
        {
            "total_videos": Video.objects.count(),
            "processed_videos": Video.objects.filter(status=Video.STATUS_COMPLETED).count(),
            "total_flags": Flag.objects.count(),
            "flags_today": Flag.objects.filter(created_at__date=today).count(),
            "recent_flags": [
                {
                    "id": flag.id,
                    "video_id": flag.video_id,
                    "room": flag.video.room,
                    "flag_type_display": flag.get_flag_type_display(),
                    "subject_display": flag.subject_display,
                    "start_display": flag.start_display,
                    "confidence": flag.confidence,
                }
                for flag in recent
            ],
        }
    )


def _live_status(_request):
    session = live.current()
    if session is None or session.finished:
        return {"active": False}
    token = signing.dumps({"video": session.video.id}, salt=STREAM_TOKEN_SALT)
    return {
        "active": True,
        "stopping": session.stop_event.is_set(),
        "video_id": session.video.id,
        "room": session.video.room,
        "elapsed_seconds": round(session.elapsed, 1),
        "analysed_fps": round(session.analysed_fps, 1),
        "error": session.error,
        # <img> tags cannot send the login header, so the live view gets a signed link.
        "stream_url": f"/api/live/stream/?token={token}",
    }


@api_view(["POST"])
@permission_classes([permissions.IsAuthenticated])
def live_start(request):
    """POST /api/live/start/ {room, exam_name, consent: true} -> open the webcam and start"""

    room = str(request.data.get("room", "")).strip()
    if not room:
        return Response({"detail": "Room is required."}, status=status.HTTP_400_BAD_REQUEST)
    if request.data.get("consent") is not True:
        return Response(
            {"detail": "Confirm that everyone on camera has agreed to be recorded."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    try:
        live.start(request.user, room[:50], str(request.data.get("exam_name", ""))[:150])
    except live.LiveError as exc:
        return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
    return Response(_live_status(request), status=status.HTTP_201_CREATED)


@api_view(["POST"])
@permission_classes([permissions.IsAuthenticated])
def live_stop(request):
    """POST /api/live/stop/ -> stop recording; the session then saves like an upload"""

    try:
        session = live.stop()
    except live.LiveError as exc:
        return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
    return Response({"video_id": session.video.id}, status=status.HTTP_202_ACCEPTED)


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def live_status(request):
    """GET /api/live/status/ -> whether a session is running, and its live-view link"""

    return Response(_live_status(request))


def live_stream(request):
    """GET /api/live/stream/?token=... -> MJPEG live view (token from live_status)"""

    try:
        payload = signing.loads(
            request.GET.get("token", ""), salt=STREAM_TOKEN_SALT,
            max_age=(settings.LIVE_MAX_MINUTES + 5) * 60,
        )
    except signing.BadSignature:
        return HttpResponseForbidden("Invalid or expired live-view link.")
    session = live.current()
    if session is None or session.finished or session.video.id != payload.get("video"):
        return HttpResponseNotFound("This live session has ended.")
    response = StreamingHttpResponse(
        live.stream_frames(session), content_type="multipart/x-mixed-replace; boundary=frame"
    )
    response["Cache-Control"] = "no-store"
    return response
