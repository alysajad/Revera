from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import User
from .models import Lead


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

    def test_sales_officer_cannot_move_a_lead_backward(self):
        self.first_lead.status = Lead.Status.QUALIFIED
        self.first_lead.save()
        self.client.force_authenticate(self.first_so)
        response = self.client.post(f"/api/leads/{self.first_lead.id}/log-call/", {"status": Lead.Status.RNR}, format="json")
        self.assertEqual(response.status_code, 400)
