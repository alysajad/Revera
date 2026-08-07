from rest_framework import serializers
from django.utils import timezone

from accounts.models import User
from .models import CallLog, FollowUp, Lead, LeadAudit, LeadQualification

CALL_OUTCOME_STATUS_OPTIONS = {
    "PENDING": {Lead.Status.PENDING},
    "QUALIFIED": {Lead.Status.QUALIFIED},
    "LOST": {Lead.Status.LOST},
    "RNR": {Lead.Status.RNR},
    "SWITCHED_OFF": {Lead.Status.SWITCHED_OFF},
    "CALLBACK": {Lead.Status.CALLBACK},
}


class LeadSerializer(serializers.ModelSerializer):
    assigned_so_name = serializers.CharField(source="assigned_so.get_full_name", read_only=True)
    assigned_ps_name = serializers.CharField(source="assigned_ps.get_full_name", read_only=True)
    next_follow_up = serializers.SerializerMethodField()
    call_count = serializers.SerializerMethodField()
    qualification = serializers.SerializerMethodField()

    def get_next_follow_up(self, obj):
        follow_ups = getattr(obj, "_open_followups", None)
        if follow_ups is None:
            follow_ups = obj.follow_ups.filter(resolved_at__isnull=True).order_by("scheduled_for")[:1]
        return follow_ups[0].scheduled_for if follow_ups else None

    def get_call_count(self, obj):
        return getattr(obj, "_call_count", None) if hasattr(obj, "_call_count") else obj.call_logs.count()

    def get_qualification(self, obj):
        qualification = getattr(obj, "qualification", None)
        return QualificationSerializer(qualification).data if qualification else None

    def validate_enquiry_date(self, value):
        if value and value > timezone.localdate():
            raise serializers.ValidationError("Enquiry date cannot be in the future.")
        return value

    class Meta:
        model = Lead
        fields = ["id", "uid", "name", "phone", "email", "source", "source_label", "campaign", "model_interest", "city", "branch", "enquiry_date", "status", "category", "sales_outcome", "assigned_so", "assigned_so_name", "assigned_ps", "assigned_ps_name", "next_follow_up", "call_count", "qualification", "created_at", "updated_at"]
        read_only_fields = ["uid", "assigned_so", "assigned_ps", "created_at", "updated_at"]


class SOLeadListSerializer(serializers.ModelSerializer):
    class Meta:
        model = Lead
        fields = ["id", "status", "name", "phone", "source"]


class QualificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = LeadQualification
        fields = ["variant", "buying_timeline", "finance_type", "trade_in", "test_drive", "notes", "updated_at"]
        read_only_fields = ["updated_at"]


class LeadDetailSerializer(LeadSerializer):
    call_history = serializers.SerializerMethodField()
    follow_up_history = serializers.SerializerMethodField()
    audit_history = serializers.SerializerMethodField()

    def get_call_history(self, obj):
        return CallLogSerializer(obj.call_logs.select_related("so").order_by("-created_at"), many=True).data

    def get_follow_up_history(self, obj):
        return FollowUpSerializer(obj.follow_ups.select_related("so").order_by("-scheduled_for"), many=True).data

    def get_audit_history(self, obj):
        return [{"event": event.event, "before": event.before, "after": event.after, "actor": event.actor.get_full_name() if event.actor else "System", "created_at": event.created_at} for event in obj.audit_events.select_related("actor").order_by("-created_at")[:30]]

    class Meta(LeadSerializer.Meta):
        fields = LeadSerializer.Meta.fields + ["call_history", "follow_up_history", "audit_history"]


class CallLogSerializer(serializers.ModelSerializer):
    so_name = serializers.CharField(source="so.get_full_name", read_only=True)

    class Meta:
        model = CallLog
        fields = ["id", "status", "outcome", "remarks", "so_name", "created_at"]
        read_only_fields = ["id", "created_at"]


class LeadUpdateSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=Lead.Status.choices)
    remarks = serializers.CharField(max_length=500, required=False, allow_blank=True)
    call_outcome = serializers.CharField(max_length=30, required=False, allow_blank=True)
    follow_up_at = serializers.DateTimeField(required=False)

    def validate(self, attrs):
        follow_up_at = attrs.get("follow_up_at")
        if attrs["status"] in [Lead.Status.CALLBACK, Lead.Status.WALKIN] and not follow_up_at:
            raise serializers.ValidationError({"follow_up_at": "This status requires a follow-up time."})
        if attrs["status"] not in [Lead.Status.CALLBACK, Lead.Status.WALKIN] and follow_up_at:
            raise serializers.ValidationError({"follow_up_at": "Only callbacks and walk-ins can have an appointment."})
        if follow_up_at and follow_up_at <= timezone.now():
            raise serializers.ValidationError({"follow_up_at": "Choose a future appointment time."})
        return attrs


class SOLeadUpdateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=160, required=False)
    phone = serializers.RegexField(regex=r"^\d{10}$", required=False)
    email = serializers.EmailField(required=False, allow_blank=True)
    source = serializers.ChoiceField(choices=Lead.Source.choices, required=False)
    source_label = serializers.CharField(max_length=100, required=False, allow_blank=True)
    campaign = serializers.CharField(max_length=160, required=False, allow_blank=True)
    model_interest = serializers.CharField(max_length=100, required=False, allow_blank=True)
    city = serializers.CharField(max_length=100, required=False, allow_blank=True)
    status = serializers.ChoiceField(choices=Lead.Status.choices, required=False, allow_blank=True)
    category = serializers.ChoiceField(choices=Lead.Category.choices, required=False)
    sales_outcome = serializers.ChoiceField(choices=Lead.SalesOutcome.choices, required=False)
    branch = serializers.CharField(max_length=120, required=False, allow_blank=True)
    enquiry_date = serializers.DateField(required=False, allow_null=True)
    remarks = serializers.CharField(max_length=500, required=False, allow_blank=True)
    call_outcome = serializers.ChoiceField(choices=[("QUALIFIED", "Qualified"), ("LOST", "Lost"), ("PENDING", "Pending"), ("RNR", "RNR"), ("SWITCHED_OFF", "Switched off"), ("CALLBACK", "Callback")], required=False, allow_blank=True)
    follow_up_at = serializers.DateTimeField(required=False, allow_null=True)
    qualification = QualificationSerializer(required=False)
    ps_officer_id = serializers.PrimaryKeyRelatedField(queryset=User.objects.filter(role=User.Role.SALES_OFFICER, is_active=True), source="ps_officer", required=False)

    def validate(self, attrs):
        enquiry_date = attrs.get("enquiry_date")
        if enquiry_date and enquiry_date > timezone.localdate():
            raise serializers.ValidationError({"enquiry_date": "Enquiry date cannot be in the future."})
        next_status = attrs.get("status") or {"PENDING": Lead.Status.PENDING, "QUALIFIED": Lead.Status.QUALIFIED, "LOST": Lead.Status.LOST, "RNR": Lead.Status.RNR, "SWITCHED_OFF": Lead.Status.SWITCHED_OFF, "CALLBACK": Lead.Status.CALLBACK}.get(attrs.get("call_outcome"))
        follow_up_at = attrs.get("follow_up_at")
        call_outcome = attrs.get("call_outcome")
        if call_outcome in CALL_OUTCOME_STATUS_OPTIONS:
            if next_status not in CALL_OUTCOME_STATUS_OPTIONS[call_outcome]:
                raise serializers.ValidationError({"status": "Choose a lead status that matches the call outcome."})
        if follow_up_at and follow_up_at <= timezone.now():
            raise serializers.ValidationError({"follow_up_at": "Choose a future appointment time."})
        if next_status in [Lead.Status.CALLBACK, Lead.Status.PENDING, Lead.Status.WALKIN] and not follow_up_at:
            raise serializers.ValidationError({"follow_up_at": "This status requires a follow-up time."})
        if follow_up_at and next_status not in [None, Lead.Status.FRESH, Lead.Status.RNR, Lead.Status.CALLBACK, Lead.Status.PENDING, Lead.Status.WALKIN]:
            raise serializers.ValidationError({"follow_up_at": "Only callbacks and walk-ins can have an appointment."})
        return attrs


class AssignmentSerializer(serializers.Serializer):
    sales_officer_id = serializers.PrimaryKeyRelatedField(queryset=User.objects.filter(role=User.Role.CRE, is_active=True), source="sales_officer")


class PSAssignmentSerializer(serializers.Serializer):
    sales_officer_id = serializers.PrimaryKeyRelatedField(queryset=User.objects.filter(role=User.Role.SALES_OFFICER, is_active=True), source="sales_officer")


class FollowUpSerializer(serializers.ModelSerializer):
    customer = serializers.CharField(source="lead.name", read_only=True)

    class Meta:
        model = FollowUp
        fields = ["id", "lead", "customer", "scheduled_for", "resolved_at", "notified_at"]
