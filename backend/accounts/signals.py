from django.contrib.auth import get_user_model
from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import UserProfile

User = get_user_model()


def _default_display_name(user: User) -> str:
    if user.first_name and user.last_name:
        return f"{user.first_name} {user.last_name}".strip()
    if user.first_name:
        return user.first_name
    if user.username:
        return user.username
    if user.email:
        return user.email.split("@", 1)[0]
    return "Trailblazer"


@receiver(post_save, sender=User)
def ensure_user_profile(sender, instance: User, created: bool, **_: object) -> None:
    """Ensure every user has an associated profile row."""
    if created:
        display_name = _default_display_name(instance)
        UserProfile.objects.get_or_create(
            user=instance,
            defaults={"display_name": display_name},
        )
    else:
        # Ensure profile exists even for existing users
        try:
            instance.profile
        except UserProfile.DoesNotExist:
            UserProfile.objects.create(user=instance, display_name=_default_display_name(instance))
