from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0004_userstats_distance_hiked_km"),
    ]

    operations = [
        migrations.AddField(
            model_name="userprofile",
            name="role",
            field=models.CharField(
                choices=[("standard", "Standard"), ("admin", "Admin")],
                default="standard",
                help_text="Controls access to admin dashboard features.",
                max_length=16,
            ),
        ),
    ]
