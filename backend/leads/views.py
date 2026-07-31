from collections import defaultdict

from django.db import transaction
from django.db.models import Count, Prefetch, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from accounts.models import User
from accounts.permissions import IsAdmin
from notifications.models import Notification
from .models import CallLog, FollowUp, Lead, LeadAudit, LeadQualification
from .serializers import AssignmentSerializer, FollowUpSerializer, LeadDetailSerializer, LeadSerializer, LeadUpdateSerializer, SOLeadListSerializer, SOLeadUpdateSerializer

FORWARD_TRANSITIONS = {
    Lead.Status.FRESH: {Lead.Status.RNR, Lead.Status.CALLBACK, Lead.Status.QUALIFIED, Lead.Status.UNQUALIFIED, Lead.Status.LOST},
    Lead.Status.RNR: {Lead.Status.CALLBACK, Lead.Status.QUALIFIED, Lead.Status.UNQUALIFIED, Lead.Status.LOST},
    Lead.Status.CALLBACK: {Lead.Status.RNR, Lead.Status.QUALIFIED, Lead.Status.UNQUALIFIED, Lead.Status.WALKIN, Lead.Status.LOST},
    Lead.Status.QUALIFIED: {Lead.Status.WALKIN, Lead.Status.WON, Lead.Status.LOST},
    Lead.Status.WALKIN: {Lead.Status.WON, Lead.Status.LOST},
}


def apply_lead_filters(queryset, filters):
    if value := filters.get("source"):
        queryset = queryset.filter(source=value)
    if value := filters.get("status"):
        queryset = queryset.filter(status=value)
    for key, field in (("model", "model_interest"), ("city", "city"), ("campaign", "campaign")):
        if value := filters.get(key):
            queryset = queryset.filter(**{f"{field}__icontains": value})
    if value := filters.get("source_label"):
        queryset = queryset.filter(Q(source_label__icontains=value) | Q(campaign__icontains=value))
    if value := filters.get("q"):
        queryset = queryset.filter(Q(name__icontains=value) | Q(phone__icontains=value) | Q(campaign__icontains=value) | Q(model_interest__icontains=value) | Q(source_label__icontains=value))
    for key, lookup in (("date_from", "enquiry_date__gte"), ("date_to", "enquiry_date__lte")):
        if value := filters.get(key):
            parsed = parse_date(str(value))
            if not parsed:
                raise ValidationError({key: "Use YYYY-MM-DD."})
            queryset = queryset.filter(**{lookup: parsed})
    return queryset


def audit_value(value):
    return value.isoformat() if hasattr(value, "isoformat") else value


class LeadViewSet(viewsets.ModelViewSet):
    serializer_class = LeadSerializer

    def get_queryset(self):
        queryset = Lead.objects.filter(deleted_at__isnull=True).select_related("assigned_so").annotate(_call_count=Count("call_logs", distinct=True)).prefetch_related("qualification")
        if not self.request.user.is_admin:
            queryset = queryset.filter(assigned_so=self.request.user)
        elif self.request.query_params.get("unassigned") == "true":
            queryset = queryset.filter(assigned_so__isnull=True)
        if value := self.request.query_params.get("assigned_so"):
            queryset = queryset.filter(assigned_so=value)
        queryset = apply_lead_filters(queryset, self.request.query_params)
        ordering = self.request.query_params.get("ordering", "-created_at")
        return queryset.prefetch_related(Prefetch("follow_ups", queryset=FollowUp.objects.filter(resolved_at__isnull=True).order_by("scheduled_for"), to_attr="_open_followups")).order_by(ordering if ordering.lstrip("-") in {"created_at", "enquiry_date", "status"} else "-created_at")

    def retrieve(self, request, *args, **kwargs):
        return Response(LeadDetailSerializer(self.get_object()).data)

    def get_permissions(self):
        if self.action in {"assign", "bulk_assign", "auto_assign", "reopen", "create", "destroy"}:
            return [IsAdmin()]
        return super().get_permissions()

    @action(detail=False, methods=["get"], url_path="my-dashboard")
    def my_dashboard(self, request):
        today = timezone.localdate()
        queryset = Lead.objects.filter(assigned_so=request.user, deleted_at__isnull=True)
        date_range = request.query_params.get("range", "all")
        if date_range == "today":
            queryset = queryset.filter(enquiry_date=today)
        elif date_range == "mtd":
            queryset = queryset.filter(enquiry_date__year=today.year, enquiry_date__month=today.month)
        elif request.query_params.get("date_from") or request.query_params.get("date_to"):
            if request.query_params.get("date_from"):
                queryset = queryset.filter(enquiry_date__gte=parse_date(request.query_params["date_from"]))
            if request.query_params.get("date_to"):
                queryset = queryset.filter(enquiry_date__lte=parse_date(request.query_params["date_to"]))

        summary = {
            "total": queryset.count(),
            "fresh": queryset.filter(status=Lead.Status.FRESH).count(),
            "followups": queryset.filter(follow_ups__resolved_at__isnull=True).distinct().count(),
            "pending": queryset.filter(status__in=[Lead.Status.RNR, Lead.Status.CALLBACK]).count(),
            "qualified": queryset.filter(status=Lead.Status.QUALIFIED).count(),
            "walkin": queryset.filter(status=Lead.Status.WALKIN).count(),
            "won": queryset.filter(status=Lead.Status.WON).count(),
            "lost": queryset.filter(status__in=[Lead.Status.LOST, Lead.Status.UNQUALIFIED]).count(),
            "won_lost": queryset.filter(status__in=[Lead.Status.WON, Lead.Status.LOST, Lead.Status.UNQUALIFIED]).count(),
            "untouched": queryset.filter(status=Lead.Status.FRESH).count(),
            "called": queryset.exclude(status=Lead.Status.FRESH).count(),
            "scheduled": queryset.filter(follow_ups__resolved_at__isnull=True).distinct().count(),
        }
        section = request.query_params.get("section", "fresh")
        section_filters = {
            "fresh": Q(status=Lead.Status.FRESH),
            "followups": Q(follow_ups__resolved_at__isnull=True),
            "pending": Q(status__in=[Lead.Status.RNR, Lead.Status.CALLBACK]),
            "qualified": Q(status=Lead.Status.QUALIFIED),
            "walkin": Q(status=Lead.Status.WALKIN),
            "won_lost": Q(status__in=[Lead.Status.WON, Lead.Status.LOST, Lead.Status.UNQUALIFIED]),
        }
        if section in section_filters:
            queryset = queryset.filter(section_filters[section])
        if value := request.query_params.get("category"):
            queryset = queryset.filter(category=value.upper())
        if value := request.query_params.get("source"):
            queryset = queryset.filter(source=value.upper())
        if value := request.query_params.get("q"):
            queryset = queryset.filter(Q(name__icontains=value) | Q(phone__icontains=value) | Q(campaign__icontains=value) | Q(model_interest__icontains=value) | Q(branch__icontains=value))
        leads = queryset.distinct().order_by("-enquiry_date", "-created_at").only("id", "status", "name", "phone", "source")
        return Response({"summary": summary, "section": section, "results": SOLeadListSerializer(leads, many=True).data})

    @action(detail=True, methods=["patch"], url_path="so-update")
    def so_update(self, request, pk=None):
        lead = self.get_object()
        if not request.user.is_admin and lead.assigned_so_id != request.user.id:
            return Response({"detail": "This lead is not assigned to you."}, status=status.HTTP_403_FORBIDDEN)
        serializer = SOLeadUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        sales_status = {Lead.SalesOutcome.BOOKED: Lead.Status.WALKIN, Lead.SalesOutcome.RETAILED: Lead.Status.WON, Lead.SalesOutcome.LOST: Lead.Status.LOST}
        call_status = {"QUALIFIED": Lead.Status.QUALIFIED, "NOT_CONNECTED": Lead.Status.RNR, "PENDING": Lead.Status.CALLBACK, "LOST": Lead.Status.LOST}
        call_outcome = data.get("call_outcome")
        if call_outcome == "PENDING" and not data.get("follow_up_at"):
            return Response({"detail": "Pending calls require a follow-up time."}, status=status.HTTP_400_BAD_REQUEST)
        if call_outcome and call_outcome != "PENDING" and data.get("follow_up_at"):
            return Response({"detail": "Only pending calls can have a follow-up time."}, status=status.HTTP_400_BAD_REQUEST)
        next_status = call_status.get(call_outcome) if call_outcome else data.get("status") or sales_status.get(data.get("sales_outcome"), lead.status)
        if data.get("follow_up_at") and next_status in {Lead.Status.FRESH, Lead.Status.RNR}:
            next_status = Lead.Status.CALLBACK
        if data.get("follow_up_at") and next_status not in {Lead.Status.CALLBACK, Lead.Status.WALKIN}:
            return Response({"detail": "Only callbacks and walk-ins can have an appointment."}, status=status.HTTP_400_BAD_REQUEST)
        if not request.user.is_admin and next_status != lead.status and next_status not in FORWARD_TRANSITIONS.get(lead.status, set()):
            return Response({"detail": "This status transition is not allowed."}, status=status.HTTP_400_BAD_REQUEST)
        editable_fields = ("name", "phone", "email", "source", "source_label", "campaign", "model_interest", "city", "branch", "enquiry_date")
        before = {field: audit_value(getattr(lead, field)) for field in ("status", "category", "sales_outcome", *editable_fields)}
        with transaction.atomic():
            lead.status = next_status
            for field in ("category", "sales_outcome", *editable_fields):
                if field in data:
                    setattr(lead, field, data[field])
            lead.save(update_fields=["status", "category", "sales_outcome", *[field for field in editable_fields if field in data], "updated_at"])
            if qualification := data.get("qualification"):
                record, _ = LeadQualification.objects.get_or_create(lead=lead)
                for field, value in qualification.items():
                    setattr(record, field, value)
                record.updated_by = request.user
                record.save()
            if any(field in data for field in ("status", "sales_outcome", "remarks", "call_outcome", "follow_up_at")):
                FollowUp.objects.filter(lead=lead, resolved_at__isnull=True).update(resolved_at=timezone.now())
                CallLog.objects.create(lead=lead, so=request.user, status=next_status, outcome=data.get("call_outcome", ""), remarks=data.get("remarks", ""))
                if follow_up_at := data.get("follow_up_at"):
                    FollowUp.objects.create(lead=lead, so=request.user, scheduled_for=follow_up_at)
            after = {field: audit_value(getattr(lead, field)) for field in ("status", "category", "sales_outcome", *editable_fields)}
            LeadAudit.objects.create(lead=lead, actor=request.user, event="so_updated", before=before, after=after)
        return Response(LeadDetailSerializer(self.get_object()).data)

    @action(detail=True, methods=["post"])
    def assign(self, request, pk=None):
        lead = self.get_object()
        serializer = AssignmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        officer = serializer.validated_data["sales_officer"]
        with transaction.atomic():
            lead = Lead.objects.select_for_update().get(pk=lead.pk)
            if lead.assigned_so_id:
                return Response({"detail": "This lead is already assigned."}, status=status.HTTP_409_CONFLICT)
            lead.assigned_so = officer
            lead.save(update_fields=["assigned_so", "updated_at"])
            LeadAudit.objects.create(lead=lead, actor=request.user, event="assigned", after={"assigned_so": officer.id})
            Notification.objects.create(user=officer, lead=lead, kind=Notification.Kind.ASSIGNMENT, message=f"You have a new lead: {lead.name}.")
        return Response(self.get_serializer(lead).data)

    @action(detail=False, methods=["post"], url_path="bulk-assign")
    def bulk_assign(self, request):
        serializer = AssignmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        filters = request.data.get("filters", {})
        if not isinstance(filters, dict):
            raise ValidationError({"filters": "Expected an object of filter values."})
        officer = serializer.validated_data["sales_officer"]
        leads = Lead.objects.filter(deleted_at__isnull=True, assigned_so__isnull=True)
        leads = apply_lead_filters(leads, filters)
        with transaction.atomic():
            leads = list(leads.select_for_update().order_by("created_at"))
            for lead in leads:
                lead.assigned_so = officer
                lead.save(update_fields=["assigned_so", "updated_at"])
            LeadAudit.objects.bulk_create([LeadAudit(lead=lead, actor=request.user, event="assigned", after={"assigned_so": officer.id}) for lead in leads])
            if leads:
                Notification.objects.create(user=officer, kind=Notification.Kind.ASSIGNMENT, message=f"You have {len(leads)} new lead(s) assigned.")
        return Response({"assigned": len(leads)})

    @action(detail=False, methods=["post"], url_path="auto-assign")
    def auto_assign(self, request):
        lead_ids = request.data.get("lead_ids", [])
        with transaction.atomic():
            leads = Lead.objects.select_for_update().filter(deleted_at__isnull=True, assigned_so__isnull=True)
            if lead_ids:
                leads = leads.filter(id__in=lead_ids)
            leads = list(leads.order_by("created_at"))
            officers = list(User.objects.filter(role=User.Role.SALES_OFFICER, is_active=True).annotate(load=Count("assigned_leads", filter=Q(assigned_leads__deleted_at__isnull=True))).order_by("load", "id"))
            if not officers:
                return Response({"detail": "No active sales officers."}, status=status.HTTP_400_BAD_REQUEST)
            if not leads:
                return Response({"assigned": 0, "distribution": {}})
            distribution = defaultdict(int)
            for index, lead in enumerate(leads):
                officer = officers[index % len(officers)]
                lead.assigned_so = officer
                lead.save(update_fields=["assigned_so", "updated_at"])
                LeadAudit.objects.create(lead=lead, actor=request.user, event="auto_assigned", after={"assigned_so": officer.id})
                distribution[officer.get_full_name() or officer.email] += 1
            Notification.objects.bulk_create([Notification(user=officer, kind=Notification.Kind.ASSIGNMENT, message=f"You have {count} new lead(s) assigned.") for officer, count in ((officer, distribution.get(officer.get_full_name() or officer.email, 0)) for officer in officers) if count])
        return Response({"assigned": len(leads), "distribution": distribution})

    @action(detail=True, methods=["post"], url_path="log-call")
    def log_call(self, request, pk=None):
        with transaction.atomic():
            lead = get_object_or_404(self.get_queryset().select_for_update(), pk=pk)
            if not request.user.is_admin and lead.assigned_so_id != request.user.id:
                return Response({"detail": "This lead is not assigned to you."}, status=status.HTTP_403_FORBIDDEN)
            serializer = LeadUpdateSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            next_status = serializer.validated_data["status"]
            if next_status not in FORWARD_TRANSITIONS.get(lead.status, set()):
                return Response({"detail": "This status transition is not allowed."}, status=status.HTTP_400_BAD_REQUEST)
            previous = lead.status
            lead.status = next_status
            lead.save(update_fields=["status", "updated_at"])
            CallLog.objects.create(lead=lead, so=request.user, status=next_status, outcome=serializer.validated_data.get("call_outcome", ""), remarks=serializer.validated_data.get("remarks", ""))
            FollowUp.objects.filter(lead=lead, resolved_at__isnull=True).update(resolved_at=timezone.now())
            if follow_up_at := serializer.validated_data.get("follow_up_at"):
                FollowUp.objects.create(lead=lead, so=lead.assigned_so or request.user, scheduled_for=follow_up_at)
            LeadAudit.objects.create(lead=lead, actor=request.user, event="status_changed", before={"status": previous}, after={"status": next_status})
        return Response(self.get_serializer(lead).data)

    @action(detail=True, methods=["post"])
    def reopen(self, request, pk=None):
        lead = self.get_object()
        if lead.status not in {Lead.Status.WON, Lead.Status.LOST, Lead.Status.UNQUALIFIED}:
            return Response({"detail": "Only closed leads can be reopened."}, status=status.HTTP_400_BAD_REQUEST)
        previous = lead.status
        lead.status = Lead.Status.QUALIFIED
        lead.save(update_fields=["status", "updated_at"])
        LeadAudit.objects.create(lead=lead, actor=request.user, event="reopened", before={"status": previous}, after={"status": lead.status})
        return Response(self.get_serializer(lead).data)


class FollowUpViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    serializer_class = FollowUpSerializer

    def get_queryset(self):
        queryset = FollowUp.objects.filter(resolved_at__isnull=True).select_related("lead", "so")
        if not self.request.user.is_admin:
            queryset = queryset.filter(so=self.request.user)
        return queryset.order_by("scheduled_for")
