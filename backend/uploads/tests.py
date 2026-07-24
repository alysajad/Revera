from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import User
from leads.models import Lead
from .models import UploadBatch, UploadRow


class UploadDuplicateTests(TestCase):
    def test_skipping_a_duplicate_unblocks_import(self):
        admin = User.objects.create_user(email="manager@example.com", password="password-12345", role=User.Role.ADMIN)
        lead = Lead.objects.create(name="Existing", phone="7000000000")
        batch = UploadBatch.objects.create(filename="leads.csv", storage_path="imports/test.csv", uploaded_by=admin, status=UploadBatch.Status.READY, total_rows=1, parsed_ok=1, duplicates_found=1)
        row = UploadRow.objects.create(batch=batch, row_number=2, normalized_phone=lead.phone, duplicate_of=lead, resolution=UploadRow.Resolution.PENDING, data={"name": "Duplicate"})
        client = APIClient()
        client.force_authenticate(admin)

        response = client.post(f"/api/uploads/{batch.id}/resolve-duplicates/", {"rows": [{"id": row.id, "resolution": "SKIP"}]}, format="json")

        self.assertEqual(response.status_code, 200)
        row.refresh_from_db()
        batch.refresh_from_db()
        self.assertEqual(row.resolution, UploadRow.Resolution.SKIP)
        self.assertEqual(batch.duplicates_found, 0)
