from django.contrib import admin
from .models import Trail, TrailCategory


@admin.register(Trail)
class TrailAdmin(admin.ModelAdmin):
    list_display = ("name", "difficulty", "distance_km", "approval_state", "submitted_by")
    search_fields = ("name", "slug", "city", "country", "park")
    list_filter = ("difficulty", "approval_state", "city", "country")
    filter_horizontal = ("categories",)


@admin.register(TrailCategory)
class TrailCategoryAdmin(admin.ModelAdmin):
    list_display = ("name", "slug")
    search_fields = ("name", "slug")
