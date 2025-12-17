from __future__ import annotations

from rest_framework.permissions import BasePermission

from .models import UserProfile


class IsAdminUser(BasePermission):
    """
    Allows access only to authenticated users with an admin role.
    """

    message = "Admin role required to access this endpoint."

    def has_permission(self, request, view) -> bool:
        user = getattr(request, "user", None)
        if not user or not getattr(user, "is_authenticated", False):
            return False
        try:
            profile: UserProfile = user.profile
        except UserProfile.DoesNotExist:
            return False
        return profile.role == UserProfile.Role.ADMIN


__all__ = ["IsAdminUser"]
