from django.contrib import admin

from .models import EmailVerificationToken, UserProfile


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = ("user", "display_name", "email_verified", "created_at")
    search_fields = ("user__username", "user__email", "display_name")


@admin.register(EmailVerificationToken)
class EmailVerificationTokenAdmin(admin.ModelAdmin):
    list_display = ("user", "token", "created_at", "expires_at", "used_at")
    readonly_fields = ("token",)
    search_fields = ("user__username", "user__email", "token")
