from typing import Optional

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import Q

from .gis_compat import get_gis_models

gis_models = get_gis_models()


class TrailCategory(models.Model):
    name = models.CharField(max_length=80, unique=True)
    slug = models.SlugField(unique=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:  # pragma: no cover - trivial
        return self.name


class Trail(models.Model):
    DIFFICULTY_CHOICES = (
        ("easy", "Easy"),
        ("moderate", "Moderate"),
        ("hard", "Hard"),
    )

    APPROVAL_CHOICES = (
        ("pending", "Pending"),
        ("reviewed", "Reviewed"),
        ("approved", "Approved"),
        ("rejected", "Rejected"),
    )

    slug = models.SlugField(unique=True)
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    difficulty = models.CharField(
        max_length=16, choices=DIFFICULTY_CHOICES, default="moderate"
    )
    distance_km = models.FloatField(default=0)
    duration_mins = models.IntegerField(default=0)
    elev_gain_m = models.IntegerField(default=0)
    latitude = models.FloatField(
        null=True,
        blank=True,
        validators=[MinValueValidator(-90.0), MaxValueValidator(90.0)],
    )
    longitude = models.FloatField(
        null=True,
        blank=True,
        validators=[MinValueValidator(-180.0), MaxValueValidator(180.0)],
    )
    city = models.CharField(max_length=80, blank=True)
    country = models.CharField(max_length=80, blank=True)
    approval_state = models.CharField(
        max_length=16,
        choices=APPROVAL_CHOICES,
        default="pending",
    )
    rating_avg = models.FloatField(default=0)
    rating_count = models.IntegerField(default=0)
    categories = models.ManyToManyField(
        TrailCategory, related_name="trails", blank=True
    )
    route_path = models.JSONField(
        default=list,
        blank=True,
        help_text="Ordered list of {lat, lng} dictionaries describing the trail path.",
    )
    route_geometry = gis_models.MultiLineStringField(
        null=True,
        blank=True,
        srid=4326,
        help_text="PostGIS geometry representing the trail route for spatial queries.",
    )
    # Comment/rating system fields
    comment_count = models.PositiveIntegerField(default=0)
    rating_sum = models.PositiveIntegerField(default=0)
    save_count = models.PositiveIntegerField(default=0)
    view_count = models.PositiveIntegerField(default=0)
    submitted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="trails_submitted",
    )
    submitted_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:  # pragma: no cover - trivial
        return self.name

    @property
    def average_rating(self) -> Optional[float]:
        if self.rating_count == 0:
            return None
        return round(self.rating_sum / self.rating_count, 2)


class Comment(models.Model):
    trail = models.ForeignKey(Trail, on_delete=models.CASCADE, related_name="comments")
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="trail_comments",
    )
    parent = models.ForeignKey(
        "self",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="replies",
    )
    body = models.TextField(max_length=1000, blank=True, default="")
    rating = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        validators=[MinValueValidator(1), MaxValueValidator(5)],
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    edited_at = models.DateTimeField(null=True, blank=True)
    is_deleted = models.BooleanField(default=False)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["trail", "author"],
                condition=Q(rating__isnull=False),
                name="unique_trail_rating_per_user",
            ),
        ]

    def __str__(self):
        return f"Comment by {self.author} on {self.trail}"

    @property
    def has_body(self) -> bool:
        return bool(self.body.strip())


class CommentReaction(models.Model):
    LIKE = "like"
    KINDS = ((LIKE, "Like"),)

    comment = models.ForeignKey(
        Comment, on_delete=models.CASCADE, related_name="reactions"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="comment_reactions",
    )
    kind = models.CharField(max_length=16, choices=KINDS, default=LIKE)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("comment", "user", "kind")

    def __str__(self):
        return f"{self.user} {self.kind} {self.comment_id}"


class TrailCompletion(models.Model):
    """Record of trails completed by users"""

    trail = models.ForeignKey(
        Trail,
        on_delete=models.CASCADE,
        related_name="completions",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="trail_completions",
    )
    completed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("trail", "user")
        ordering = ["-completed_at"]

    def __str__(self):
        return f"{self.user} completed {self.trail.name}"


class Bookmark(models.Model):
    """Record of trails bookmarked/saved by users"""

    trail = models.ForeignKey(
        Trail,
        on_delete=models.CASCADE,
        related_name="bookmarks",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="trail_bookmarks",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("trail", "user")
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.user} bookmarked {self.trail.name}"


class TrailPhoto(models.Model):
    """Photos uploaded for trails"""

    trail = models.ForeignKey(
        Trail,
        on_delete=models.CASCADE,
        related_name="photos",
    )
    uploader = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="trail_photos",
    )
    image = models.ImageField(upload_to="trail_photos/")
    caption = models.CharField(max_length=140, blank=True)
    is_primary = models.BooleanField(default=False)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-is_primary", "-uploaded_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["trail"],
                condition=Q(is_primary=True),
                name="one_primary_photo_per_trail",
            )
        ]

    def __str__(self):
        primary_str = " (primary)" if self.is_primary else ""
        return f"Photo for {self.trail.name} by {self.uploader}{primary_str}"


class TrailView(models.Model):
    """Track unique views of trails with deduplication by IP and user"""

    trail = models.ForeignKey(
        Trail,
        on_delete=models.CASCADE,
        related_name="views",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="trail_views",
    )
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    viewed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-viewed_at"]
        indexes = [
            models.Index(fields=["trail", "user"]),
            models.Index(fields=["trail", "ip_address"]),
            models.Index(fields=["viewed_at"]),
        ]

    def __str__(self):
        viewer = self.user.username if self.user else self.ip_address
        return f"{viewer} viewed {self.trail.name}"
