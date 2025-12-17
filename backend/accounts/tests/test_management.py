from __future__ import annotations

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase

from accounts.models import UserProfile

User = get_user_model()


class BootstrapAdminCommandTests(TestCase):
    def test_creates_new_admin_user(self):
        call_command(
            "bootstrap_admin",
            "--username",
            "root",
            "--email",
            "root@example.com",
            "--password",
            "StrongPass123!",
            "--noinput",
        )

        user = User.objects.get(username="root")
        self.assertTrue(user.check_password("StrongPass123!"))
        self.assertTrue(user.is_staff)
        self.assertTrue(user.is_superuser)
        self.assertEqual(user.profile.role, UserProfile.Role.ADMIN)

    def test_updates_existing_user(self):
        user = User.objects.create_user(username="admin", email="old@example.com", password="Temp1234!")
        user.is_staff = False
        user.save(update_fields=["is_staff"])
        user.profile.role = UserProfile.Role.STANDARD
        user.profile.save(update_fields=["role", "updated_at"])

        call_command(
            "bootstrap_admin",
            "--username",
            "admin",
            "--email",
            "new@example.com",
            "--password",
            "BetterPass123!",
            "--noinput",
        )

        user.refresh_from_db()
        self.assertEqual(user.email, "new@example.com")
        self.assertTrue(user.is_staff)
        self.assertTrue(user.is_superuser)
        self.assertTrue(user.check_password("BetterPass123!"))
        self.assertEqual(user.profile.role, UserProfile.Role.ADMIN)
