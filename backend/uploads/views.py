from pathlib import Path

from django.db import transaction
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import JSONParser, MultiPartParser
from rest_framework.response import Response

from accounts.permissions import IsAdmin
from leads.models import Lead, LeadAudit
from .models import UploadBatch, UploadRow
from .serializers import ResolveRowsSerializer, UploadBatchSerializer, UploadRowSerializer
from .storage import upload_bytes
from .tasks import parse_upload_batch


class UploadBatchViewSet(viewsets.GenericViewSet):
    permission_classes = [IsAdmin]
    serializer_class = UploadBatchSerializer
    parser_classes = [MultiPartParser, JSONParser]

    def get_queryset(self):
        return UploadBatch.objects.order_by("-created_at")

    def create(self, request):
        uploaded = request.FILES.get("file")
        if not uploaded:
            return Response({"detail": "A file is required."}, status=status.HTTP_400_BAD_REQUEST)
        if uploaded.size > 10 * 1024 * 1024 or Path(uploaded.name).suffix.lower() not in {".csv", ".xlsx"}:
            return Response({"detail": "Upload a CSV or XLSX file below 10 MB."}, status=status.HTTP_400_BAD_REQUEST)
        path = f"imports/{timezone.now():%Y/%m}/{timezone.now().timestamp()}-{uploaded.name}"
        upload_bytes(path, uploaded.read(), uploaded.content_type or "application/octet-stream")
        batch = UploadBatch.objects.create(filename=uploaded.name, storage_path=path, uploaded_by=request.user)
        parse_upload_batch.delay(batch.id)
        return Response(self.get_serializer(batch).data, status=status.HTTP_202_ACCEPTED)

    def retrieve(self, request, pk=None):
        batch = self.get_object()
        payload = self.get_serializer(batch).data
        payload["rows"] = UploadRowSerializer(batch.rows.all().order_by("row_number"), many=True).data
        return Response(payload)

    @action(detail=True, methods=["post"], url_path="resolve-duplicates")
    def resolve_duplicates(self, request, pk=None):
        batch = self.get_object()
        if batch.status != UploadBatch.Status.READY:
            return Response({"detail": "This upload is not ready for review."}, status=status.HTTP_400_BAD_REQUEST)
        serializer = ResolveRowsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        rows = {row.id: row for row in batch.rows.all()}
        for item in serializer.validated_data["rows"]:
            if row := rows.get(item["id"]):
                row.resolution = item["resolution"]
                row.save(update_fields=["resolution"])
        batch.duplicates_found = batch.rows.filter(duplicate_of__isnull=False, resolution=UploadRow.Resolution.PENDING).count()
        batch.save(update_fields=["duplicates_found"])
        return Response({"detail": "Duplicate choices saved.", "duplicates_found": batch.duplicates_found})

    @action(detail=True, methods=["post"])
    def commit(self, request, pk=None):
        batch = self.get_object()
        if batch.status != UploadBatch.Status.READY:
            return Response({"detail": "This upload is not ready to commit."}, status=status.HTTP_400_BAD_REQUEST)
        rows = batch.rows.select_related("duplicate_of").all()
        if rows.filter(resolution=UploadRow.Resolution.PENDING).exists():
            return Response({"detail": "Resolve every duplicate before committing."}, status=status.HTTP_400_BAD_REQUEST)
        created = 0
        overwritten = 0
        with transaction.atomic():
            for row in rows:
                if row.validation_error or row.resolution == UploadRow.Resolution.SKIP:
                    continue
                data = row.data.copy()
                data["enquiry_date"] = data.get("enquiry_date") or None
                if row.duplicate_of and row.resolution == UploadRow.Resolution.OVERWRITE:
                    for field in ("name", "email", "source", "source_label", "campaign", "model_interest", "city", "enquiry_date"):
                        setattr(row.duplicate_of, field, data.get(field, ""))
                    row.duplicate_of.save()
                    LeadAudit.objects.create(lead=row.duplicate_of, actor=request.user, event="import_overwrite")
                    overwritten += 1
                else:
                    lead = Lead.objects.create(phone=row.normalized_phone, duplicate_flag=bool(row.duplicate_of), **data)
                    LeadAudit.objects.create(lead=lead, actor=request.user, event="imported")
                    created += 1
            batch.status = UploadBatch.Status.COMMITTED
            batch.committed_at = timezone.now()
            batch.save(update_fields=["status", "committed_at"])
        return Response({"created": created, "overwritten": overwritten, "skipped": batch.skipped})
