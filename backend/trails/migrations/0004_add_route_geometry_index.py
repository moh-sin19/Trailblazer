# Manual migration to add spatial index on route_geometry field

from django.contrib.postgres.operations import CreateExtension
from django.db import migrations


class PostgresRunSQL(migrations.RunSQL):
    def database_forwards(self, app_label, schema_editor, from_state, to_state):
        if schema_editor.connection.vendor != "postgresql":
            return
        super().database_forwards(app_label, schema_editor, from_state, to_state)

    def database_backwards(self, app_label, schema_editor, from_state, to_state):
        if schema_editor.connection.vendor != "postgresql":
            return
        super().database_backwards(app_label, schema_editor, from_state, to_state)


class Migration(migrations.Migration):

    dependencies = [
        ('trails', '0003_trail_route_geometry'),
    ]

    operations = [
        # Ensure PostGIS extension is enabled
        CreateExtension('postgis'),
        # Add spatial index on route_geometry field for faster bbox queries
        PostgresRunSQL(
            sql="CREATE INDEX IF NOT EXISTS trails_trail_route_geometry_idx ON trails_trail USING GIST (route_geometry);",
            reverse_sql="DROP INDEX IF EXISTS trails_trail_route_geometry_idx;",
        ),
    ]
