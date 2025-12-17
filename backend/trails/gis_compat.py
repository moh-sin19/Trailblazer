"""Utility helpers to make GIS models optional during tests.

If GDAL is not available in the execution environment, importing
``django.contrib.gis`` raises ``ImproperlyConfigured``. For our tests we only
need a ``MultiLineStringField`` on the Trail model, so we provide a lightweight
JSON-backed fallback to keep the ORM functional.
"""

from __future__ import annotations

import sys
import types
from typing import Tuple

from django.core.exceptions import ImproperlyConfigured
from django.db import models


def _create_fallback_modules() -> types.ModuleType:
    """Create stub modules that mimic the GIS API we rely on."""

    class MultiLineStringField(models.JSONField):
        description = "Fallback MultiLineString stored as JSON"

        def __init__(self, *args, **kwargs):
            kwargs.setdefault("default", list)
            kwargs.pop("srid", None)
            super().__init__(*args, **kwargs)

    fallback_models = types.ModuleType("django.contrib.gis.db.models")
    fallback_models.MultiLineStringField = MultiLineStringField

    fallback_fields = types.ModuleType("django.contrib.gis.db.models.fields")
    fallback_fields.MultiLineStringField = MultiLineStringField

    fallback_db = types.ModuleType("django.contrib.gis.db")
    fallback_db.models = fallback_models
    fallback_db.models.fields = fallback_fields

    fallback_pkg = sys.modules.setdefault("django.contrib.gis", types.ModuleType("django.contrib.gis"))
    setattr(fallback_pkg, "db", fallback_db)

    sys.modules.setdefault("django.contrib.gis.db", fallback_db)
    sys.modules["django.contrib.gis.db.models"] = fallback_models
    sys.modules["django.contrib.gis.db.models.fields"] = fallback_fields
    sys.modules.setdefault("django.contrib.gis.gdal", types.ModuleType("django.contrib.gis.gdal"))

    return fallback_models


try:
    from django.contrib.gis.db import models as _gis_models  # type: ignore
    GIS_AVAILABLE = True
except (ImproperlyConfigured, OSError):
    _gis_models = _create_fallback_modules()
    GIS_AVAILABLE = False


def get_gis_models():
    return _gis_models


__all__ = ["get_gis_models", "GIS_AVAILABLE"]
