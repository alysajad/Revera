from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from datetime import timedelta

from accounts.models import User
from .models import CallLog, FollowUp, Lead


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
