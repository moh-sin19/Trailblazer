from __future__ import annotations

import getpass
from typing import Any

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from accounts.models import UserProfile

User = get_user_model()


class Command(BaseCommand):
    help = "Create or update a role-aware admin user with two-factor dashboard access."

    def add_arguments(self, parser):
        parser.add_argument(
            "--username", default="admin", help="Username for the admin account"
        )
        parser.add_argument(
            "--email", default="admin@example.com", help="Email for the admin account"
        )
        parser.add_argument(
            "--password",
            help="Password for the admin account. If omitted, you will be prompted. Use with caution in production.",
        )
        parser.add_argument(
            "--noinput",
            action="store_true",
            help="Do not prompt for password (required to supply --password).",
        )

    def handle(self, *args: Any, **options: Any):
        username = options["username"].strip()
        email = options["email"].strip()
        password = options.get("password")
        noinput = options.get("noinput", False)

        if not username:
            raise CommandError("Username may not be blank.")
        if not email:
            raise CommandError("Email may not be blank.")

        if not password:
            if noinput:
                raise CommandError("You must provide --password when using --noinput.")
            try:
                password = getpass.getpass("Password: ")
            except EOFError as exc:  # pragma: no cover - interactive fallback only
                raise CommandError("Unable to read password from input.") from exc
            password_confirm = getpass.getpass("Password (again): ")
            if password != password_confirm:
                raise CommandError("The passwords did not match.")

        if not password:
            raise CommandError("A password must be provided.")

        user, created = User.objects.get_or_create(
            username=username,
            defaults={
                "email": email,
            },
        )

        if not created and user.email != email:
            user.email = email
            self.stdout.write(self.style.WARNING("Updated admin email address."))

        user.is_staff = True
        user.is_superuser = True
        user.set_password(password)
        user.save()

        profile = getattr(user, "profile", None)
        if profile is None:
            profile = UserProfile.objects.create(user=user, display_name=username)
        if profile.role != UserProfile.Role.ADMIN:
            profile.role = UserProfile.Role.ADMIN
            profile.save(update_fields=["role", "updated_at"])
        if not profile.email_verified:
            profile.email_verified = True
            profile.save(update_fields=["email_verified", "updated_at"])

        self.stdout.write(
            self.style.SUCCESS(
                f"Admin user '{user.username}' ({user.email}) is ready. You can now access the dashboard."
            )
        )
