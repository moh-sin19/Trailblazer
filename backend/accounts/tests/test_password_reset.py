import re
from datetime import timedelta
from urllib.parse import parse_qs, urlparse

from django.contrib.auth import get_user_model
from django.core import mail
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import PasswordResetToken

User = get_user_model()


class PasswordResetTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            username="walker",
            email="walker@example.com",
            password="InitialPass123",
        )
        self.request_url = "/api/auth/password-reset/"
        self.confirm_url = "/api/auth/password-reset/confirm/"

    def test_request_creates_token_and_sends_email(self):
        response = self.client.post(self.request_url, {"email": self.user.email})
        self.assertEqual(response.status_code, 202)
        tokens = PasswordResetToken.objects.filter(user=self.user)
        self.assertEqual(tokens.count(), 1)
        self.assertEqual(len(mail.outbox), 1)
        message = mail.outbox[0].body
        link_match = re.search(r"Reset link: (?P<link>\S+)", message)
        self.assertIsNotNone(link_match)
        reset_link = link_match.group("link")
        parsed_link = urlparse(reset_link)
        self.assertTrue(reset_link.startswith("http"))
        self.assertTrue(parsed_link.path.endswith("/reset-password"))
        query_params = parse_qs(parsed_link.query)
        self.assertIn("token", query_params)
        raw_token = query_params["token"][0]
        code_match = re.search(r"Reset code: (?P<token>[A-Za-z0-9_=-]+)", message)
        self.assertIsNotNone(code_match)
        self.assertEqual(raw_token, code_match.group("token"))
        token_obj = tokens.first()
        self.assertNotEqual(token_obj.token_hash, raw_token)
        self.assertTrue(token_obj.is_active)

        response = self.client.post(
            self.confirm_url,
            {"token": raw_token, "password": "NewSecurePass123"},
        )
        self.assertEqual(response.status_code, 204)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("NewSecurePass123"))
        token_obj.refresh_from_db()
        self.assertFalse(token_obj.is_active)

    def test_request_for_unknown_email_is_always_accepted(self):
        response = self.client.post(self.request_url, {"email": "ghost@example.com"})
        self.assertEqual(response.status_code, 202)
        self.assertEqual(PasswordResetToken.objects.count(), 0)
        self.assertEqual(len(mail.outbox), 0)

    def test_expired_token_cannot_be_used(self):
        token_obj, raw_token = PasswordResetToken.generate_token(self.user)
        token_obj.expires_at = timezone.now() - timedelta(minutes=1)
        token_obj.save(update_fields=["expires_at"])
        response = self.client.post(
            self.confirm_url, {"token": raw_token, "password": "AnotherPass123"}
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("token", response.data)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("InitialPass123"))

    def test_redeeming_token_invalidates_others(self):
        # Create two tokens, only the latest should work and mark previous as used.
        old_token_obj, old_raw = PasswordResetToken.generate_token(self.user)
        new_token_obj, new_raw = PasswordResetToken.generate_token(self.user)
        response = self.client.post(
            self.confirm_url, {"token": new_raw, "password": "FinalPass123"}
        )
        self.assertEqual(response.status_code, 204)
        old_token_obj.refresh_from_db()
        new_token_obj.refresh_from_db()
        self.assertFalse(old_token_obj.is_active)
        self.assertFalse(new_token_obj.is_active)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("FinalPass123"))

    def test_invalid_token_returns_error(self):
        response = self.client.post(
            self.confirm_url,
            {"token": "invalid", "password": "StrongPass123"},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("token", response.data)
