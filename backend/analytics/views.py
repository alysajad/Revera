import csv

from django.db.models import Count, Q
from django.db.models.functions import TruncMonth
from django.http import HttpResponse
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


def team_metrics(users, lead_relation):
    today = timezone.localdate()
    active_leads = Q(**{f"{lead_relation}__deleted_at__isnull": True})
    rows = []
    for user in users.annotate(
        total_assigned=Count(lead_relation, filter=active_leads),
        total_called=Count(lead_relation, filter=active_leads & ~Q(**{f"{lead_relation}__status": Lead.Status.FRESH})),
        calls_today=Count("call_logs", filter=Q(call_logs__created_at__date=today, call_logs__lead__deleted_at__isnull=True)),
        qualified=Count(lead_relation, filter=active_leads & Q(**{f"{lead_relation}__status": Lead.Status.QUALIFIED})),
        walkins=Count(lead_relation, filter=active_leads & Q(**{f"{lead_relation}__status": Lead.Status.WALKIN})),
        won=Count(lead_relation, filter=active_leads & Q(**{f"{lead_relation}__status": Lead.Status.WON})),
        lost=Count(lead_relation, filter=active_leads & Q(**{f"{lead_relation}__status__in": [Lead.Status.LOST, Lead.Status.UNQUALIFIED]})),
    ):
        rows.append({"id": user.id, "name": user.get_full_name() or user.email, "total_assigned": user.total_assigned, "total_called": user.total_called, "calls_today": user.calls_today, "qualified": user.qualified, "walkins": user.walkins, "won": user.won, "lost": user.lost, "conversion_rate": round((user.won / user.total_assigned) * 100, 1) if user.total_assigned else 0})
    return rows


class AdminAnalyticsView(APIView):
    permission_classes = [IsAdmin]

    def get(self, request):
        queryset = Lead.objects.filter(deleted_at__isnull=True)
        source = list(queryset.values("source").annotate(total=Count("id"), qualified=Count("id", filter=Q(status=Lead.Status.QUALIFIED)), won=Count("id", filter=Q(status=Lead.Status.WON))).order_by("source"))
        cre = team_metrics(User.objects.filter(role=User.Role.CRE), "assigned_leads")
        officers = team_metrics(User.objects.filter(role=User.Role.SALES_OFFICER), "ps_leads")
        return Response({"summary": metrics(queryset), "source": source, "cre": cre, "officers": officers, "generated_at": timezone.now()})


class MyAnalyticsView(APIView):
    def get(self, request):
        owner_filter = {"assigned_so": request.user} if request.user.role == User.Role.CRE else {"assigned_ps": request.user}
        queryset = Lead.objects.filter(deleted_at__isnull=True, **owner_filter)
        date_range = request.query_params.get("range", "mtd")
        today = timezone.localdate()
        if date_range == "today":
            queryset = queryset.filter(enquiry_date=today)
        elif date_range == "mtd":
            queryset = queryset.filter(enquiry_date__year=today.year, enquiry_date__month=today.month)
        elif request.query_params.get("date_from"):
            queryset = queryset.filter(enquiry_date__gte=request.query_params["date_from"])
            if request.query_params.get("date_to"):
                queryset = queryset.filter(enquiry_date__lte=request.query_params["date_to"])
        summary = queryset.aggregate(
            total=Count("id"),
            qualified=Count("id", filter=Q(status=Lead.Status.QUALIFIED)),
            booked=Count("id", filter=Q(sales_outcome=Lead.SalesOutcome.BOOKED)),
            lost=Count("id", filter=Q(status__in=[Lead.Status.LOST, Lead.Status.UNQUALIFIED])),
            retailed=Count("id", filter=Q(sales_outcome=Lead.SalesOutcome.RETAILED)),
        )
        summary["assigned"] = summary["total"]
        summary["conversion_rate"] = round((summary["retailed"] / summary["total"]) * 100, 1) if summary["total"] else 0
        status_counts = list(queryset.values("status").annotate(count=Count("id")).order_by("status"))
        source = list(queryset.values("source").annotate(total=Count("id"), qualified=Count("id", filter=Q(status=Lead.Status.QUALIFIED)), booked=Count("id", filter=Q(sales_outcome=Lead.SalesOutcome.BOOKED)), retailed=Count("id", filter=Q(sales_outcome=Lead.SalesOutcome.RETAILED))).order_by("-total"))
        models = list(queryset.values("model_interest").annotate(total=Count("id"), qualified=Count("id", filter=Q(status=Lead.Status.QUALIFIED)), booked=Count("id", filter=Q(sales_outcome=Lead.SalesOutcome.BOOKED))).order_by("-total"))
        monthly = list(queryset.annotate(month=TruncMonth("enquiry_date")).values("month").annotate(total=Count("id"), qualified=Count("id", filter=Q(status=Lead.Status.QUALIFIED)), booked=Count("id", filter=Q(sales_outcome=Lead.SalesOutcome.BOOKED)), retailed=Count("id", filter=Q(sales_outcome=Lead.SalesOutcome.RETAILED))).order_by("month"))
        return Response({"range": date_range, "summary": summary, "status_counts": status_counts, "source": source, "models": models, "monthly": monthly, "generated_at": timezone.now()})


class MyAnalyticsExportView(APIView):
    def get(self, request):
        owner_filter = {"assigned_so": request.user} if request.user.role == User.Role.CRE else {"assigned_ps": request.user}
        queryset = Lead.objects.filter(deleted_at__isnull=True, **owner_filter).order_by("-enquiry_date")
        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = 'attachment; filename="river-my-analytics.csv"'
        writer = csv.writer(response)
        writer.writerow(["Lead", "Phone", "Source", "Model", "Status", "Sales outcome", "Enquiry date", "Branch"])
        writer.writerows(queryset.values_list("name", "phone", "source", "model_interest", "status", "sales_outcome", "enquiry_date", "branch"))
        return response


class ReceptionistAnalyticsView(APIView):
    def get(self, request):
        if getattr(request.user, "role", None) != "RECEPTIONIST":
            return Response(status=403)
        today = timezone.localdate()
        # Find leads created by this receptionist today
        created_lead_ids = LeadAudit.objects.filter(actor=request.user, event="created", created_at__date=today).values_list("lead_id", flat=True)
        queryset = Lead.objects.filter(id__in=created_lead_ids, deleted_at__isnull=True)
        total = queryset.count()
        walkins = queryset.filter(source=Lead.Source.WALKIN).count()
        digital = total - walkins
        # Breakdown by SO assignment
        so_breakdown = list(queryset.values("assigned_ps__first_name", "assigned_ps__last_name", "assigned_ps__email").annotate(count=Count("id")).order_by("-count"))
        formatted_so_breakdown = [
            {
                "name": f"{so['assigned_ps__first_name'] or ''} {so['assigned_ps__last_name'] or ''}".strip() or so["assigned_ps__email"] or "Unassigned",
                "count": so["count"]
            }
            for so in so_breakdown
        ]
        return Response({
            "summary": {
                "total": total,
                "walkin": walkins,
                "digital": digital
            },
            "so_breakdown": formatted_so_breakdown,
            "generated_at": timezone.now()
        })
