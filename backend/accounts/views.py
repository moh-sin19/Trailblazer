from __future__ import annotations

from datetime import timedelta
from typing import Any

from django.conf import settings
from django.contrib.auth import get_user_model, login, logout
from django.contrib.sessions.models import Session
from django.core.mail import send_mail
from django.db import transaction
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import filters, generics, mixins, permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import AuthenticationFailed, ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .permissions import IsAdminUser
from .serializers import (
    AuthenticatedUserSerializer,
    EmailVerificationSerializer,
    LoginSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    PublicUserProfileSerializer,
    RegistrationSerializer,
    SessionSerializer,
    UserProfileSerializer,
    AdminUserSerializer,
    AdminTrailModerationSerializer,
    AdminCommentSerializer,
)
from .models import LoginTwoFactorToken
from trails.models import Comment, Trail

User = get_user_model()


class RegistrationView(APIView):
    permission_classes = [AllowAny]

    @transaction.atomic
    def post(self, request: Request) -> Response:
        serializer = RegistrationSerializer(data=request.data)
        try:
            serializer.is_valid(raise_exception=True)
        except ValidationError as exc:
            codes = exc.get_codes()
            non_field_codes = (
                codes.get("non_field_errors") if isinstance(codes, dict) else None
            )
            if non_field_codes and "duplicate" in non_field_codes:
                return Response(exc.detail, status=status.HTTP_409_CONFLICT)
            raise
        result = serializer.save()
        user: User = result["user"]

        data = {
            "user": AuthenticatedUserSerializer(user).data,
            "detail": "Verification email sent. Please check your inbox.",
        }
        return Response(data, status=status.HTTP_201_CREATED)


class EmailVerificationView(APIView):
    permission_classes = [AllowAny]

    def post(self, request: Request) -> Response:
        serializer = EmailVerificationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        return Response(
            AuthenticatedUserSerializer(user).data, status=status.HTTP_200_OK
        )


class LoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request: Request) -> Response:
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if serializer.validated_data.get("two_factor_token"):
            return self._complete_two_factor(request, serializer.validated_data)

        email = serializer.validated_data["email"]
        password = serializer.validated_data["password"]

        user = (
            User.objects.select_related("profile").filter(email__iexact=email).first()
        )
        if not user or not user.check_password(password):
            raise AuthenticationFailed("Invalid email or password.")
        if not getattr(user, "profile", None) or not user.profile.email_verified:
            return Response(
                {"detail": "Email address has not been verified."},
                status=status.HTTP_403_FORBIDDEN,
            )

        token = self._issue_two_factor_token(user)
        self._send_two_factor_code(user, token)
        return Response(
            {
                "detail": "Verification code sent to your email.",
                "two_factor_token": str(token.token),
                "two_factor_required": True,
            },
            status=status.HTTP_202_ACCEPTED,
        )

    def _issue_two_factor_token(self, user: User) -> LoginTwoFactorToken:
        LoginTwoFactorToken.objects.filter(user=user, consumed_at__isnull=True).update(
            consumed_at=timezone.now()
        )
        return LoginTwoFactorToken.objects.create(user=user)

    def _send_two_factor_code(self, user: User, token: LoginTwoFactorToken) -> None:
        subject = getattr(
            settings, "TWO_FACTOR_EMAIL_SUBJECT", "Your Trailblazer login code"
        )
        from_email = getattr(settings, "DEFAULT_FROM_EMAIL", "no-reply@example.com")
        message = (
            "Hello {name},\n\n"
            "Your Trailblazer verification code is: {code}.\n"
            "The code expires in 10 minutes. If you did not attempt to sign in, please secure your account."
        ).format(name=user.get_full_name() or user.get_username(), code=token.code)
        send_mail(subject, message, from_email, [user.email], fail_silently=False)

    def _complete_two_factor(self, request: Request, data: dict[str, Any]) -> Response:
        token_value = data["two_factor_token"]
        otp = data["otp"]

        try:
            token = LoginTwoFactorToken.objects.select_related(
                "user", "user__profile"
            ).get(token=token_value)
        except LoginTwoFactorToken.DoesNotExist as exc:
            raise AuthenticationFailed(
                "Two-factor challenge could not be found."
            ) from exc

        if token.consumed_at is not None or token.is_expired:
            return Response(
                {"detail": "This verification code has expired."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if token.has_exhausted_attempts:
            return Response(
                {"detail": "Too many incorrect attempts. Please sign in again."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not token.matches(otp):
            token.record_failure()
            return Response(
                {"detail": "Invalid verification code."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = token.user
        if not getattr(user, "profile", None) or not user.profile.email_verified:
            return Response(
                {"detail": "Email address has not been verified."},
                status=status.HTTP_403_FORBIDDEN,
            )

        token.mark_used()
        LoginTwoFactorToken.objects.filter(user=user, consumed_at__isnull=True).exclude(
            pk=token.pk
        ).update(consumed_at=timezone.now())

        login(request, user, backend="django.contrib.auth.backends.ModelBackend")
        return Response(SessionSerializer(user).data, status=status.HTTP_200_OK)


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request: Request) -> Response:
        all_sessions = bool(request.data.get("all_sessions"))
        if all_sessions:
            self._remove_all_sessions(request.user)
        logout(request)
        response = Response(status=status.HTTP_204_NO_CONTENT)
        response.delete_cookie(settings.SESSION_COOKIE_NAME)
        return response

    def _remove_all_sessions(self, user: User) -> None:
        active_sessions = Session.objects.filter(expire_date__gte=timezone.now())
        user_id = str(user.pk)
        for session in active_sessions:
            data = session.get_decoded()
            if data.get("_auth_user_id") == user_id:
                session.delete()


class SessionView(APIView):
    permission_classes = [AllowAny]

    def get(self, request: Request) -> Response:
        if not request.user.is_authenticated:
            return Response(
                {"detail": "Authentication required."},
                status=status.HTTP_401_UNAUTHORIZED,
            )
        return Response(SessionSerializer(request.user).data, status=status.HTTP_200_OK)


@method_decorator(ensure_csrf_cookie, name="dispatch")
class CSRFTokenView(APIView):
    permission_classes = [AllowAny]

    def get(self, request: Request) -> Response:
        token = request.META.get("CSRF_COOKIE", "")
        return Response({"csrfToken": token})


class MeProfileView(generics.RetrieveUpdateAPIView):
    serializer_class = UserProfileSerializer
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get_object(self):
        return self.request.user.profile

    def get_serializer_context(
        self,
    ):  # pragma: no cover - DRF base ensures coverage complexity
        context = super().get_serializer_context()
        context.setdefault("request", self.request)
        return context


class PasswordResetRequestView(APIView):
    serializer_class = PasswordResetRequestSerializer
    permission_classes = [permissions.AllowAny]

    def post(self, request, *args, **kwargs):
        serializer = self.serializer_class(
            data=request.data, context={"request": request}
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(status=status.HTTP_202_ACCEPTED)


class PasswordResetConfirmView(APIView):
    serializer_class = PasswordResetConfirmSerializer
    permission_classes = [permissions.AllowAny]

    def post(self, request, *args, **kwargs):
        serializer = self.serializer_class(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(status=status.HTTP_204_NO_CONTENT)


class PublicUserProfileView(APIView):
    """Public profile view showing user badges, stats, and recent activity"""

    permission_classes = [permissions.AllowAny]

    def get(self, request, username: str) -> Response:
        from .services import (
            get_user_badge_progress,
            get_or_create_user_stats,
            get_user_trail_analytics,
        )

        # Find user by username
        try:
            user = User.objects.select_related("profile", "stats").get(
                username=username
            )
        except User.DoesNotExist:
            return Response(
                {"detail": "User not found"}, status=status.HTTP_404_NOT_FOUND
            )

        # Ensure stats exist
        stats = get_or_create_user_stats(user)

        # Get badge progress
        badge_data = get_user_badge_progress(user)
        all_badges = badge_data["awarded"] + badge_data["in_progress"]

        # Get recent trails created by the user (approved trails only)
        recent_trails_qs = Trail.objects.filter(
            submitted_by=user,
            approval_state="approved"
        ).order_by("-submitted_at")[:5]

        recent_trails = [
            {
                "id": trail.id,
                "title": trail.name,
                "distance_km": trail.distance_km,
                "difficulty": trail.get_difficulty_display(),
                "created_at": trail.submitted_at.isoformat() if trail.submitted_at else None,
            }
            for trail in recent_trails_qs
        ]

        # Get pending trails (only visible to the profile owner)
        pending_trails = []
        is_own_profile = request.user.is_authenticated and request.user == user
        if is_own_profile:
            pending_trails_qs = Trail.objects.filter(
                submitted_by=user,
                approval_state="pending"
            ).order_by("-submitted_at")

            pending_trails = [
                {
                    "id": trail.id,
                    "title": trail.name,
                    "distance_km": trail.distance_km,
                    "difficulty": trail.get_difficulty_display(),
                    "submitted_at": trail.submitted_at.isoformat() if trail.submitted_at else None,
                    "approval_state": trail.approval_state,
                }
                for trail in pending_trails_qs
            ]

        # Build serializer context
        analytics = get_user_trail_analytics(user)

        context = {
            "request": request,
            "badges": all_badges,
            "recent_trails": recent_trails,
            "pending_trails": pending_trails,
            "analytics": analytics,
        }

        serializer = PublicUserProfileSerializer(user.profile, context=context)
        return Response(serializer.data, status=status.HTTP_200_OK)


class MyBookmarksView(APIView):
    """List all trails bookmarked by the current user"""

    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        from trails.models import Bookmark
        from trails.serializers import TrailSerializer

        # Get all bookmarks for the current user
        bookmarks = Bookmark.objects.filter(user=request.user).select_related(
            "trail"
        ).order_by("-created_at")

        # Extract trails from bookmarks
        trails = [bookmark.trail for bookmark in bookmarks]

        # Serialize trails with context
        serializer = TrailSerializer(trails, many=True, context={"request": request})

        return Response(serializer.data, status=status.HTTP_200_OK)


class AdminDashboardView(APIView):
    permission_classes = [IsAuthenticated, IsAdminUser]

    def get(self, request: Request) -> Response:
        now = timezone.now()
        since = now - timedelta(days=7)

        total_users = User.objects.count()
        new_users = User.objects.filter(date_joined__gte=since).count()
        pending_submissions = Trail.objects.filter(approval_state="pending").count()
        published_trails = Trail.objects.filter(approval_state="approved").count()
        active_comments = Comment.objects.filter(is_deleted=False).count()

        latest_users = User.objects.select_related("profile").order_by("-date_joined")[
            :5
        ]
        latest_submissions = (
            Trail.objects.select_related("submitted_by", "submitted_by__profile")
            .filter(submitted_by__isnull=False)
            .order_by("-submitted_at")[:5]
        )
        latest_comments = Comment.objects.select_related(
            "author", "author__profile", "trail"
        ).order_by("-created_at")[:5]

        dashboard = {
            "stats": {
                "total_users": total_users,
                "new_users_last_7_days": new_users,
                "pending_trail_submissions": pending_submissions,
                "published_trails": published_trails,
                "active_comments": active_comments,
            },
            "permissions": {
                "can_manage_users": True,
                "can_moderate_comments": True,
                "can_review_trail_submissions": True,
            },
            "recent": {
                "new_users": AdminUserSerializer(latest_users, many=True).data,
                "trail_submissions": AdminTrailModerationSerializer(
                    latest_submissions, many=True
                ).data,
                "comments": AdminCommentSerializer(latest_comments, many=True).data,
            },
        }
        return Response(dashboard, status=status.HTTP_200_OK)


class AdminUserListView(generics.ListAPIView):
    serializer_class = AdminUserSerializer
    permission_classes = [IsAuthenticated, IsAdminUser]
    queryset = User.objects.select_related("profile").order_by("username")
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["username", "email", "profile__display_name"]
    ordering_fields = ["username", "date_joined", "last_login"]
    ordering = ["username"]


class AdminUserDetailView(generics.RetrieveUpdateAPIView):
    serializer_class = AdminUserSerializer
    permission_classes = [IsAuthenticated, IsAdminUser]
    queryset = User.objects.select_related("profile")


class AdminTrailSubmissionViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = AdminTrailModerationSerializer
    permission_classes = [IsAuthenticated, IsAdminUser]
    queryset = Trail.objects.select_related(
        "submitted_by", "submitted_by__profile"
    ).order_by("-submitted_at")
    filter_backends = [filters.SearchFilter]
    search_fields = [
        "name",
        "slug",
        "submitted_by__username",
        "submitted_by__profile__display_name",
    ]

    def get_queryset(self):
        queryset = super().get_queryset()
        status_param = self.request.query_params.get("status")
        valid_statuses = {choice[0] for choice in Trail.APPROVAL_CHOICES}
        if status_param in valid_statuses:
            queryset = queryset.filter(approval_state=status_param)
        return queryset

    @action(detail=True, methods=["post"], url_path="approve")
    def approve(self, request: Request, pk=None) -> Response:
        submission = self.get_object()
        submission.approval_state = "approved"
        submission.save(update_fields=["approval_state"])
        return Response(self.get_serializer(submission).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="reject")
    def reject(self, request: Request, pk=None) -> Response:
        submission = self.get_object()
        submission.approval_state = "rejected"
        submission.save(update_fields=["approval_state"])
        return Response(self.get_serializer(submission).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="mark-reviewed")
    def mark_reviewed(self, request: Request, pk=None) -> Response:
        submission = self.get_object()
        submission.approval_state = "reviewed"
        submission.save(update_fields=["approval_state"])
        return Response(self.get_serializer(submission).data, status=status.HTTP_200_OK)


class AdminCommentModerationViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = AdminCommentSerializer
    permission_classes = [IsAuthenticated, IsAdminUser]
    queryset = Comment.objects.select_related(
        "author", "author__profile", "trail"
    ).order_by("-created_at")
    filter_backends = [filters.SearchFilter]
    search_fields = ["body", "author__username", "trail__name"]

    def get_queryset(self):
        queryset = super().get_queryset()
        status_param = self.request.query_params.get("status")
        if status_param == "deleted":
            return queryset.filter(is_deleted=True)
        if status_param == "active":
            return queryset.filter(is_deleted=False)
        return queryset
