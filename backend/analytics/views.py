from django.db.models import Count, Q
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import User
from accounts.permissions import IsAdmin
from leads.models import Lead


def metrics(queryset):
    total = queryset.count()
    counts = queryset.aggregate(qualified=Count("id", filter=Q(status=Lead.Status.QUALIFIED)), walkins=Count("id", filter=Q(status=Lead.Status.WALKIN)), won=Count("id", filter=Q(status=Lead.Status.WON)), lost=Count("id", filter=Q(status__in=[Lead.Status.LOST, Lead.Status.UNQUALIFIED])))
    return {"total_assigned": total, "total_called": queryset.exclude(status=Lead.Status.FRESH).count(), **counts, "conversion_rate": round((counts["won"] / total) * 100, 1) if total else 0}


class AdminAnalyticsView(APIView):
    permission_classes = [IsAdmin]

    def get(self, request):
        queryset = Lead.objects.filter(deleted_at__isnull=True)
        source = list(queryset.values("source").annotate(total=Count("id"), qualified=Count("id", filter=Q(status=Lead.Status.QUALIFIED)), won=Count("id", filter=Q(status=Lead.Status.WON))).order_by("source"))
        active_leads = Q(assigned_leads__deleted_at__isnull=True)
        officers = []
        for user in User.objects.filter(role=User.Role.SALES_OFFICER).annotate(
            total_assigned=Count("assigned_leads", filter=active_leads),
            total_called=Count("assigned_leads", filter=active_leads & ~Q(assigned_leads__status=Lead.Status.FRESH)),
            qualified=Count("assigned_leads", filter=active_leads & Q(assigned_leads__status=Lead.Status.QUALIFIED)),
            walkins=Count("assigned_leads", filter=active_leads & Q(assigned_leads__status=Lead.Status.WALKIN)),
            won=Count("assigned_leads", filter=active_leads & Q(assigned_leads__status=Lead.Status.WON)),
            lost=Count("assigned_leads", filter=active_leads & Q(assigned_leads__status__in=[Lead.Status.LOST, Lead.Status.UNQUALIFIED])),
        ):
            officers.append({"id": user.id, "name": user.get_full_name() or user.email, "total_assigned": user.total_assigned, "total_called": user.total_called, "qualified": user.qualified, "walkins": user.walkins, "won": user.won, "lost": user.lost, "conversion_rate": round((user.won / user.total_assigned) * 100, 1) if user.total_assigned else 0})
        return Response({"summary": metrics(queryset), "source": source, "officers": officers, "generated_at": timezone.now()})


class MyAnalyticsView(APIView):
    def get(self, request):
        return Response(metrics(Lead.objects.filter(assigned_so=request.user, deleted_at__isnull=True)))
