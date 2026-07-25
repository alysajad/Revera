from django.urls import path

from .views import AdminAnalyticsView, MyAnalyticsExportView, MyAnalyticsView

urlpatterns = [path("analytics/admin/", AdminAnalyticsView.as_view()), path("analytics/me/", MyAnalyticsView.as_view()), path("analytics/me/export/", MyAnalyticsExportView.as_view())]
