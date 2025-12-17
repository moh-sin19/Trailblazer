from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    AdminCommentModerationViewSet,
    AdminDashboardView,
    AdminTrailSubmissionViewSet,
    AdminUserDetailView,
    AdminUserListView,
    CSRFTokenView,
    EmailVerificationView,
    LoginView,
    LogoutView,
    MeProfileView,
    MyBookmarksView,
    PasswordResetConfirmView,
    PasswordResetRequestView,
    PublicUserProfileView,
    RegistrationView,
    SessionView,
)

admin_router = DefaultRouter()
admin_router.register(r"admin/trail-submissions", AdminTrailSubmissionViewSet, basename="admin-trail-submission")
admin_router.register(r"admin/comments", AdminCommentModerationViewSet, basename="admin-comment")

urlpatterns = [
    path("auth/register/", RegistrationView.as_view(), name="auth-register"),
    path("auth/verify-email/", EmailVerificationView.as_view(), name="auth-verify-email"),
    path("auth/login/", LoginView.as_view(), name="auth-login"),
    path("auth/logout/", LogoutView.as_view(), name="auth-logout"),
    path("auth/session/", SessionView.as_view(), name="auth-session"),
    path("auth/csrf/", CSRFTokenView.as_view(), name="auth-csrf"),
    path("profile/me/", MeProfileView.as_view(), name="profile-me"),
    path("profile/me/bookmarks/", MyBookmarksView.as_view(), name="my-bookmarks"),
    path("profiles/<str:username>/", PublicUserProfileView.as_view(), name="public-profile"),
    path("auth/password-reset/", PasswordResetRequestView.as_view(), name="password-reset-request"),
    path("auth/password-reset/confirm/", PasswordResetConfirmView.as_view(), name="password-reset-confirm"),
    path("admin/dashboard/", AdminDashboardView.as_view(), name="admin-dashboard"),
    path("admin/users/", AdminUserListView.as_view(), name="admin-users"),
    path("admin/users/<int:pk>/", AdminUserDetailView.as_view(), name="admin-user-detail"),
]

urlpatterns += [path("", include(admin_router.urls))]
