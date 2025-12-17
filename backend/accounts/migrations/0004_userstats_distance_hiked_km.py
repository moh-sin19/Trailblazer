from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0003_badge_userstats_badgeaward"),
    ]

    operations = [
        migrations.AddField(
            model_name="userstats",
            name="distance_hiked_km",
            field=models.FloatField(default=0),
        ),
    ]
