from __future__ import annotations

from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient, APITestCase

from accounts.models import UserProfile
from trails.models import Comment, Trail

User = get_user_model()


class AdminApiTests(APITestCase):
    def setUp(self):
        self.admin_user = User.objects.create_user(
            username="admin",
            email="admin@example.com",
            password="SuperSecret123",
        )
        admin_profile = self.admin_user.profile
        admin_profile.role = UserProfile.Role.ADMIN
        admin_profile.email_verified = True
        admin_profile.save(update_fields=["role", "email_verified", "updated_at"])

        self.standard_user = User.objects.create_user(
            username="regular",
            email="regular@example.com",
            password="Password123",
        )
        regular_profile = self.standard_user.profile
        regular_profile.email_verified = True
        regular_profile.save(update_fields=["email_verified", "updated_at"])

        self.admin_client = APIClient()
        self.admin_client.force_login(self.admin_user)

        self.standard_client = APIClient()
        self.standard_client.force_login(self.standard_user)

    def test_standard_user_cannot_access_admin_dashboard(self):
        url = reverse("admin-dashboard")
        response = self.standard_client.get(url)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_admin_dashboard_returns_stats(self):
        # Seed sample data
        Trail.objects.create(
            slug="coastal-walk",
            name="Coastal Walk",
            difficulty="moderate",
            approval_state="approved",
            route_path=[[{"lat": 0.0, "lng": 0.0}, {"lat": 0.01, "lng": 0.02}]],
            distance_km=1.5,
            submitted_by=self.standard_user,
        )
        Trail.objects.create(
            slug="forest-loop",
            name="Forest Loop",
            difficulty="moderate",
            approval_state="pending",
            route_path=[[{"lat": 0.0, "lng": 0.0}, {"lat": 0.1, "lng": 0.1}]],
            distance_km=5.2,
            submitted_by=self.standard_user,
        )
        Comment.objects.create(
            trail=Trail.objects.create(slug="mountain-pass", name="Mountain Pass"),
            author=self.standard_user,
            body="Great hike!",
            rating=5,
        )

        url = reverse("admin-dashboard")
        response = self.admin_client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = response.json()
        self.assertIn("stats", payload)
        self.assertGreaterEqual(payload["stats"]["total_users"], 2)
        self.assertIn("permissions", payload)
        self.assertTrue(payload["permissions"]["can_manage_users"])

    def test_admin_can_update_user_role(self):
        url = reverse("admin-user-detail", kwargs={"pk": self.standard_user.pk})
        response = self.admin_client.patch(url, {"role": UserProfile.Role.ADMIN}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.standard_user.refresh_from_db()
        self.assertEqual(self.standard_user.profile.role, UserProfile.Role.ADMIN)

    def test_admin_can_approve_trail_submission(self):
        trail = Trail.objects.create(
            slug="river-walk",
            name="River Walk",
            difficulty="easy",
            approval_state="pending",
            route_path=[[{"lat": 1.0, "lng": 1.0}, {"lat": 1.1, "lng": 1.1}]],
            distance_km=3.0,
            submitted_by=self.standard_user,
        )
        url = reverse("admin-trail-submission-approve", args=[trail.pk])
        response = self.admin_client.post(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        trail.refresh_from_db()
        self.assertEqual(trail.approval_state, "approved")

    def test_admin_can_toggle_comment_visibility(self):
        trail = Trail.objects.create(slug="hidden-falls", name="Hidden Falls")
        comment = Comment.objects.create(
            trail=trail,
            author=self.standard_user,
            body="Needs maintenance.",
            rating=3,
        )
        url = reverse("admin-comment-detail", args=[comment.pk])
        response = self.admin_client.patch(url, {"is_deleted": True}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        comment.refresh_from_db()
        self.assertTrue(comment.is_deleted)
