import secrets
import hashlib
import uuid
from datetime import timedelta
from typing import Tuple

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.validators import MinLengthValidator
from django.db import models
from django.utils import timezone

User = get_user_model()


class UserProfile(models.Model):
    class Role(models.TextChoices):
        STANDARD = "standard", "Standard"
        ADMIN = "admin", "Admin"

    class Experience(models.TextChoices):
        BEGINNER = "beginner", "Beginner"
        INTERMEDIATE = "intermediate", "Intermediate"
        ADVANCED = "advanced", "Advanced"

    user = models.OneToOneField(
        User,
        on_delete=models.CASCADE,
        related_name="profile",
        primary_key=True,
    )
    display_name = models.CharField(max_length=50, validators=[MinLengthValidator(3)])
    bio = models.TextField(blank=True, max_length=500)
    experience = models.CharField(
        max_length=16, choices=Experience.choices, default=Experience.BEGINNER
    )
    role = models.CharField(
        max_length=16,
        choices=Role.choices,
        default=Role.STANDARD,
        help_text="Controls access to admin dashboard features.",
    )
    avatar = models.ImageField(upload_to="avatars/", blank=True, null=True)
    email_verified = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:  # pragma: no cover - representational only
        return f"Profile<{self.display_name}>"


class EmailVerificationToken(models.Model):
    TOKEN_TTL_HOURS = getattr(settings, "EMAIL_VERIFICATION_TOKEN_HOURS", 24)

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="email_verification_tokens",
    )
    token = models.UUIDField(default=uuid.uuid4, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def save(self, *args, **kwargs):
        if not self.expires_at:
            self.expires_at = timezone.now() + timedelta(hours=self.TOKEN_TTL_HOURS)
        super().save(*args, **kwargs)

    @property
    def is_expired(self) -> bool:
        return timezone.now() >= self.expires_at

    def mark_used(self) -> None:
        if not self.used_at:
            self.used_at = timezone.now()
            self.save(update_fields=["used_at"])

    def __str__(self) -> str:  # pragma: no cover
        return f"EmailToken<{self.user_id}>"


class PasswordResetToken(models.Model):
    TOKEN_BYTES = 32
    TTL = timedelta(hours=1)

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="password_reset_tokens",
        on_delete=models.CASCADE,
    )
    token_hash = models.CharField(max_length=128, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        indexes = [models.Index(fields=["user", "expires_at"])]

    def __str__(self) -> str:  # pragma: no cover - trivial
        return f"PasswordResetToken<{self.user_id}>"

    @classmethod
    def generate_token(cls, user: User) -> Tuple["PasswordResetToken", str]:
        raw_token = secrets.token_urlsafe(cls.TOKEN_BYTES)
        token_hash = cls.hash_token(raw_token)
        expires_at = timezone.now() + cls.TTL
        obj = cls.objects.create(
            user=user,
            token_hash=token_hash,
            expires_at=expires_at,
        )
        return obj, raw_token

    @staticmethod
    def hash_token(token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    @property
    def is_active(self) -> bool:
        if self.used_at is not None:
            return False
        return timezone.now() <= self.expires_at

    def mark_used(self) -> None:
        self.used_at = timezone.now()
        self.save(update_fields=["used_at"])


class LoginTwoFactorToken(models.Model):
    CODE_LENGTH = 6
    MAX_ATTEMPTS = 5
    TTL = timedelta(minutes=10)

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="two_factor_tokens",
        on_delete=models.CASCADE,
    )
    token = models.UUIDField(default=uuid.uuid4, unique=True)
    code = models.CharField(max_length=CODE_LENGTH)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    consumed_at = models.DateTimeField(null=True, blank=True)
    failed_attempts = models.PositiveSmallIntegerField(default=0)

    class Meta:
        indexes = [models.Index(fields=["user", "token"])]

    def save(self, *args, **kwargs):
        if not self.expires_at:
            self.expires_at = timezone.now() + self.TTL
        if not self.code:
            self.code = self.generate_code()
        super().save(*args, **kwargs)

    @classmethod
    def generate_code(cls) -> str:
        return "".join(secrets.choice("0123456789") for _ in range(cls.CODE_LENGTH))

    @property
    def is_expired(self) -> bool:
        return timezone.now() >= self.expires_at

    @property
    def has_exhausted_attempts(self) -> bool:
        return self.failed_attempts >= self.MAX_ATTEMPTS

    def mark_used(self) -> None:
        self.consumed_at = timezone.now()
        self.save(update_fields=["consumed_at"])

    def record_failure(self) -> None:
        self.failed_attempts = models.F("failed_attempts") + 1
        self.save(update_fields=["failed_attempts"])
        self.refresh_from_db(fields=["failed_attempts"])

    def matches(self, candidate: str) -> bool:
        return secrets.compare_digest(self.code, str(candidate))


class UserStats(models.Model):
    """Track user activity statistics"""
    user = models.OneToOneField(
        User,
        on_delete=models.CASCADE,
        related_name="stats",
        primary_key=True,
    )
    trails_created = models.PositiveIntegerField(default=0)
    trails_completed = models.PositiveIntegerField(default=0)
    comments_posted = models.PositiveIntegerField(default=0)
    trails_bookmarked = models.PositiveIntegerField(default=0)
    distance_hiked_km = models.FloatField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = "User stats"

    def __str__(self) -> str:  # pragma: no cover
        return f"Stats<{self.user_id}>"


class Badge(models.Model):
    """Badge definitions for user achievements"""
    name = models.CharField(max_length=100, unique=True)
    description = models.TextField()
    icon = models.CharField(max_length=10, help_text="Emoji or icon character")
    criterion = models.CharField(
        max_length=50,
        help_text="Field to check (e.g., 'trails_created', 'trails_completed')"
    )
    threshold = models.PositiveIntegerField(
        help_text="Value required to earn this badge"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["threshold", "name"]

    def __str__(self) -> str:  # pragma: no cover
        return f"{self.name} ({self.criterion} >= {self.threshold})"


class BadgeAward(models.Model):
    """Record of badges earned by users"""
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="badge_awards",
    )
    badge = models.ForeignKey(
        Badge,
        on_delete=models.CASCADE,
        related_name="awards",
    )
    awarded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ["user", "badge"]
        ordering = ["-awarded_at"]

    def __str__(self) -> str:  # pragma: no cover
        return f"{self.user_id} earned {self.badge.name}"


__all__ = [
    "UserProfile",
    "EmailVerificationToken",
    "PasswordResetToken",
    "LoginTwoFactorToken",
    "UserStats",
    "Badge",
    "BadgeAward",
]
