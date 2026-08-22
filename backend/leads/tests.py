from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from datetime import timedelta

from accounts.models import User
from .models import CallLog, FollowUp, Lead, LeadAudit, LeadQualification


class LeadAccessTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(email="manager@example.com", password="password-12345", role=User.Role.ADMIN)
        self.first_so = User.objects.create_user(email="first@example.com", password="password-12345", role=User.Role.CRE)
        self.second_so = User.objects.create_user(email="second@example.com", password="password-12345", role=User.Role.CRE)
        self.ps_so = User.objects.create_user(email="ps@example.com", password="password-12345", role=User.Role.SALES_OFFICER)
        self.ps_so.location = "Kochi"
        self.ps_so.save(update_fields=["location"])
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
        self.assertEqual(unowned.assigned_so.role, User.Role.CRE)

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

    def test_admin_distributes_filtered_bucket_across_selected_cres(self):
        meta_leads = [Lead.objects.create(name=f"Meta {index}", phone=f"70066824{index:02d}", source=Lead.Source.META) for index in range(5)]
        google = Lead.objects.create(name="Google bucket", phone="7006682500", source=Lead.Source.OTHER, source_label="Google")
        assigned_meta = Lead.objects.create(name="Assigned Meta", phone="7006682501", source=Lead.Source.META, assigned_so=self.first_so)
        self.client.force_authenticate(self.admin)

        response = self.client.post("/api/leads/bulk-distribute/", {"sales_officer_ids": [self.first_so.id, self.second_so.id], "filters": {"source": Lead.Source.META}}, format="json")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["assigned"], 5)
        self.assertEqual(response.data["distribution"][0]["assigned"], 3)
        self.assertEqual(response.data["distribution"][1]["assigned"], 2)
        self.assertEqual(Lead.objects.filter(id__in=[lead.id for lead in meta_leads], assigned_so=self.first_so).count(), 3)
        self.assertEqual(Lead.objects.filter(id__in=[lead.id for lead in meta_leads], assigned_so=self.second_so).count(), 2)
        google.refresh_from_db()
        assigned_meta.refresh_from_db()
        self.assertIsNone(google.assigned_so)
        self.assertEqual(assigned_meta.assigned_so, self.first_so)
        self.assertEqual(LeadAudit.objects.filter(lead__in=meta_leads, event="bucket_assigned_cre").count(), 5)

    def test_admin_distribute_requires_active_cre_selection(self):
        self.client.force_authenticate(self.admin)
        response = self.client.post("/api/leads/bulk-distribute/", {"sales_officer_ids": [], "filters": {}}, format="json")
        self.assertEqual(response.status_code, 400)

        response = self.client.post("/api/leads/bulk-distribute/", {"sales_officer_ids": [self.ps_so.id], "filters": {}}, format="json")
        self.assertEqual(response.status_code, 400)

        self.second_so.is_active = False
        self.second_so.save(update_fields=["is_active"])
        response = self.client.post("/api/leads/bulk-distribute/", {"sales_officer_ids": [self.second_so.id], "filters": {}}, format="json")
        self.assertEqual(response.status_code, 400)

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
        self.assertEqual(set(response.data["results"][0]), {"id", "status", "name", "phone", "source", "flagged_to_manager"})
        self.assertEqual(response.data["results"][0]["status"], Lead.Status.QUALIFIED)

    def test_cre_all_dashboard_includes_handed_off_own_leads(self):
        self.first_lead.status = Lead.Status.QUALIFIED
        self.first_lead.assigned_ps = self.ps_so
        self.first_lead.save(update_fields=["status", "assigned_ps"])
        self.client.force_authenticate(self.first_so)

        response = self.client.get("/api/leads/my-dashboard/?section=all")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["summary"]["total"], 1)
        self.assertEqual(response.data["summary"]["qualified"], 1)
        self.assertEqual([lead["id"] for lead in response.data["results"]], [self.first_lead.id])

    def test_cre_can_update_handed_off_lead_after_ps_call(self):
        self.first_lead.status = Lead.Status.PENDING
        self.first_lead.assigned_ps = self.ps_so
        self.first_lead.save(update_fields=["status", "assigned_ps"])
        CallLog.objects.create(lead=self.first_lead, so=self.ps_so, status=Lead.Status.PENDING, outcome="Need Test Drive", remarks="PS scheduled a test drive.")
        self.client.force_authenticate(self.first_so)
        future = timezone.now() + timedelta(days=1)

        response = self.client.patch(f"/api/leads/{self.first_lead.id}/so-update/", {"call_outcome": "PENDING", "status": Lead.Status.PENDING, "remarks": "CRE helped the customer.", "follow_up_at": future.isoformat()}, format="json")

        self.assertEqual(response.status_code, 200)
        self.assertEqual([call["outcome"] for call in response.data["call_history"]], ["PENDING", "Need Test Drive"])
        self.assertTrue(FollowUp.objects.filter(lead=self.first_lead, so=self.first_so, scheduled_for=future, resolved_at__isnull=True).exists())

    def test_fresh_dashboard_subfilters_return_matching_rows(self):
        called = Lead.objects.create(name="Called", phone="7305198422", assigned_so=self.first_so, status=Lead.Status.QUALIFIED)
        scheduled = Lead.objects.create(name="Scheduled", phone="7305198423", assigned_so=self.first_so, status=Lead.Status.PENDING)
        FollowUp.objects.create(lead=scheduled, so=self.first_so, scheduled_for=timezone.now() + timedelta(days=1))
        self.client.force_authenticate(self.first_so)

        response = self.client.get("/api/leads/my-dashboard/?section=fresh&subfilter=untouched")
        self.assertEqual([lead["id"] for lead in response.data["results"]], [self.first_lead.id])

        response = self.client.get("/api/leads/my-dashboard/?section=fresh&subfilter=called")
        self.assertEqual({lead["id"] for lead in response.data["results"]}, {called.id, scheduled.id})

        response = self.client.get("/api/leads/my-dashboard/?section=fresh&subfilter=scheduled")
        self.assertEqual([lead["id"] for lead in response.data["results"]], [scheduled.id])

    def test_sales_officer_can_save_qualification_from_qualified_outcome(self):
        self.client.force_authenticate(self.first_so)
        response = self.client.patch(f"/api/leads/{self.first_lead.id}/so-update/", {"category": Lead.Category.HOT, "call_outcome": "QUALIFIED", "city": "Kochi", "ps_officer_id": self.ps_so.id, "remarks": "Customer is qualified.", "qualification": {"variant": "R8 Pro", "buying_timeline": "1-2 months", "finance_type": "Bank finance", "trade_in": True, "test_drive": "Requested"}}, format="json")
        self.assertEqual(response.status_code, 200)
        self.first_lead.refresh_from_db()
        self.assertEqual(self.first_lead.status, Lead.Status.QUALIFIED)
        self.assertEqual(self.first_lead.assigned_ps, self.ps_so)
        self.assertEqual(self.first_lead.category, Lead.Category.HOT)
        self.assertEqual(CallLog.objects.get(lead=self.first_lead).outcome, "QUALIFIED")
        self.assertFalse(FollowUp.objects.filter(lead=self.first_lead, resolved_at__isnull=True).exists())
        self.assertEqual(LeadQualification.objects.get(lead=self.first_lead).variant, "R8 Pro")

    def test_cre_sees_ps_options_for_customer_location(self):
        other_ps = User.objects.create_user(email="north@example.com", password="password-12345", role=User.Role.SALES_OFFICER, location="Kannur")
        self.client.force_authenticate(self.first_so)

        response = self.client.get("/api/auth/sales-officers/?location=Kochi")

        self.assertEqual(response.status_code, 200)
        ids = [officer["id"] for officer in response.data["results"]]
        self.assertIn(self.ps_so.id, ids)
        self.assertNotIn(other_ps.id, ids)

    def test_cre_must_choose_matching_ps_for_qualified_lead(self):
        other_ps = User.objects.create_user(email="north@example.com", password="password-12345", role=User.Role.SALES_OFFICER, location="Kannur")
        self.client.force_authenticate(self.first_so)

        missing = self.client.patch(f"/api/leads/{self.first_lead.id}/so-update/", {"call_outcome": "QUALIFIED", "city": "Kochi"}, format="json")
        mismatch = self.client.patch(f"/api/leads/{self.first_lead.id}/so-update/", {"call_outcome": "QUALIFIED", "city": "Kochi", "ps_officer_id": other_ps.id}, format="json")

        self.assertEqual(missing.status_code, 400)
        self.assertEqual(mismatch.status_code, 400)

    def test_call_outcome_only_allows_matching_lead_statuses(self):
        self.client.force_authenticate(self.first_so)
        response = self.client.patch(f"/api/leads/{self.first_lead.id}/so-update/", {"call_outcome": "CONNECTED", "status": Lead.Status.RNR}, format="json")
        self.assertEqual(response.status_code, 400)

        future = timezone.now() + timedelta(days=1)
        response = self.client.patch(f"/api/leads/{self.first_lead.id}/so-update/", {"call_outcome": "PENDING", "status": Lead.Status.QUALIFIED, "follow_up_at": future.isoformat()}, format="json")
        self.assertEqual(response.status_code, 400)

        response = self.client.patch(f"/api/leads/{self.first_lead.id}/so-update/", {"call_outcome": "PENDING", "status": Lead.Status.PENDING, "follow_up_at": future.isoformat()}, format="json")
        self.assertEqual(response.status_code, 200)
        self.first_lead.refresh_from_db()
        self.assertEqual(self.first_lead.status, Lead.Status.PENDING)

    def test_pending_call_outcome_moves_lead_to_pending(self):
        self.client.force_authenticate(self.first_so)
        future = timezone.now() + timedelta(days=1)
        response = self.client.patch(f"/api/leads/{self.first_lead.id}/so-update/", {"call_outcome": "PENDING", "follow_up_at": future.isoformat()}, format="json")
        self.assertEqual(response.status_code, 200)
        self.first_lead.refresh_from_db()
        self.assertEqual(self.first_lead.status, Lead.Status.PENDING)
        self.assertTrue(FollowUp.objects.filter(lead=self.first_lead, resolved_at__isnull=True).exists())

    def test_assigned_ps_can_schedule_next_day_follow_up(self):
        self.first_lead.status = Lead.Status.QUALIFIED
        self.first_lead.assigned_ps = self.ps_so
        self.first_lead.save(update_fields=["status", "assigned_ps"])
        self.client.force_authenticate(self.ps_so)
        future = timezone.now() + timedelta(days=1)

        response = self.client.patch(f"/api/leads/{self.first_lead.id}/so-update/", {
            "call_status": "Connected",
            "call_outcome": "Need Test Drive",
            "status": Lead.Status.PENDING,
            "sales_outcome": Lead.SalesOutcome.PENDING,
            "remarks": "Customer asked for a test drive tomorrow.",
            "follow_up_at": future.isoformat(),
        }, format="json")

        self.assertEqual(response.status_code, 200)
        self.first_lead.refresh_from_db()
        self.assertEqual(self.first_lead.status, Lead.Status.PENDING)
        self.assertTrue(FollowUp.objects.filter(lead=self.first_lead, so=self.ps_so, scheduled_for=future, resolved_at__isnull=True).exists())
        self.assertEqual(CallLog.objects.get(lead=self.first_lead).outcome, "Need Test Drive")

    def test_direct_qualified_and_lost_outcomes_set_matching_statuses(self):
        self.client.force_authenticate(self.first_so)
        response = self.client.patch(f"/api/leads/{self.first_lead.id}/so-update/", {"call_outcome": "QUALIFIED", "status": Lead.Status.QUALIFIED, "city": "Kochi", "ps_officer_id": self.ps_so.id, "qualification": {"variant": "R8 Pro"}}, format="json")
        self.assertEqual(response.status_code, 200)
        self.first_lead.refresh_from_db()
        self.assertEqual(self.first_lead.status, Lead.Status.QUALIFIED)

        self.client.force_authenticate(self.ps_so)
        response = self.client.patch(f"/api/leads/{self.first_lead.id}/so-update/", {"call_outcome": "LOST", "status": Lead.Status.LOST}, format="json")
        self.assertEqual(response.status_code, 200)
        self.first_lead.refresh_from_db()
        self.assertEqual(self.first_lead.status, Lead.Status.LOST)

    def test_call_outcome_rejects_incompatible_follow_up(self):
        self.client.force_authenticate(self.first_so)
        future = timezone.now() + timedelta(days=1)
        response = self.client.patch(f"/api/leads/{self.first_lead.id}/so-update/", {"call_outcome": "QUALIFIED", "follow_up_at": future.isoformat()}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_follow_up_status_requires_a_date_and_other_statuses_cannot_keep_one(self):
        self.client.force_authenticate(self.first_so)
        response = self.client.patch(f"/api/leads/{self.first_lead.id}/so-update/", {"status": Lead.Status.CALLBACK}, format="json")
        self.assertEqual(response.status_code, 400)

        future = timezone.now() + timedelta(days=1)
        response = self.client.patch(f"/api/leads/{self.first_lead.id}/so-update/", {"status": Lead.Status.QUALIFIED, "follow_up_at": future.isoformat()}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_sales_officer_can_edit_customer_details(self):
        self.client.force_authenticate(self.first_so)
        response = self.client.patch(f"/api/leads/{self.first_lead.id}/so-update/", {"name": "Aarav Updated", "phone": "7305198422", "email": "aarav@example.com", "source": Lead.Source.WEBSITE, "campaign": "Summer Drive", "model_interest": "R8 Pro", "city": "Kochi", "branch": "Central", "enquiry_date": timezone.localdate().isoformat()}, format="json")
        self.assertEqual(response.status_code, 200)
        self.first_lead.refresh_from_db()
        self.assertEqual(self.first_lead.name, "Aarav Updated")
        self.assertEqual(self.first_lead.phone, "7305198422")
        self.assertEqual(self.first_lead.source, Lead.Source.WEBSITE)
        self.assertEqual(self.first_lead.branch, "Central")
        self.client.force_authenticate(self.admin)
        admin_view = self.client.get(f"/api/leads/?assigned_so={self.first_so.id}")
        self.assertEqual(admin_view.status_code, 200)
        self.assertEqual(admin_view.data["results"][0]["name"], "Aarav Updated")
        self.assertEqual(admin_view.data["results"][0]["branch"], "Central")
        self.client.force_authenticate(self.first_so)
        response = self.client.patch(f"/api/leads/{self.first_lead.id}/so-update/", {"enquiry_date": (timezone.localdate() + timedelta(days=1)).isoformat()}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_admin_can_update_any_lead_outcome(self):
        self.client.force_authenticate(self.admin)
        response = self.client.patch(f"/api/leads/{self.first_lead.id}/so-update/", {"status": Lead.Status.WON, "sales_outcome": Lead.SalesOutcome.RETAILED, "remarks": "Sale confirmed."}, format="json")
        self.assertEqual(response.status_code, 200)
        self.first_lead.refresh_from_db()
        self.assertEqual(self.first_lead.status, Lead.Status.WON)
        self.assertEqual(self.first_lead.sales_outcome, Lead.SalesOutcome.RETAILED)

    def test_admin_analytics_counts_calls_made_today(self):
        CallLog.objects.create(lead=self.first_lead, so=self.first_so, status=Lead.Status.RNR)
        yesterday = CallLog.objects.create(lead=self.second_lead, so=self.second_so, status=Lead.Status.RNR)
        CallLog.objects.filter(pk=yesterday.pk).update(created_at=timezone.now() - timedelta(days=1))

        self.client.force_authenticate(self.admin)
        response = self.client.get("/api/analytics/admin/")

        self.assertEqual(response.status_code, 200)
        first_officer = next(item for item in response.data["cre"] if item["id"] == self.first_so.id)
        second_officer = next(item for item in response.data["cre"] if item["id"] == self.second_so.id)
        self.assertEqual(first_officer["calls_today"], 1)
        self.assertEqual(second_officer["calls_today"], 0)

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

    def test_admin_assigns_qualified_lead_to_ps_so(self):
        self.first_lead.status = Lead.Status.QUALIFIED
        self.first_lead.save(update_fields=["status"])
        self.client.force_authenticate(self.admin)

        response = self.client.post(f"/api/leads/{self.first_lead.id}/assign-ps/", {"sales_officer_id": self.ps_so.id}, format="json")

        self.assertEqual(response.status_code, 200)
        self.first_lead.refresh_from_db()
        self.assertEqual(self.first_lead.assigned_ps, self.ps_so)

    def test_cre_keeps_update_access_after_ps_handoff(self):
        self.first_lead.status = Lead.Status.QUALIFIED
        self.first_lead.assigned_ps = self.ps_so
        self.first_lead.save(update_fields=["status", "assigned_ps"])
        self.client.force_authenticate(self.first_so)

        detail = self.client.get(f"/api/leads/{self.first_lead.id}/")
        dashboard = self.client.get("/api/leads/my-dashboard/?section=qualified")
        update = self.client.patch(f"/api/leads/{self.first_lead.id}/so-update/", {"category": Lead.Category.COLD}, format="json")
        log_call = self.client.post(f"/api/leads/{self.first_lead.id}/log-call/", {"status": Lead.Status.WALKIN, "follow_up_at": (timezone.now() + timedelta(days=1)).isoformat()}, format="json")

        self.assertEqual(detail.status_code, 200)
        self.assertIn(self.first_lead.id, [lead["id"] for lead in dashboard.data["results"]])
        self.assertEqual(update.status_code, 200)
        self.assertEqual(log_call.status_code, 200)

    def test_ps_so_sees_assigned_qualified_lead_with_cre_qualification(self):
        LeadQualification.objects.create(lead=self.first_lead, variant="R8 Pro", buying_timeline="Immediate", finance_type="Inhouse", notes="Ready")
        self.first_lead.status = Lead.Status.QUALIFIED
        self.first_lead.assigned_ps = self.ps_so
        self.first_lead.save(update_fields=["status", "assigned_ps"])
        self.client.force_authenticate(self.ps_so)

        response = self.client.get("/api/leads/")
        detail = self.client.get(f"/api/leads/{self.first_lead.id}/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual([lead["id"] for lead in response.data["results"]], [self.first_lead.id])
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.data["qualification"]["variant"], "R8 Pro")

    def test_ps_so_can_retail_but_not_edit_cre_qualification(self):
        self.first_lead.status = Lead.Status.QUALIFIED
        self.first_lead.assigned_ps = self.ps_so
        self.first_lead.save(update_fields=["status", "assigned_ps"])
        self.client.force_authenticate(self.ps_so)

        response = self.client.patch(f"/api/leads/{self.first_lead.id}/so-update/", {"status": Lead.Status.WON, "sales_outcome": Lead.SalesOutcome.RETAILED, "remarks": "Sale done."}, format="json")
        self.assertEqual(response.status_code, 200)
        self.first_lead.refresh_from_db()
        self.assertEqual(self.first_lead.status, Lead.Status.WON)

        response = self.client.patch(f"/api/leads/{self.first_lead.id}/so-update/", {"qualification": {"variant": "R9 Plus"}}, format="json")
        self.assertEqual(response.status_code, 403)
