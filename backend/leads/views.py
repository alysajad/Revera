from collections import defaultdict

from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from accounts.models import User
from accounts.permissions import IsAdmin
from notifications.models import Notification
from .models import CallLog, FollowUp, Lead, LeadAudit
from .serializers import AssignmentSerializer, FollowUpSerializer, LeadSerializer, LeadUpdateSerializer

FORWARD_TRANSITIONS = {
    Lead.Status.FRESH: {Lead.Status.RNR, Lead.Status.CALLBACK, Lead.Status.QUALIFIED, Lead.Status.UNQUALIFIED},
    Lead.Status.RNR: {Lead.Status.CALLBACK, Lead.Status.QUALIFIED, Lead.Status.UNQUALIFIED},
    Lead.Status.CALLBACK: {Lead.Status.RNR, Lead.Status.QUALIFIED, Lead.Status.UNQUALIFIED, Lead.Status.WALKIN},
    Lead.Status.QUALIFIED: {Lead.Status.WALKIN, Lead.Status.WON, Lead.Status.LOST},
    Lead.Status.WALKIN: {Lead.Status.WON, Lead.Status.LOST},
}


class LeadViewSet(viewsets.ModelViewSet):
    serializer_class = LeadSerializer
    def get_queryset(self):
        queryset = Lead.objects.filter(deleted_at__isnull=True).select_related("assigned_so")
        if not self.request.user.is_admin:
            queryset = queryset.filter(assigned_so=self.request.user)
        elif self.request.query_params.get("unassigned") == "true":
            queryset = queryset.filter(assigned_so__isnull=True)
        for field in ("source", "status", "city", "assigned_so"):
            if value := self.request.query_params.get(field):
                queryset = queryset.filter(**{field: value})
        if query := self.request.query_params.get("q"):
            queryset = queryset.filter(Q(name__icontains=query) | Q(phone__icontains=query) | Q(campaign__icontains=query) | Q(model_interest__icontains=query))
        ordering = self.request.query_params.get("ordering", "-created_at")
        return queryset.order_by(ordering if ordering.lstrip("-") in {"created_at", "enquiry_date", "status"} else "-created_at")

    def get_permissions(self):
        if self.action in {"assign", "auto_assign", "reopen", "create", "destroy"}:
            return [IsAdmin()]
        return super().get_permissions()

    @action(detail=True, methods=["post"])
    def assign(self, request, pk=None):
        lead = self.get_object()
        serializer = AssignmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        officer = serializer.validated_data["sales_officer"]
        previous = lead.assigned_so
        lead.assigned_so = officer
        lead.save(update_fields=["assigned_so", "updated_at"])
        LeadAudit.objects.create(lead=lead, actor=request.user, event="reassigned" if previous else "assigned", before={"assigned_so": previous_id if (previous_id := getattr(previous, "id", None)) else None}, after={"assigned_so": officer.id})
        Notification.objects.create(user=officer, lead=lead, kind=Notification.Kind.ASSIGNMENT, message=f"You have a new lead: {lead.name}.")
        return Response(self.get_serializer(lead).data)

    @action(detail=False, methods=["post"], url_path="auto-assign")
    def auto_assign(self, request):
        lead_ids = request.data.get("lead_ids", [])
        leads = Lead.objects.filter(deleted_at__isnull=True, assigned_so__isnull=True)
        if lead_ids:
            leads = leads.filter(id__in=lead_ids)
        leads = list(leads.order_by("created_at"))
        officers = list(User.objects.filter(role=User.Role.SALES_OFFICER, is_active=True).annotate(load=Count("assigned_leads", filter=Q(assigned_leads__deleted_at__isnull=True))).order_by("load", "id"))
        if not officers:
            return Response({"detail": "No active sales officers."}, status=status.HTTP_400_BAD_REQUEST)
        if not leads:
            return Response({"assigned": 0, "distribution": {}})
        distribution = defaultdict(int)
        with transaction.atomic():
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
        lead = self.get_object()
        if not request.user.is_admin and lead.assigned_so_id != request.user.id:
            return Response({"detail": "This lead is not assigned to you."}, status=status.HTTP_403_FORBIDDEN)
        serializer = LeadUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        next_status = serializer.validated_data["status"]
        if not request.user.is_admin and next_status not in FORWARD_TRANSITIONS.get(lead.status, set()):
            return Response({"detail": "This status transition is not allowed."}, status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            previous = lead.status
            lead.status = next_status
            lead.save(update_fields=["status", "updated_at"])
            CallLog.objects.create(lead=lead, so=request.user, status=next_status, remarks=serializer.validated_data.get("remarks", ""))
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
