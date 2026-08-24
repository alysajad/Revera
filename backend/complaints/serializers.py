from rest_framework import serializers
from django.utils import timezone

from leads.serializers import validate_configured_choice
from .models import Complaint, ComplaintNote


class ComplaintNoteSerializer(serializers.ModelSerializer):
    author_name = serializers.CharField(source="author.get_full_name", read_only=True)

    class Meta:
        model = ComplaintNote
        fields = ["id", "author_name", "content", "created_at"]
        read_only_fields = ["id", "created_at"]


class ComplaintListSerializer(serializers.ModelSerializer):
    logged_by_name = serializers.CharField(source="logged_by.get_full_name", read_only=True)
    assigned_to_name = serializers.SerializerMethodField()
    note_count = serializers.SerializerMethodField()

    def get_assigned_to_name(self, obj):
        return obj.assigned_to.get_full_name() if obj.assigned_to else ""

    def get_note_count(self, obj):
        if hasattr(obj, "_note_count"):
            return obj._note_count
        return obj.notes.count()

    class Meta:
        model = Complaint
        fields = [
            "id", "uid", "ticket_number", "customer_name", "customer_phone",
            "customer_email", "category", "priority", "status", "subject",
            "description", "model_interest", "branch", "source", "resolution_notes",
            "resolved_at", "logged_by", "logged_by_name", "assigned_to",
            "assigned_to_name", "note_count", "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "uid", "ticket_number", "logged_by", "created_at", "updated_at",
        ]


class ComplaintDetailSerializer(ComplaintListSerializer):
    notes = ComplaintNoteSerializer(many=True, read_only=True)

    class Meta(ComplaintListSerializer.Meta):
        fields = ComplaintListSerializer.Meta.fields + ["notes"]


class ComplaintCreateSerializer(serializers.ModelSerializer):
    branch = serializers.CharField(required=True, allow_blank=False, max_length=120)

    class Meta:
        model = Complaint
        fields = [
            "customer_name", "customer_phone", "customer_email",
            "category", "priority", "subject", "description",
            "model_interest", "branch", "source",
        ]

    def validate_customer_phone(self, value):
        value = (value or "").strip()
        if not value.isdigit() or len(value) != 10:
            raise serializers.ValidationError("Enter a valid 10-digit phone number.")
        return value

    def validate_customer_email(self, value):
        return (value or "").strip()

    def validate_branch(self, value):
        return validate_configured_choice(value, "branches", "branch")


class ComplaintUpdateSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=Complaint.Status.choices, required=False)
    priority = serializers.ChoiceField(choices=Complaint.Priority.choices, required=False)
    resolution_notes = serializers.CharField(required=False, allow_blank=True)
    assigned_to = serializers.IntegerField(required=False, allow_null=True)

    def validate(self, attrs):
        status = attrs.get("status")
        if status == Complaint.Status.RESOLVED and not attrs.get("resolution_notes"):
            # Check if existing complaint already has resolution notes
            complaint = self.context.get("complaint")
            if complaint and not complaint.resolution_notes:
                raise serializers.ValidationError(
                    {"resolution_notes": "Resolution notes are required when resolving a complaint."}
                )
        return attrs
