from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("trails", "0005_merge_20251024_0453"),
    ]

    operations = [
        migrations.CreateModel(
            name="TrailSubmission",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=200)),
                ("park", models.CharField(blank=True, max_length=200)),
                (
                    "difficulty",
                    models.CharField(
                        choices=[("easy", "Easy"), ("moderate", "Moderate"), ("hard", "Hard")],
                        default="moderate",
                        max_length=16,
                    ),
                ),
                ("distance_km", models.FloatField()),
                ("elevation_gain_m", models.IntegerField(default=0)),
                ("expected_time_h", models.FloatField(default=0)),
                ("public_transport", models.BooleanField(default=False)),
                ("dog_friendly", models.BooleanField(default=False)),
                ("description", models.TextField(blank=True)),
                (
                    "route_segments",
                    models.JSONField(
                        default=list,
                        help_text="Ordered list of route segments capturing the drawn trail.",
                    ),
                ),
                ("start", models.JSONField(help_text="Starting coordinate of the trail {lat, lng}.")),
                ("total_points", models.PositiveIntegerField(default=0)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("pending", "Pending"),
                            ("reviewed", "Reviewed"),
                            ("approved", "Approved"),
                            ("rejected", "Rejected"),
                        ],
                        default="pending",
                        max_length=16,
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "submitted_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="trail_submissions",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at"],
            },
        ),
    ]
