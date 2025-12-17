import re
from typing import Any, Iterable

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.mail import send_mail
from django.db import IntegrityError
from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers
from rest_framework.fields import empty

from .models import EmailVerificationToken, PasswordResetToken, UserProfile
from trails.models import Comment, Trail
from trails.services.route_processing import count_points

User = get_user_model()

USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9_.]{3,30}$")


class UserProfileSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(source="user_id", read_only=True)
    email = serializers.EmailField(source="user.email", read_only=True)
    username = serializers.CharField(source="user.username", read_only=True)
    avatar = serializers.ImageField(write_only=True, required=False, allow_null=True)
    avatar_url = serializers.SerializerMethodField()
    experience_label = serializers.SerializerMethodField()
    role_label = serializers.SerializerMethodField()
    role = serializers.CharField(read_only=True)

    class Meta:
        model = UserProfile
        fields = (
            "id",
            "username",
            "display_name",
            "bio",
            "experience",
            "experience_label",
            "role",
            "role_label",
            "avatar",
            "avatar_url",
            "email",
            "email_verified",
            "updated_at",
        )
        extra_kwargs = {
            "bio": {"allow_blank": True, "required": False},
            "experience": {"required": False},
        }

    def get_experience_label(self, obj: UserProfile) -> str:
        return obj.get_experience_display()

    def get_role_label(self, obj: UserProfile) -> str:
        return obj.get_role_display()

    def get_avatar_url(self, obj: UserProfile) -> str | None:
        if not obj.avatar:
            return None
        request = self.context.get("request")
        url = obj.avatar.url
        if request:
            return request.build_absolute_uri(url)
        return url

    def validate_avatar(self, value):
        if value is None:
            return value
        content_type = getattr(value, "content_type", "")
        if not content_type.startswith("image/"):
            raise serializers.ValidationError("Please upload a valid image file.")
        if value.size > 5 * 1024 * 1024:
            raise serializers.ValidationError("File size must be less than 5MB.")
        return value

    def update(self, instance: UserProfile, validated_data: dict[str, Any]) -> UserProfile:
        avatar = validated_data.pop("avatar", empty)
        instance = super().update(instance, validated_data)

        needs_save = False
        if avatar is not empty:
            if avatar is None:
                if instance.avatar:
                    instance.avatar.delete(save=False)
                instance.avatar = None
                needs_save = True
            else:
                if instance.avatar:
                    instance.avatar.delete(save=False)
                instance.avatar = avatar
                needs_save = True

        if needs_save:
            instance.save()
        return instance


class AuthenticatedUserSerializer(serializers.ModelSerializer):
    profile = UserProfileSerializer()

    class Meta:
        model = User
        fields = ("id", "username", "email", "profile")


class RegistrationSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=30)
    email = serializers.EmailField()
    password = serializers.CharField(min_length=8, write_only=True)
    display_name = serializers.CharField(max_length=50, min_length=3, required=False, allow_blank=False)

    default_error_messages = {
        "duplicate": "An account with that username or email already exists.",
    }

    def validate_username(self, value: str) -> str:
        if not USERNAME_PATTERN.fullmatch(value):
            raise serializers.ValidationError(
                "Username must be 3-30 characters and may contain letters, numbers, underscores, and periods."
            )
        return value

    def validate_display_name(self, value: str) -> str:
        trimmed = value.strip()
        if not (3 <= len(trimmed) <= 50):
            raise serializers.ValidationError("Display name must be between 3 and 50 characters long.")
        return trimmed

    def validate_password(self, value: str) -> str:
        if not re.search(r"[A-Z]", value):
            raise serializers.ValidationError("Password must contain at least one uppercase letter.")
        if not re.search(r"[a-z]", value):
            raise serializers.ValidationError("Password must contain at least one lowercase letter.")
        if not re.search(r"\d", value):
            raise serializers.ValidationError("Password must contain at least one number.")
        if not re.search(r"[^A-Za-z0-9]", value):
            raise serializers.ValidationError("Password must contain at least one symbol.")
        return value

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        username = attrs.get("username")
        email = attrs.get("email")
        if User.objects.filter(Q(username__iexact=username) | Q(email__iexact=email)).exists():
            self.fail("duplicate")
        return attrs

    def create(self, validated_data: dict[str, Any]) -> dict[str, Any]:
        display_name = validated_data.pop("display_name", None)
        try:
            user = User.objects.create_user(**validated_data)
        except IntegrityError:
            self.fail("duplicate")

        profile = user.profile  # ensured by signal
        if display_name:
            profile.display_name = display_name
        else:
            profile.display_name = user.username
        profile.email_verified = False
        profile.save(update_fields=["display_name", "email_verified", "updated_at"])

        verification_token = EmailVerificationToken.objects.create(user=user)
        self._send_verification_email(user, verification_token)
        return {
            "user": user,
            "verification_token": verification_token,
        }

    def _send_verification_email(
        self,
        user: User,
        token: EmailVerificationToken,
    ) -> None:
        frontend_base = getattr(settings, "FRONTEND_BASE_URL", "http://localhost:4200")
        base = frontend_base.rstrip("/")
        verification_link = f"{base}/verify-email?token={token.token}"
        subject = getattr(
            settings,
            "EMAIL_VERIFICATION_SUBJECT",
            "Verify your Trailblazer account",
        )
        message = (
            "Thanks for signing up to Trailblazer!\n\n"
            "Please verify your email address to activate your account.\n"
            f"Verification link: {verification_link}\n"
            f"Verification code: {token.token}\n\n"
            "If you did not create this account, you can safely ignore this email."
        )
        from_email = getattr(settings, "DEFAULT_FROM_EMAIL", "no-reply@example.com")
        send_mail(subject, message, from_email, [user.email], fail_silently=False)


class EmailVerificationSerializer(serializers.Serializer):
    token = serializers.UUIDField()

    def validate_token(self, value):
        try:
            token_obj = EmailVerificationToken.objects.select_related("user", "user__profile").get(token=value)
        except EmailVerificationToken.DoesNotExist as exc:
            raise serializers.ValidationError("Token not found.") from exc
        if token_obj.used_at is not None:
            raise serializers.ValidationError("Token has already been used.")
        if token_obj.is_expired:
            raise serializers.ValidationError("Token has expired.")
        self.context["token_obj"] = token_obj
        return value

    def save(self, **kwargs):
        token_obj: EmailVerificationToken = self.context["token_obj"]
        profile = token_obj.user.profile
        profile.email_verified = True
        profile.save(update_fields=["email_verified", "updated_at"])
        token_obj.mark_used()
        return token_obj.user



class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField(required=False)
    password = serializers.CharField(write_only=True, required=False)
    two_factor_token = serializers.UUIDField(required=False)
    otp = serializers.CharField(write_only=True, required=False, min_length=6, max_length=6)

    default_error_messages = {
        "missing_credentials": "Email and password are required to start a login session.",
        "missing_two_factor": "Provide the verification code sent to your email.",
    }

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        has_credentials = attrs.get("email") and attrs.get("password")
        has_two_factor = attrs.get("two_factor_token") and attrs.get("otp")

        if has_credentials and has_two_factor:
            self.fail("missing_two_factor")

        if has_two_factor:
            return attrs

        if has_credentials:
            return attrs

        if attrs.get("two_factor_token") or attrs.get("otp"):
            self.fail("missing_two_factor")

        self.fail("missing_credentials")


class SessionSerializer(serializers.ModelSerializer):
    profile = UserProfileSerializer()

    class Meta:
        model = User
        fields = ("id", "username", "email", "profile")


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()

    def save(self, **kwargs):
        email = self.validated_data["email"]
        user = User.objects.filter(email__iexact=email).first()
        if not user:
            return None

        token_obj, raw_token = PasswordResetToken.generate_token(user)

        subject = "Password Reset Request"
        frontend_base = getattr(settings, "FRONTEND_BASE_URL", "http://localhost:4200")
        base_url = frontend_base.rstrip("/")
        reset_link = f"{base_url}/reset-password?token={raw_token}"
        message = (
            "You (or someone else) requested to reset your password.\n"
            "Use the link below to complete the process.\n\n"
            f"Reset link: {reset_link}\n"
            f"Reset code: {raw_token}\n"
            "\n"
            "If you did not request this change, you can safely ignore this email."
        )
        from_email = getattr(settings, "DEFAULT_FROM_EMAIL", "no-reply@example.com")
        send_mail(subject, message, from_email, [user.email], fail_silently=True)

        return token_obj


class PasswordResetConfirmSerializer(serializers.Serializer):
    token = serializers.CharField()
    password = serializers.CharField(min_length=8, write_only=True)

    default_error_messages = {
        "invalid_token": "This reset token is invalid or has expired.",
    }

    def validate_token(self, value: str) -> str:
        token_hash = PasswordResetToken.hash_token(value)
        try:
            token_obj = PasswordResetToken.objects.select_related("user").get(token_hash=token_hash)
        except PasswordResetToken.DoesNotExist as exc:
            raise serializers.ValidationError(self.error_messages["invalid_token"]) from exc

        if not token_obj.is_active:
            raise serializers.ValidationError(self.error_messages["invalid_token"])

        self.context["reset_token"] = token_obj
        return value

    def save(self, **kwargs):
        token_obj: PasswordResetToken = self.context["reset_token"]
        user = token_obj.user
        password = self.validated_data["password"]

        user.set_password(password)
        user.save(update_fields=["password"])

        now = timezone.now()
        PasswordResetToken.objects.filter(user=user, used_at__isnull=True).update(used_at=now)

        # ensure token_obj reflects updated state without additional query
        token_obj.used_at = now
        return user


# Public Profile Serializers for badges/stats feature

class PublicBadgeSerializer(serializers.Serializer):
    """Serializer for badge data in public profiles"""
    id = serializers.IntegerField()
    name = serializers.CharField()
    description = serializers.CharField()
    icon = serializers.CharField()
    awarded = serializers.BooleanField()
    awarded_at = serializers.DateTimeField(allow_null=True)
    progress = serializers.DictField(allow_null=True)


class PublicUserStatsSerializer(serializers.Serializer):
    """Serializer for user statistics in public profiles"""
    trails_created = serializers.IntegerField()
    trails_completed = serializers.IntegerField()
    comments_posted = serializers.IntegerField()
    trails_bookmarked = serializers.IntegerField()
    distance_hiked_km = serializers.FloatField()


class PublicUserAnalyticsDistanceSerializer(serializers.Serializer):
    total_km = serializers.FloatField()
    average_per_trail_km = serializers.FloatField()
    longest_trail_km = serializers.FloatField()
    completed_trails = serializers.IntegerField()


class PublicDifficultyBreakdownSerializer(serializers.Serializer):
    difficulty = serializers.CharField()
    count = serializers.IntegerField()
    distance_km = serializers.FloatField()


class PublicMonthlyProgressSerializer(serializers.Serializer):
    month = serializers.CharField(allow_null=True)
    count = serializers.IntegerField()
    distance_km = serializers.FloatField()


class PublicUserAnalyticsSerializer(serializers.Serializer):
    distance = PublicUserAnalyticsDistanceSerializer()
    difficulty_breakdown = PublicDifficultyBreakdownSerializer(many=True)
    monthly_progress = PublicMonthlyProgressSerializer(many=True)


class PublicTrailSummarySerializer(serializers.Serializer):
    """Serializer for trail summaries in public profiles"""
    id = serializers.IntegerField()
    title = serializers.CharField(source="name")
    distance_km = serializers.FloatField()
    difficulty = serializers.CharField()
    created_at = serializers.DateTimeField(read_only=True)


class PublicUserProfileSerializer(serializers.Serializer):
    """Public profile view with badges, stats, and recent activity"""
    username = serializers.CharField(source="user.username")
    display_name = serializers.CharField()
    avatar_url = serializers.SerializerMethodField()
    home_suburb = serializers.SerializerMethodField()
    stats = PublicUserStatsSerializer(source="user.stats")
    badges = serializers.SerializerMethodField()
    recent_trails = serializers.SerializerMethodField()
    pending_trails = serializers.SerializerMethodField()
    analytics = serializers.SerializerMethodField()

    def get_avatar_url(self, obj):
        """Return the full URL for the user's avatar"""
        if obj.avatar:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.avatar.url)
            return obj.avatar.url
        return None

    def get_home_suburb(self, obj):
        # For now, return None - can be added as a field to UserProfile later
        return None

    def get_badges(self, obj):
        # Badges are passed via context
        return self.context.get("badges", [])

    def get_recent_trails(self, obj):
        # Recent trails are passed via context
        return self.context.get("recent_trails", [])

    def get_pending_trails(self, obj):
        # Pending trails are passed via context (only for profile owner)
        return self.context.get("pending_trails", [])

    def get_analytics(self, obj):
        analytics = self.context.get("analytics")
        if analytics is None:
            analytics = {
                "distance": {
                    "total_km": 0.0,
                    "average_per_trail_km": 0.0,
                    "longest_trail_km": 0.0,
                    "completed_trails": 0,
                },
                "difficulty_breakdown": [],
                "monthly_progress": [],
            }
        serializer = PublicUserAnalyticsSerializer(instance=analytics)
        return serializer.data


class AdminUserSerializer(serializers.ModelSerializer):
    display_name = serializers.CharField(
        source="profile.display_name",
        required=False,
        allow_blank=False,
        max_length=50,
    )
    role = serializers.ChoiceField(
        choices=UserProfile.Role.choices,
        source="profile.role",
        required=False,
    )
    role_label = serializers.CharField(
        source="profile.get_role_display",
        read_only=True,
    )
    email_verified = serializers.BooleanField(
        source="profile.email_verified",
        read_only=True,
    )
    experience = serializers.CharField(
        source="profile.experience",
        read_only=True,
    )
    experience_label = serializers.CharField(
        source="profile.get_experience_display",
        read_only=True,
    )

    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "email",
            "display_name",
            "role",
            "role_label",
            "email_verified",
            "is_active",
            "experience",
            "experience_label",
            "date_joined",
            "last_login",
        ]
        read_only_fields = [
            "id",
            "username",
            "email",
            "role_label",
            "email_verified",
            "experience",
            "experience_label",
            "date_joined",
            "last_login",
        ]

    def validate_display_name(self, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise serializers.ValidationError("Display name cannot be blank.")
        if len(trimmed) < 3 or len(trimmed) > 50:
            raise serializers.ValidationError("Display name must be between 3 and 50 characters long.")
        return trimmed

    def update(self, instance: User, validated_data: dict[str, Any]) -> User:
        profile_data = validated_data.pop("profile", {})
        user_updates = {attr: value for attr, value in validated_data.items()}

        if user_updates:
            for attr, value in user_updates.items():
                setattr(instance, attr, value)
            update_fields: Iterable[str] = user_updates.keys()
            instance.save(update_fields=list(update_fields))

        if profile_data:
            profile = instance.profile
            for attr, value in profile_data.items():
                setattr(profile, attr, value)
            update_fields = list(profile_data.keys())
            if "updated_at" not in update_fields:
                update_fields.append("updated_at")
            profile.save(update_fields=update_fields)
        return instance


class AdminTrailModerationSerializer(serializers.ModelSerializer):
    submitted_by = serializers.SerializerMethodField()
    segments = serializers.SerializerMethodField()
    start = serializers.SerializerMethodField()
    total_points = serializers.SerializerMethodField()

    class Meta:
        model = Trail
        fields = [
            "id",
            "name",
            "slug",
            "difficulty",
            "distance_km",
            "elev_gain_m",
            "duration_mins",
            "description",
            "approval_state",
            "submitted_by",
            "submitted_at",
            "total_points",
            "segments",
            "start",
        ]
        read_only_fields = [
            "id",
            "slug",
            "distance_km",
            "elev_gain_m",
            "duration_mins",
            "description",
            "submitted_by",
            "submitted_at",
            "total_points",
            "segments",
            "start",
        ]

    def get_submitted_by(self, obj: Trail) -> dict[str, Any] | None:
        user = obj.submitted_by
        if not user:
            return None
        profile = getattr(user, "profile", None)
        display_name = getattr(profile, "display_name", None) or user.get_username()
        return {
            "id": user.id,
            "username": user.get_username(),
            "display_name": display_name,
        }

    def get_segments(self, obj: Trail) -> list[list[dict[str, float]]]:
        segments = getattr(obj, "route_path", []) or []
        formatted: list[list[dict[str, float]]] = []
        for segment in segments:
            if not isinstance(segment, list):
                continue
            cleaned: list[dict[str, float]] = []
            for point in segment:
                if not isinstance(point, dict):
                    continue
                lat = point.get("lat")
                lng = point.get("lng")
                if lat is None or lng is None:
                    continue
                cleaned.append({"lat": float(lat), "lng": float(lng)})
            if cleaned:
                formatted.append(cleaned)
        return formatted

    def get_start(self, obj: Trail) -> dict[str, float] | None:
        segments = self.get_segments(obj)
        if segments and segments[0]:
            return segments[0][0]
        return None

    def get_total_points(self, obj: Trail) -> int:
        segments = getattr(obj, "route_path", []) or []
        return count_points(segments)

    def update(self, instance: Trail, validated_data: dict[str, Any]) -> Trail:
        approval_state = validated_data.get("approval_state")
        if approval_state and approval_state != instance.approval_state:
            instance.approval_state = approval_state
            instance.save(update_fields=["approval_state"])
        return instance


class AdminCommentSerializer(serializers.ModelSerializer):
    trail_name = serializers.CharField(source="trail.name", read_only=True)
    trail_slug = serializers.CharField(source="trail.slug", read_only=True)
    author_username = serializers.CharField(source="author.username", read_only=True)
    author_display_name = serializers.SerializerMethodField()

    class Meta:
        model = Comment
        fields = [
            "id",
            "trail",
            "trail_name",
            "trail_slug",
            "author",
            "author_username",
            "author_display_name",
            "body",
            "rating",
            "is_deleted",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "trail",
            "trail_name",
            "trail_slug",
            "author",
            "author_username",
            "author_display_name",
            "body",
            "rating",
            "created_at",
            "updated_at",
        ]

    def get_author_display_name(self, obj: Comment) -> str:
        profile = getattr(obj.author, "profile", None)
        if profile and profile.display_name:
            return profile.display_name
        return obj.author.get_username()

    def update(self, instance: Comment, validated_data: dict[str, Any]) -> Comment:
        update_fields = ["updated_at"]
        if "is_deleted" in validated_data:
            instance.is_deleted = validated_data["is_deleted"]
            update_fields.insert(0, "is_deleted")
        instance.updated_at = timezone.now()
        instance.save(update_fields=update_fields)
        return instance
