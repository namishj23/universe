from django.urls import include, path

urlpatterns = [path("exam/", include("surveillance.urls"))]

handler400 = "surveillance.errors.handler400"
handler403 = "surveillance.errors.handler403"
handler404 = "surveillance.errors.handler404"
handler500 = "surveillance.errors.handler500"
