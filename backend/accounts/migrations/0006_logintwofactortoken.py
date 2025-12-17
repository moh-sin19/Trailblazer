from django.db import migrations, models
import django.utils.timezone
import uuid

class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0005_userprofile_role"),
    ]

    operations = [
        migrations.CreateModel(
            name="LoginTwoFactorToken",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("token", models.UUIDField(default=uuid.uuid4, unique=True)),
                ("code", models.CharField(max_length=6)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("expires_at", models.DateTimeField()),
                ("consumed_at", models.DateTimeField(blank=True, null=True)),
                ("failed_attempts", models.PositiveSmallIntegerField(default=0)),
                ("user", models.ForeignKey(on_delete=models.CASCADE, related_name="two_factor_tokens", to="auth.user")),
            ],
        ),
        migrations.AddIndex(
            model_name="logintwofactortoken",
            index=models.Index(fields=["user", "token"], name="accounts_login_token_idx"),
        ),
    ]
