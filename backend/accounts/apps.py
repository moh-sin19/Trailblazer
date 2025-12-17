from django.apps import AppConfig


class AccountsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "accounts"

    def ready(self) -> None:  # pragma: no cover - import side effect only
        # Import signal handlers on app ready to ensure profile auto-creation.
        from . import signals  # noqa: F401
