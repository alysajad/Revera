from django.urls import path

from .views import AdminAnalyticsView, MyAnalyticsView

urlpatterns = [path("analytics/admin/", AdminAnalyticsView.as_view()), path("analytics/me/", MyAnalyticsView.as_view())]
