from django.db.models import Avg, Count, F, Q
from django.db.models.functions import TruncDate
from django.utils import timezone
from rest_framework import status as http_status
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ModelViewSet

from accounts.models import User
from .models import Complaint, ComplaintNote
from .serializers import (
    ComplaintCreateSerializer,
    ComplaintDetailSerializer,
    ComplaintListSerializer,
    ComplaintNoteSerializer,
    ComplaintUpdateSerializer,
)


class ComplaintPagination(PageNumberPagination):
    page_size = 50


class ComplaintViewSet(ModelViewSet):
    pagination_class = ComplaintPagination
    serializer_class = ComplaintListSerializer

    def get_queryset(self):
        user = self.request.user
        queryset = Complaint.objects.select_related("logged_by", "assigned_to")

        # CRE users see only their own complaints; admins see all
        if user.role == User.Role.CRE:
            queryset = queryset.filter(logged_by=user)

        # Annotate note count for list performance
        queryset = queryset.annotate(_note_count=Count("notes"))

        # Filters
        params = self.request.query_params
        if params.get("status"):
            queryset = queryset.filter(status=params["status"])
        if params.get("category"):
            queryset = queryset.filter(category=params["category"])
        if params.get("priority"):
            queryset = queryset.filter(priority=params["priority"])
        if params.get("source"):
            queryset = queryset.filter(source=params["source"])
        if params.get("date_from"):
            queryset = queryset.filter(created_at__date__gte=params["date_from"])
        if params.get("date_to"):
            queryset = queryset.filter(created_at__date__lte=params["date_to"])
        if params.get("q"):
            q = params["q"]
            queryset = queryset.filter(
                Q(customer_name__icontains=q)
                | Q(customer_phone__icontains=q)
                | Q(ticket_number__icontains=q)
                | Q(subject__icontains=q)
            )

        return queryset.order_by("-created_at")

    def get_serializer_class(self):
        if self.action == "retrieve":
            return ComplaintDetailSerializer
        if self.action == "create":
            return ComplaintCreateSerializer
        return ComplaintListSerializer

    def perform_create(self, serializer):
        serializer.save(logged_by=self.request.user, assigned_to=self.request.user)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        # Return the full list representation
        complaint = serializer.instance
        output = ComplaintListSerializer(complaint).data
        return Response(output, status=http_status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        complaint = self.get_object()
        serializer = ComplaintUpdateSerializer(
            data=request.data, context={"complaint": complaint}
        )
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        if "status" in data:
            complaint.status = data["status"]
            if data["status"] == Complaint.Status.RESOLVED and not complaint.resolved_at:
                complaint.resolved_at = timezone.now()
            elif data["status"] == Complaint.Status.CLOSED and not complaint.resolved_at:
                complaint.resolved_at = timezone.now()
        if "priority" in data:
            complaint.priority = data["priority"]
        if "resolution_notes" in data:
            complaint.resolution_notes = data["resolution_notes"]
        if "assigned_to" in data:
            if data["assigned_to"] is None:
                complaint.assigned_to = None
            else:
                try:
                    complaint.assigned_to = User.objects.get(id=data["assigned_to"], is_active=True)
                except User.DoesNotExist:
                    return Response(
                        {"assigned_to": "User not found."},
                        status=http_status.HTTP_400_BAD_REQUEST,
                    )

        complaint.save()
        output = ComplaintDetailSerializer(complaint).data
        return Response(output)

    def partial_update(self, request, *args, **kwargs):
        return self.update(request, *args, **kwargs)

    @action(detail=True, methods=["post"], url_path="add-note")
    def add_note(self, request, pk=None):
        complaint = self.get_object()
        content = request.data.get("content", "").strip()
        if not content:
            return Response(
                {"content": "Note content is required."},
                status=http_status.HTTP_400_BAD_REQUEST,
            )
        note = ComplaintNote.objects.create(
            complaint=complaint, author=request.user, content=content
        )
        return Response(ComplaintNoteSerializer(note).data, status=http_status.HTTP_201_CREATED)


class ComplaintAnalyticsView(APIView):
    def get(self, request):
        user = request.user
        queryset = Complaint.objects.all()

        # CRE users see only their own analytics; admins see all
        if user.role == User.Role.CRE:
            queryset = queryset.filter(logged_by=user)

        # Date range filter
        date_range = request.query_params.get("range", "mtd")
        today = timezone.localdate()
        if date_range == "today":
            queryset = queryset.filter(created_at__date=today)
        elif date_range == "mtd":
            queryset = queryset.filter(created_at__date__year=today.year, created_at__date__month=today.month)
        elif date_range == "week":
            from datetime import timedelta
            queryset = queryset.filter(created_at__date__gte=today - timedelta(days=7))
        elif request.query_params.get("date_from"):
            queryset = queryset.filter(created_at__date__gte=request.query_params["date_from"])
            if request.query_params.get("date_to"):
                queryset = queryset.filter(created_at__date__lte=request.query_params["date_to"])

        # Summary counts
        summary = queryset.aggregate(
            total=Count("id"),
            open=Count("id", filter=Q(status=Complaint.Status.OPEN)),
            in_progress=Count("id", filter=Q(status=Complaint.Status.IN_PROGRESS)),
            escalated=Count("id", filter=Q(status=Complaint.Status.ESCALATED)),
            resolved=Count("id", filter=Q(status=Complaint.Status.RESOLVED)),
            closed=Count("id", filter=Q(status=Complaint.Status.CLOSED)),
        )

        # Average resolution time (in hours) for resolved/closed complaints
        resolved_qs = queryset.filter(resolved_at__isnull=False)
        avg_resolution = None
        if resolved_qs.exists():
            from django.db.models import ExpressionWrapper, DurationField
            avg_duration = resolved_qs.annotate(
                duration=ExpressionWrapper(F("resolved_at") - F("created_at"), output_field=DurationField())
            ).aggregate(avg=Avg("duration"))
            if avg_duration["avg"]:
                avg_resolution = round(avg_duration["avg"].total_seconds() / 3600, 1)
        summary["avg_resolution_hours"] = avg_resolution or 0

        # Breakdown by category
        by_category = list(
            queryset.values("category")
            .annotate(count=Count("id"))
            .order_by("-count")
        )

        # Breakdown by priority
        by_priority = list(
            queryset.values("priority")
            .annotate(count=Count("id"))
            .order_by("-count")
        )

        # Breakdown by status
        by_status = list(
            queryset.values("status")
            .annotate(count=Count("id"))
            .order_by("status")
        )

        # Daily trend (last 30 days or within range)
        trend = list(
            queryset.annotate(date=TruncDate("created_at"))
            .values("date")
            .annotate(
                opened=Count("id"),
                resolved=Count("id", filter=Q(status__in=[Complaint.Status.RESOLVED, Complaint.Status.CLOSED])),
            )
            .order_by("date")
        )

        return Response({
            "summary": summary,
            "by_category": by_category,
            "by_priority": by_priority,
            "by_status": by_status,
            "trend": trend,
            "generated_at": timezone.now(),
        })
