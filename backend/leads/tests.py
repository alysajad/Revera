from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from datetime import timedelta

from accounts.models import User
from .models import CallLog, FollowUp, Lead, LeadQualification


class LeadAccessTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(email="manager@example.com", password="password-12345", role=User.Role.ADMIN)
        self.first_so = User.objects.create_user(email="first@example.com", password="password-12345", role=User.Role.SALES_OFFICER)
        self.second_so = User.objects.create_user(email="second@example.com", password="password-12345", role=User.Role.SALES_OFFICER)
        self.first_lead = Lead.objects.create(name="Aarav", phone="7305198421", assigned_so=self.first_so)
        self.second_lead = Lead.objects.create(name="Mehak", phone="9797210468", assigned_so=self.second_so)
        self.client = APIClient()

    def test_sales_officer_only_sees_assigned_leads(self):
        self.client.force_authenticate(self.first_so)
        response = self.client.get("/api/leads/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["id"], self.first_lead.id)

    def test_admin_auto_assigns_unowned_leads(self):
        unowned = Lead.objects.create(name="Danish", phone="7006682391")
        self.client.force_authenticate(self.admin)
        response = self.client.post("/api/leads/auto-assign/", {"lead_ids": [unowned.id]}, format="json")
        self.assertEqual(response.status_code, 200)
        unowned.refresh_from_db()
        self.assertIn(unowned.assigned_so, [self.first_so, self.second_so])

    def test_admin_bulk_assigns_matching_filters(self):
        meta = Lead.objects.create(name="Meta lead", phone="7006682394", source=Lead.Source.META)
        google = Lead.objects.create(name="Google lead", phone="7006682395", source=Lead.Source.OTHER, source_label="Google")
        self.client.force_authenticate(self.admin)
        response = self.client.post("/api/leads/bulk-assign/", {"sales_officer_id": self.first_so.id, "filters": {"source": Lead.Source.META}}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["assigned"], 1)
        meta.refresh_from_db()
        google.refresh_from_db()
        self.assertEqual(meta.assigned_so, self.first_so)
        self.assertIsNone(google.assigned_so)

        response = self.client.post("/api/leads/bulk-assign/", {"sales_officer_id": self.second_so.id, "filters": {"source_label": "Google"}}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["assigned"], 1)
        google.refresh_from_db()
        self.assertEqual(google.assigned_so, self.second_so)

    def test_admin_can_add_an_unassigned_lead(self):
        self.client.force_authenticate(self.admin)
        response = self.client.post("/api/leads/", {"name": "Manual lead", "phone": "7006682392", "source": Lead.Source.WEBSITE, "model_interest": "R8 Lite", "city": "Srinagar"}, format="json")
        self.assertEqual(response.status_code, 201)
        lead = Lead.objects.get(pk=response.data["id"])
        self.assertIsNone(lead.assigned_so)
        self.assertEqual(lead.status, Lead.Status.FRESH)

    def test_admin_cannot_add_a_lead_with_future_enquiry_date(self):
        self.client.force_authenticate(self.admin)
        response = self.client.post("/api/leads/", {"name": "Future lead", "phone": "7006682393", "source": Lead.Source.WEBSITE, "enquiry_date": (timezone.localdate() + timedelta(days=1)).isoformat()}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_admin_cannot_assign_a_lead_twice(self):
        self.client.force_authenticate(self.admin)
        response = self.client.post(f"/api/leads/{self.first_lead.id}/assign/", {"sales_officer_id": self.second_so.id}, format="json")
        self.assertEqual(response.status_code, 409)
        self.first_lead.refresh_from_db()
        self.assertEqual(self.first_lead.assigned_so, self.first_so)

    def test_sales_officer_cannot_move_a_lead_backward(self):
        self.first_lead.status = Lead.Status.QUALIFIED
        self.first_lead.save()
        self.client.force_authenticate(self.first_so)
        response = self.client.post(f"/api/leads/{self.first_lead.id}/log-call/", {"status": Lead.Status.RNR}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_sales_officer_cannot_skip_ahead_to_won(self):
        self.client.force_authenticate(self.first_so)
        response = self.client.post(f"/api/leads/{self.first_lead.id}/log-call/", {"status": Lead.Status.WON}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_follow_up_requires_a_future_callback_or_walkin(self):
        self.client.force_authenticate(self.first_so)
        future = timezone.now() + timedelta(days=1)
        response = self.client.post(f"/api/leads/{self.first_lead.id}/log-call/", {"status": Lead.Status.CALLBACK, "follow_up_at": future.isoformat()}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(FollowUp.objects.filter(lead=self.first_lead, scheduled_for=future).exists())

        self.first_lead.refresh_from_db()
        response = self.client.post(f"/api/leads/{self.first_lead.id}/log-call/", {"status": Lead.Status.QUALIFIED}, format="json")
        self.assertEqual(response.status_code, 200)
        response = self.client.post(f"/api/leads/{self.first_lead.id}/log-call/", {"status": Lead.Status.LOST, "follow_up_at": future.isoformat()}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertFalse(FollowUp.objects.filter(lead=self.first_lead, resolved_at__isnull=True).exists())

    def test_repeated_call_log_creates_one_log_and_follow_up(self):
        self.client.force_authenticate(self.first_so)
        future = timezone.now() + timedelta(days=1)
        payload = {"status": Lead.Status.CALLBACK, "follow_up_at": future.isoformat()}

        self.assertEqual(self.client.post(f"/api/leads/{self.first_lead.id}/log-call/", payload, format="json").status_code, 200)
        self.assertEqual(self.client.post(f"/api/leads/{self.first_lead.id}/log-call/", payload, format="json").status_code, 400)
        self.assertEqual(CallLog.objects.filter(lead=self.first_lead).count(), 1)
        self.assertEqual(FollowUp.objects.filter(lead=self.first_lead, resolved_at__isnull=True).count(), 1)

    def test_sales_dashboard_returns_personal_status_summary(self):
        self.first_lead.status = Lead.Status.QUALIFIED
        self.first_lead.category = Lead.Category.HOT
        self.first_lead.save(update_fields=["status", "category"])
        self.client.force_authenticate(self.first_so)
        response = self.client.get("/api/leads/my-dashboard/?section=qualified")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["summary"]["qualified"], 1)
        self.assertEqual(len(response.data["results"]), 1)
        self.assertEqual(response.data["results"][0]["category"], Lead.Category.HOT)

    def test_sales_officer_can_save_qualification_and_follow_up(self):
        self.client.force_authenticate(self.first_so)
        future = timezone.now() + timedelta(days=1)
        response = self.client.patch(f"/api/leads/{self.first_lead.id}/so-update/", {"status": Lead.Status.CALLBACK, "category": Lead.Category.HOT, "call_outcome": "CONNECTED", "remarks": "Customer requested a callback.", "follow_up_at": future.isoformat(), "qualification": {"variant": "R8 Pro", "buying_timeline": "1-2 months", "finance_type": "Bank finance", "trade_in": True, "test_drive": "Requested"}}, format="json")
        self.assertEqual(response.status_code, 200)
        self.first_lead.refresh_from_db()
        self.assertEqual(self.first_lead.status, Lead.Status.CALLBACK)
        self.assertEqual(self.first_lead.category, Lead.Category.HOT)
        self.assertEqual(CallLog.objects.get(lead=self.first_lead).outcome, "CONNECTED")
        self.assertTrue(FollowUp.objects.filter(lead=self.first_lead, resolved_at__isnull=True).exists())
        self.assertEqual(LeadQualification.objects.get(lead=self.first_lead).variant, "R8 Pro")

    def test_sales_officer_can_edit_customer_details(self):
        self.client.force_authenticate(self.first_so)
        response = self.client.patch(f"/api/leads/{self.first_lead.id}/so-update/", {"name": "Aarav Updated", "phone": "7305198422", "email": "aarav@example.com", "source": Lead.Source.WEBSITE, "campaign": "Summer Drive", "model_interest": "R8 Pro", "city": "Kochi", "branch": "Central", "enquiry_date": timezone.localdate().isoformat()}, format="json")
        self.assertEqual(response.status_code, 200)
        self.first_lead.refresh_from_db()
        self.assertEqual(self.first_lead.name, "Aarav Updated")
        self.assertEqual(self.first_lead.phone, "7305198422")
        self.assertEqual(self.first_lead.source, Lead.Source.WEBSITE)
        self.assertEqual(self.first_lead.branch, "Central")
        response = self.client.patch(f"/api/leads/{self.first_lead.id}/so-update/", {"enquiry_date": (timezone.localdate() + timedelta(days=1)).isoformat()}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_follow_up_submission_moves_fresh_lead_to_follow_ups(self):
        self.client.force_authenticate(self.first_so)
        future = timezone.now() + timedelta(days=2)
        response = self.client.patch(f"/api/leads/{self.first_lead.id}/so-update/", {"follow_up_at": future.isoformat()}, format="json")
        self.assertEqual(response.status_code, 200)
        self.first_lead.refresh_from_db()
        self.assertEqual(self.first_lead.status, Lead.Status.CALLBACK)
        fresh = self.client.get("/api/leads/my-dashboard/?section=fresh")
        follow_ups = self.client.get("/api/leads/my-dashboard/?section=followups")
        self.assertNotIn(self.first_lead.id, [lead["id"] for lead in fresh.data["results"]])
        self.assertIn(self.first_lead.id, [lead["id"] for lead in follow_ups.data["results"]])

    def test_sales_officer_cannot_update_another_officers_lead(self):
        self.client.force_authenticate(self.first_so)
        response = self.client.patch(f"/api/leads/{self.second_lead.id}/so-update/", {"category": Lead.Category.COLD}, format="json")
        self.assertEqual(response.status_code, 404)
