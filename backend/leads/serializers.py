from rest_framework import serializers

from accounts.models import User
from .models import CallLog, FollowUp, Lead


class LeadSerializer(serializers.ModelSerializer):
    assigned_so_name = serializers.CharField(source="assigned_so.get_full_name", read_only=True)

    class Meta:
        model = Lead
        fields = ["id", "uid", "name", "phone", "email", "source", "source_label", "campaign", "model_interest", "city", "enquiry_date", "status", "assigned_so", "assigned_so_name", "created_at", "updated_at"]
        read_only_fields = ["uid", "assigned_so", "created_at", "updated_at"]


class CallLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = CallLog
        fields = ["id", "status", "remarks", "created_at"]
        read_only_fields = ["id", "created_at"]


class LeadUpdateSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=Lead.Status.choices)
    remarks = serializers.CharField(max_length=500, required=False, allow_blank=True)
    follow_up_at = serializers.DateTimeField(required=False)

    def validate(self, attrs):
        if attrs["status"] in [Lead.Status.CALLBACK, Lead.Status.WALKIN] and not attrs.get("follow_up_at"):
            raise serializers.ValidationError({"follow_up_at": "This status requires a follow-up time."})
        return attrs


class AssignmentSerializer(serializers.Serializer):
    sales_officer_id = serializers.PrimaryKeyRelatedField(queryset=User.objects.filter(role=User.Role.SALES_OFFICER, is_active=True), source="sales_officer")


class FollowUpSerializer(serializers.ModelSerializer):
    customer = serializers.CharField(source="lead.name", read_only=True)

    class Meta:
        model = FollowUp
        fields = ["id", "lead", "customer", "scheduled_for", "resolved_at", "notified_at"]
