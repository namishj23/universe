from django.contrib import admin
from .models import Flag, Video


class FlagInline(admin.TabularInline):
    model = Flag
    extra = 0
    fields = ("flag_type", "track_id", "start_seconds", "end_seconds", "confidence")
    readonly_fields = fields


@admin.register(Video)
class VideoAdmin(admin.ModelAdmin):
    list_display = ("room", "exam_name", "status", "duration_seconds", "uploaded_at")
    list_filter = ("status", "room")
    search_fields = ("room", "exam_name")
    inlines = [FlagInline]


@admin.register(Flag)
class FlagAdmin(admin.ModelAdmin):
    list_display = ("video", "flag_type", "track_id", "start_seconds", "end_seconds", "confidence")
    list_filter = ("flag_type",)
