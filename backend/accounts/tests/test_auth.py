from __future__ import annotations

from datetime import timedelta
from typing import Any, cast

from django.contrib.auth import get_user_model
from django.contrib.sessions.models import Session
from django.utils import timezone
from django.urls import reverse
from django.core import mail
from django.test import override_settings
from rest_framework import status
from rest_framework.test import APIClient, APITestCase

from accounts.models import EmailVerificationToken, LoginTwoFactorToken

User = get_user_model()


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
class AuthFlowTests(APITestCase):
    register_url = reverse("auth-register")
    login_url = reverse("auth-login")
    session_url = reverse("auth-session")
    logout_url = reverse("auth-logout")
    verify_url = reverse("auth-verify-email")

    def register(self, **payload: Any):
        body = {
            "username": payload.get("username", "alice"),
            "email": payload.get("email", "alice@example.com"),
            "password": payload.get("password", "SuperSecret123!"),
        }
        if "display_name" in payload:
            body["display_name"] = payload["display_name"]
        return self.client.post(self.register_url, body, format="json")

    def verify(self, token: str) -> None:
        response = self.client.post(self.verify_url, {"token": token}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def login(
        self,
        client: APIClient | None = None,
        email: str = "alice@example.com",
        password: str = "SuperSecret123!",
        complete_two_factor: bool = False,
        otp: str | None = None,
        two_factor_token: str | None = None,
    ):
        client = client or self.client
        if two_factor_token:
            payload = {"two_factor_token": two_factor_token, "otp": otp}
            return client.post(self.login_url, payload, format="json")

        first_response = client.post(self.login_url, {"email": email, "password": password}, format="json")
        if first_response.status_code != status.HTTP_202_ACCEPTED or not complete_two_factor:
            return first_response

        token_value = first_response.json().get("two_factor_token")
        self.assertIsNotNone(token_value)
        if otp is None:
            record = LoginTwoFactorToken.objects.get(token=token_value)
            otp = record.code
        return client.post(self.login_url, {"two_factor_token": token_value, "otp": otp}, format="json")

    def session_keys_for_user(self, user: User) -> list[str]:
        keys: list[str] = []
        for session in Session.objects.filter(expire_date__gte=timezone.now()):
            data = session.get_decoded()
            if data.get("_auth_user_id") == str(user.pk):
                keys.append(session.session_key)
        return keys

    def verification_token_for(self, email: str) -> EmailVerificationToken:
        user = User.objects.get(email=email)
        token = user.email_verification_tokens.first()
        self.assertIsNotNone(token)
        return cast(EmailVerificationToken, token)

    def test_register_creates_profile_and_token(self):
        response = self.register(display_name="Alice")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        data = response.json()
        self.assertIn("user", data)
        self.assertIn("detail", data)
        user = User.objects.get(email="alice@example.com")
        profile = user.profile
        self.assertEqual(profile.display_name, "Alice")
        self.assertFalse(profile.email_verified)
        token_obj = self.verification_token_for("alice@example.com")
        self.assertEqual(token_obj.user, user)

    def test_register_sends_verification_email(self):
        mail.outbox = []
        response = self.register()
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(len(mail.outbox), 1)
        email = mail.outbox[0]
        token = self.verification_token_for("alice@example.com").token
        self.assertIn("Verify", email.subject)
        self.assertIn(str(token), email.body)
        self.assertIn("http://localhost:4200/verify-email?token=", email.body)
        self.assertEqual(email.to, ["alice@example.com"])

    def test_register_duplicate_email_returns_conflict(self):
        first = self.register()
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        second = self.register(username="alice2")
        self.assertEqual(second.status_code, status.HTTP_409_CONFLICT)

    def test_register_enforces_password_complexity(self):
        response = self.register(password="simple123")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("Password must", str(response.json()))

    def test_login_requires_email_verification(self):
        response = self.register()
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        login_response = self.login()
        self.assertEqual(login_response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertIn("Email address", login_response.json()["detail"])

    def test_login_returns_two_factor_challenge(self):
        self.register()
        token = self.verification_token_for("alice@example.com")
        self.verify(str(token.token))

        mail.outbox = []
        response = self.login()
        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED)
        self.assertIn("two_factor_token", response.json())
        self.assertEqual(len(mail.outbox), 1)

    def test_two_factor_rejects_invalid_code(self):
        self.register()
        token = self.verification_token_for("alice@example.com")
        self.verify(str(token.token))

        step_one = self.login()
        token_value = step_one.json()["two_factor_token"]
        result = self.login(two_factor_token=token_value, otp="000000")
        self.assertEqual(result.status_code, status.HTTP_400_BAD_REQUEST)

    def test_two_factor_rejects_expired_token(self):
        self.register()
        token = self.verification_token_for("alice@example.com")
        self.verify(str(token.token))

        record = LoginTwoFactorToken.objects.create(user=User.objects.get(email="alice@example.com"))
        # Force expiry
        record.expires_at = timezone.now() - timedelta(minutes=1)
        record.save(update_fields=["expires_at"])

        response = self.login(two_factor_token=str(record.token), otp=record.code)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_email_verification_enables_login_and_session(self):
        response = self.register(display_name="Alice Wonderland")
        token = self.verification_token_for("alice@example.com")
        self.verify(str(token.token))

        client = APIClient()
        first_step = self.login(client)
        self.assertEqual(first_step.status_code, status.HTTP_202_ACCEPTED)
        token_value = first_step.json()["two_factor_token"]
        otp_code = LoginTwoFactorToken.objects.get(token=token_value).code

        login_response = self.login(client, two_factor_token=token_value, otp=otp_code)
        self.assertEqual(login_response.status_code, status.HTTP_200_OK)
        payload = login_response.json()
        self.assertEqual(payload["profile"]["display_name"], "Alice Wonderland")

        session_response = client.get(self.session_url)
        self.assertEqual(session_response.status_code, status.HTTP_200_OK)
        self.assertEqual(session_response.json()["email"], "alice@example.com")

    def test_logout_clears_session(self):
        response = self.register()
        token = self.verification_token_for("alice@example.com")
        self.verify(str(token.token))
        client = APIClient()
        step_one = self.login(client)
        otp_code = LoginTwoFactorToken.objects.get(token=step_one.json()["two_factor_token"]).code
        login_response = self.login(client, two_factor_token=step_one.json()["two_factor_token"], otp=otp_code)
        self.assertEqual(login_response.status_code, status.HTTP_200_OK)

        logout_response = client.post(self.logout_url, {}, format="json")
        self.assertEqual(logout_response.status_code, status.HTTP_204_NO_CONTENT)
        session_response = client.get(self.session_url)
        self.assertEqual(session_response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_logout_all_sessions_revokes_other_sessions(self):
        response = self.register()
        token = self.verification_token_for("alice@example.com")
        self.verify(str(token.token))
        user = User.objects.get(email="alice@example.com")

        client_a = APIClient()
        client_b = APIClient()
        step_a = self.login(client_a)
        otp_a = LoginTwoFactorToken.objects.get(token=step_a.json()["two_factor_token"]).code
        self.assertEqual(
            self.login(client_a, two_factor_token=step_a.json()["two_factor_token"], otp=otp_a).status_code,
            status.HTTP_200_OK,
        )

        step_b = self.login(client_b)
        otp_b = LoginTwoFactorToken.objects.get(token=step_b.json()["two_factor_token"]).code
        self.assertEqual(
            self.login(client_b, two_factor_token=step_b.json()["two_factor_token"], otp=otp_b).status_code,
            status.HTTP_200_OK,
        )
        self.assertGreater(len(self.session_keys_for_user(user)), 1)

        logout_response = client_a.post(self.logout_url, {"all_sessions": True}, format="json")
        self.assertEqual(logout_response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(self.session_keys_for_user(user), [])

        subsequent = client_b.get(self.session_url)
        self.assertEqual(subsequent.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_default_display_name_falls_back_to_username(self):
        response = self.register()
        user = User.objects.get(email="alice@example.com")
        profile = user.profile
        self.assertEqual(profile.display_name, user.username)
        self.assertFalse(profile.email_verified)


class AuthCORSTests(APITestCase):
    login_url = reverse("auth-login")

    def test_login_options_allows_credentials(self):
        response = self.client.options(
            self.login_url,
            HTTP_ORIGIN="http://localhost:4200",
            HTTP_ACCESS_CONTROL_REQUEST_METHOD="POST",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response["Access-Control-Allow-Credentials"], "true")
        self.assertEqual(response["Access-Control-Allow-Origin"], "http://localhost:4200")
