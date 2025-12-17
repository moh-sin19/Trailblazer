from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("trails", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="trail",
            name="route_path",
            field=models.JSONField(
                blank=True,
                default=list,
                help_text="Ordered list of {lat, lng} dictionaries describing the trail path.",
            ),
        ),
    ]
