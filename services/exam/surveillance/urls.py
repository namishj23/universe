from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from . import views

urlpatterns = [
    path("auth/login/", views.LoginView.as_view(), name="login"),
    path("auth/refresh/", TokenRefreshView.as_view(), name="token_refresh"),

    path("upload-video/", views.VideoUploadView.as_view(), name="upload-video"),
    path("videos/", views.VideoListView.as_view(), name="video-list"),
    path("video/<int:pk>/", views.VideoDetailView.as_view(), name="video-detail"),
    path("video/<int:pk>/reprocess/", views.reprocess_video, name="video-reprocess"),
    path("dashboard/stats/", views.dashboard_stats, name="dashboard-stats"),

    path("live/start/", views.live_start, name="live-start"),
    path("live/stop/", views.live_stop, name="live-stop"),
    path("live/status/", views.live_status, name="live-status"),
    path("live/stream/", views.live_stream, name="live-stream"),
]
