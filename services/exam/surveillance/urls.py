from django.urls import path

from . import views

urlpatterns = [
    path("exams", views.ExamList.as_view()),
    path("clips", views.Clips.as_view()),
    path("clips/<uuid:pk>", views.ClipDetail.as_view()),
    path("clips/<uuid:pk>/video", views.ClipVideo.as_view()),
    path("flags", views.FlagList.as_view()),
    path("flags/<uuid:pk>", views.FlagDetail.as_view()),
    path("flags/<uuid:pk>/snapshot", views.FlagSnapshot.as_view()),
    path("flags/<uuid:pk>/review", views.FlagReviewView.as_view()),
    path("flags/<uuid:pk>/reopen", views.FlagReopen.as_view()),
    path("dashboard-summary", views.DashboardSummary.as_view()),
]
