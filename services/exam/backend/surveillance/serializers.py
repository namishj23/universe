from collections import Counter

from rest_framework import serializers

from .models import Flag, Video


class FlagSerializer(serializers.ModelSerializer):
    flag_type_display = serializers.CharField(source="get_flag_type_display", read_only=True)
    subject_display = serializers.ReadOnlyField()
    start_display = serializers.ReadOnlyField()
    end_display = serializers.ReadOnlyField()
    duration_seconds = serializers.ReadOnlyField()

    class Meta:
        model = Flag
        fields = [
            "id",
            "flag_type",
            "flag_type_display",
            "track_id",
            "subject_display",
            "start_seconds",
            "end_seconds",
            "start_display",
            "end_display",
            "duration_seconds",
            "confidence",
            "peak_confidence",
            "frame_number",
            "bbox",
            "detail",
            "snapshot",
        ]


class VideoListSerializer(serializers.ModelSerializer):
    """Lightweight serializer used for the videos table."""

    flag_count = serializers.IntegerField(read_only=True)
    progress_percentage = serializers.ReadOnlyField()
    is_stalled = serializers.ReadOnlyField()

    class Meta:
        model = Video
        fields = [
            "id",
            "room",
            "exam_name",
            "source",
            "status",
            "is_stalled",
            "duration_seconds",
            "uploaded_at",
            "processed_at",
            "flag_count",
            "frames_processed",
            "total_frames_expected",
            "progress_percentage",
        ]


class VideoDetailSerializer(serializers.ModelSerializer):
    """Full serializer including the video file, zone and flags."""

    flags = FlagSerializer(many=True, read_only=True)
    flag_summary = serializers.SerializerMethodField()
    progress_percentage = serializers.ReadOnlyField()
    is_stalled = serializers.ReadOnlyField()
    has_zone = serializers.ReadOnlyField()

    class Meta:
        model = Video
        fields = [
            "id",
            "room",
            "exam_name",
            "source",
            "file",
            "status",
            "is_stalled",
            "duration_seconds",
            "uploaded_at",
            "processed_at",
            "error_message",
            "frames_processed",
            "total_frames_expected",
            "progress_percentage",
            "has_zone",
            "zone_x1",
            "zone_y1",
            "zone_x2",
            "zone_y2",
            "flag_summary",
            "flags",
        ]

    def get_flag_summary(self, obj):
        counts = Counter(flag.flag_type for flag in obj.flags.all())
        return [
            {"flag_type": value, "label": label, "count": counts.get(value, 0)}
            for value, label in Flag.TYPE_CHOICES
        ]


class VideoUploadSerializer(serializers.ModelSerializer):
    ZONE_FIELDS = ("zone_x1", "zone_y1", "zone_x2", "zone_y2")

    class Meta:
        model = Video
        fields = ["id", "room", "exam_name", "file", "zone_x1", "zone_y1", "zone_x2", "zone_y2"]
        # The model allows a blank file (a live session before it is saved); uploads must have one.
        extra_kwargs = {"file": {"required": True, "allow_empty_file": False}}

    def validate(self, attrs):
        zone = [attrs.get(name) for name in self.ZONE_FIELDS]
        if any(v is not None for v in zone):
            if any(v is None for v in zone):
                raise serializers.ValidationError("Give all four restricted-zone values, or none.")
            x1, y1, x2, y2 = zone
            if not all(0 <= v <= 100 for v in zone):
                raise serializers.ValidationError("Restricted-zone values are percentages from 0 to 100.")
            if x1 >= x2 or y1 >= y2:
                raise serializers.ValidationError("Restricted zone: left < right and top < bottom.")
        return attrs
