from rest_framework import serializers

from .models import UploadBatch, UploadRow


class UploadBatchSerializer(serializers.ModelSerializer):
    class Meta:
        model = UploadBatch
        fields = ["id", "filename", "status", "total_rows", "parsed_ok", "duplicates_found", "skipped", "error_message", "created_at", "committed_at"]


class UploadRowSerializer(serializers.ModelSerializer):
    existing_name = serializers.CharField(source="duplicate_of.name", read_only=True)
    existing_status = serializers.CharField(source="duplicate_of.status", read_only=True)

    class Meta:
        model = UploadRow
        fields = ["id", "row_number", "data", "normalized_phone", "validation_error", "duplicate_of", "existing_name", "existing_status", "resolution"]


class ResolveRowsSerializer(serializers.Serializer):
    rows = serializers.ListField(child=serializers.DictField(), allow_empty=False)

    def validate_rows(self, rows):
        valid = {choice for choice, _ in UploadRow.Resolution.choices}
        for row in rows:
            if "id" not in row or row.get("resolution") not in valid:
                raise serializers.ValidationError("Each row needs an id and valid resolution.")
        return rows
