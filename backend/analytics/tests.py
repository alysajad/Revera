from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import User
from leads.models import CallLog, Lead


class SalesManagerAnalyticsTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(email="admin@example.com", password="password-12345", role=User.Role.ADMIN)
        self.manager = User.objects.create_user(email="manager@example.com", password="password-12345", role=User.Role.SALES_MANAGER, location="Mount Road")
        self.other_manager = User.objects.create_user(email="other-manager@example.com", password="password-12345", role=User.Role.SALES_MANAGER, location="Other")
        self.cre = User.objects.create_user(email="cre@example.com", password="password-12345", role=User.Role.CRE, first_name="Asha")
        self.ps = User.objects.create_user(email="ps@example.com", password="password-12345", role=User.Role.SALES_OFFICER, first_name="Ravi", location="Mount Road")
        today = timezone.localdate()
        self.branch_lead = Lead.objects.create(name="Branch lead", phone="9000000001", branch="Mount Road", enquiry_date=today, assigned_so=self.cre, status=Lead.Status.QUALIFIED, assigned_ps=self.ps)
        self.retailed = Lead.objects.create(name="Retailed lead", phone="9000000002", branch="Mount Road", enquiry_date=today, assigned_so=self.cre, assigned_ps=self.ps, status=Lead.Status.WON, sales_outcome=Lead.SalesOutcome.RETAILED)
        self.other_branch_lead = Lead.objects.create(name="Other lead", phone="9000000003", branch="Other", enquiry_date=today, status=Lead.Status.WON, sales_outcome=Lead.SalesOutcome.RETAILED)
        CallLog.objects.create(lead=self.retailed, so=self.ps, status=Lead.Status.WON, outcome="Retail Done")

    def test_sales_manager_analytics_are_scoped_to_manager_branch(self):
        self.client.force_authenticate(self.manager)

        response = self.client.get("/api/analytics/sales-manager/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["branch"], "Mount Road")
        self.assertEqual(response.data["summary"]["total"], 2)
        self.assertEqual(response.data["summary"]["retailed"], 1)
        self.assertEqual(response.data["summary"]["lead_to_retail_rate"], 50.0)
        self.assertIn("untouched", response.data["summary"]["delta"])
        self.assertNotIn("Other", {row["model"] for row in response.data["models"]})

        today = self.client.get("/api/analytics/sales-manager/?range=today")
        self.assertEqual(today.data["summary"]["delta"], {})

    def test_sales_manager_leads_are_scoped_and_read_only(self):
        self.client.force_authenticate(self.manager)

        response = self.client.get("/api/leads/manager-leads/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual({lead["id"] for lead in response.data["results"]}, {self.branch_lead.id, self.retailed.id})

        retailed = self.client.get("/api/leads/manager-leads/?sales_outcome=RETAILED")
        self.assertEqual({lead["id"] for lead in retailed.data["results"]}, {self.retailed.id})

        detail = self.client.get(f"/api/leads/{self.other_branch_lead.id}/")
        self.assertEqual(detail.status_code, 404)

        edit = self.client.patch(f"/api/leads/{self.branch_lead.id}/", {"name": "Changed"}, format="json")
        self.assertEqual(edit.status_code, 403)
        self.branch_lead.refresh_from_db()
        self.assertEqual(self.branch_lead.name, "Branch lead")

    def test_non_manager_cannot_use_sales_manager_analytics(self):
        self.client.force_authenticate(self.admin)

        response = self.client.get("/api/analytics/sales-manager/")

        self.assertEqual(response.status_code, 403)
