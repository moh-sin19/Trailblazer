import uuid
from typing import Any, Optional

from django.utils import timezone
from django.utils.text import slugify
from rest_framework import serializers

from .models import Comment, CommentReaction, Trail, TrailCategory, TrailPhoto
from .services.route_processing import PreparedRoute, prepare_route


class AuthorSerializer(serializers.Serializer):
    id = serializers.IntegerField(read_only=True)
    username = serializers.CharField(read_only=True)
    display_name = serializers.CharField(read_only=True)

    def to_representation(self, instance: Any) -> dict[str, Any]:
        username = getattr(
            instance, "get_username", lambda: getattr(instance, "username", "")
        )()
        full_name = getattr(instance, "get_full_name", lambda: "")()
        display_name = full_name.strip() or username
        return {
            "id": instance.pk,
            "username": username,
            "display_name": display_name,
        }


class CommentSerializer(serializers.ModelSerializer):
    author = AuthorSerializer(read_only=True)
    replies = serializers.SerializerMethodField()
    helpful_count = serializers.SerializerMethodField()
    viewer_reaction = serializers.SerializerMethodField()
    is_owner = serializers.SerializerMethodField()

    class Meta:
        model = Comment
        fields = [
            "id",
            "trail",
            "parent",
            "body",
            "rating",
            "created_at",
            "updated_at",
            "edited_at",
            "is_deleted",
            "author",
            "replies",
            "helpful_count",
            "viewer_reaction",
            "is_owner",
        ]
        read_only_fields = [
            "id",
            "trail",
            "created_at",
            "updated_at",
            "edited_at",
            "is_deleted",
            "author",
            "replies",
            "helpful_count",
            "viewer_reaction",
            "is_owner",
        ]

    def get_replies(self, obj: Comment) -> list[dict[str, Any]]:
        request = self.context.get("request")
        serializer = CommentSerializer(
            obj.replies.filter(is_deleted=False).order_by("created_at"),
            many=True,
            context={"request": request},
        )
        return serializer.data

    def get_helpful_count(self, obj: Comment) -> int:
        return (
            getattr(obj, "helpful_count", None)
            or obj.reactions.filter(kind=CommentReaction.LIKE).count()
        )

    def get_viewer_reaction(self, obj: Comment) -> str | None:
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not user or not getattr(user, "is_authenticated", False):
            return None
        reaction = obj.reactions.filter(user=user).first()
        return reaction.kind if reaction else None

    def get_is_owner(self, obj: Comment) -> bool:
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not user or not getattr(user, "is_authenticated", False):
            return False
        return obj.author_id == user.id

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        attrs = super().validate(attrs)
        body = attrs.get("body", getattr(self.instance, "body", ""))
        rating = attrs.get("rating", getattr(self.instance, "rating", None))
        if (not body or not body.strip()) and rating is None:
            raise serializers.ValidationError("Provide comment text or a rating.")
        if body and len(body) > 1000:
            raise serializers.ValidationError(
                "Comments may not exceed 1,000 characters."
            )
        return attrs

    def create(self, validated_data: dict[str, Any]) -> Comment:
        request = self.context["request"]
        validated_data["author"] = request.user
        validated_data.setdefault("body", "")
        comment = Comment.objects.create(**validated_data)
        return comment

    def update(self, instance: Comment, validated_data: dict[str, Any]) -> Comment:
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.edited_at = timezone.now()
        instance.save(
            update_fields=[
                "body",
                "rating",
                "edited_at",
                "updated_at",
            ]
        )
        return instance


class TrailCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = TrailCategory
        fields = ("id", "name", "slug")


class TrailPhotoSerializer(serializers.ModelSerializer):
    uploader = AuthorSerializer(read_only=True)
    image = serializers.ImageField(write_only=True, required=True)
    image_url = serializers.SerializerMethodField()

    class Meta:
        model = TrailPhoto
        fields = (
            "id",
            "trail",
            "uploader",
            "image",
            "image_url",
            "caption",
            "is_primary",
            "uploaded_at",
        )
        read_only_fields = ("id", "trail", "uploader", "uploaded_at", "image_url")

    def get_image_url(self, obj: TrailPhoto) -> str | None:
        if not obj.image:
            return None
        request = self.context.get("request")
        url = obj.image.url
        if request:
            return request.build_absolute_uri(url)
        return url

    def validate_image(self, value):
        if value is None:
            raise serializers.ValidationError("Image file is required.")

        # Validate content type
        content_type = getattr(value, "content_type", "")
        allowed_types = ["image/jpeg", "image/png", "image/webp"]
        if content_type not in allowed_types:
            raise serializers.ValidationError(
                "Only JPEG, PNG, and WebP images are allowed."
            )

        # Validate file size (max 10 MB as per requirements)
        if value.size > 10 * 1024 * 1024:
            raise serializers.ValidationError("File size must be less than 10MB.")

        return value

    def create(self, validated_data: dict[str, Any]) -> TrailPhoto:
        request = self.context.get("request")
        user = getattr(request, "user", None)
        validated_data["uploader"] = user

        # If this is set as primary, unset any existing primary photo for the trail
        if validated_data.get("is_primary", False):
            trail = validated_data["trail"]
            TrailPhoto.objects.filter(trail=trail, is_primary=True).update(is_primary=False)

        return super().create(validated_data)

    def update(self, instance: TrailPhoto, validated_data: dict[str, Any]) -> TrailPhoto:
        # If setting this as primary, unset any existing primary photo for the trail
        if validated_data.get("is_primary", False) and not instance.is_primary:
            TrailPhoto.objects.filter(
                trail=instance.trail, is_primary=True
            ).exclude(id=instance.id).update(is_primary=False)

        return super().update(instance, validated_data)


class TrailSerializer(serializers.ModelSerializer):
    categories = TrailCategorySerializer(many=True, read_only=True)
    category_ids = serializers.PrimaryKeyRelatedField(
        source="categories",
        queryset=TrailCategory.objects.all(),
        many=True,
        required=False,
        write_only=True,
    )
    segments = serializers.SerializerMethodField()
    start = serializers.SerializerMethodField()
    average_rating = serializers.SerializerMethodField()
    viewer_has_completed = serializers.SerializerMethodField()
    viewer_has_bookmarked = serializers.SerializerMethodField()
    photos = serializers.SerializerMethodField()
    primary_photo = serializers.SerializerMethodField()
    submitted_by = serializers.SerializerMethodField()

    class Meta:
        model = Trail
        fields = (
            "id",
            "slug",
            "name",
            "description",
            "difficulty",
            "distance_km",
            "duration_mins",
            "elev_gain_m",
            "latitude",
            "longitude",
            "city",
            "country",
            "approval_state",
            "rating_avg",
            "rating_count",
            "categories",
            "category_ids",
            "segments",
            "start",
            "comment_count",
            "rating_sum",
            "save_count",
            "view_count",
            "average_rating",
            "viewer_has_completed",
            "viewer_has_bookmarked",
            "photos",
            "primary_photo",
            "submitted_by",
        )
        read_only_fields = [
            "comment_count",
            "rating_count",
            "rating_sum",
            "save_count",
            "view_count",
            "average_rating",
        ]

    def create(self, validated_data):
        categories = validated_data.pop("categories", [])
        trail = super().create(validated_data)
        if categories:
            trail.categories.set(categories)
        return trail

    def update(self, instance, validated_data):
        categories = validated_data.pop("categories", None)
        trail = super().update(instance, validated_data)
        if categories is not None:
            trail.categories.set(categories)
        return trail

    def get_viewer_has_completed(self, obj: Trail) -> bool:
        annotated_value = getattr(obj, "viewer_has_completed", None)
        if annotated_value is not None:
            return bool(annotated_value)
        request = self.context.get("request")
        user = getattr(request, "user", None) if request else None
        if not user or not getattr(user, "is_authenticated", False):
            return False
        return obj.completions.filter(user=user).exists()

    def get_viewer_has_bookmarked(self, obj: Trail) -> bool:
        annotated_value = getattr(obj, "viewer_has_bookmarked", None)
        if annotated_value is not None:
            return bool(annotated_value)
        request = self.context.get("request")
        user = getattr(request, "user", None) if request else None
        if not user or not getattr(user, "is_authenticated", False):
            return False
        return obj.bookmarks.filter(user=user).exists()

    def get_segments(self, obj: Trail):
        """Return segments from route_path"""
        if not obj.route_path:
            return []
        segments = []
        for segment in obj.route_path:
            if not isinstance(segment, list):
                continue
            segment_coords = []
            for point in segment:
                if not isinstance(point, dict):
                    continue
                lat = point.get("lat")
                lng = point.get("lng")
                if lat is None or lng is None:
                    continue
                segment_coords.append({"lat": float(lat), "lng": float(lng)})
            if segment_coords:
                segments.append(segment_coords)
        return segments

    def get_start(self, obj: Trail):
        """Get first point from segments"""
        segments = self.get_segments(obj)
        if segments and segments[0]:
            return segments[0][0]
        if obj.latitude is not None and obj.longitude is not None:
            return {"lat": float(obj.latitude), "lng": float(obj.longitude)}
        return None

    def get_average_rating(self, obj: Trail) -> Optional[float]:
        return obj.average_rating

    def get_photos(self, obj: Trail) -> list[dict[str, Any]]:
        """Return all photos for the trail"""
        photos = obj.photos.all()
        return TrailPhotoSerializer(
            photos, many=True, context=self.context
        ).data

    def get_primary_photo(self, obj: Trail) -> dict[str, Any] | None:
        """Return the primary photo for the trail"""
        primary = obj.photos.filter(is_primary=True).first()
        if primary:
            return TrailPhotoSerializer(primary, context=self.context).data
        return None

    def get_submitted_by(self, obj: Trail) -> dict[str, Any] | None:
        """Return the author who submitted the trail"""
        if obj.submitted_by:
            return AuthorSerializer(obj.submitted_by).data
        return None


class LatLngField(serializers.Field):
    """Validates latitude/longitude pair dictionaries."""

    def to_internal_value(self, data):
        # Handle JSON string from FormData
        if isinstance(data, str):
            import json
            try:
                data = json.loads(data)
            except json.JSONDecodeError:
                raise serializers.ValidationError(
                    "Point must be valid JSON or an object with lat and lng."
                )

        if not isinstance(data, dict):
            raise serializers.ValidationError(
                "Point must be an object with lat and lng."
            )
        lat = data.get("lat")
        lng = data.get("lng")
        if lat is None or lng is None:
            raise serializers.ValidationError("Both lat and lng are required.")
        try:
            lat = float(lat)
            lng = float(lng)
        except (ValueError, TypeError):
            raise serializers.ValidationError("lat and lng must be numbers.")
        if lat < -90 or lat > 90:
            raise serializers.ValidationError("lat must be between -90 and 90 degrees.")
        if lng < -180 or lng > 180:
            raise serializers.ValidationError(
                "lng must be between -180 and 180 degrees."
            )
        return {"lat": lat, "lng": lng}

    def to_representation(self, value):
        if isinstance(value, dict):
            lat = value.get("lat")
            lng = value.get("lng")
            if lat is None or lng is None:
                return value
            return {"lat": float(lat), "lng": float(lng)}
        return value


class SegmentsField(serializers.Field):
    """Accepts a list of segments, each containing ordered lat/lng points."""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.point_field = LatLngField()

    def to_internal_value(self, data):
        # Handle JSON string from FormData
        if isinstance(data, str):
            import json
            try:
                data = json.loads(data)
            except json.JSONDecodeError:
                raise serializers.ValidationError("segments must be valid JSON or a non-empty list.")

        if not isinstance(data, list) or not data:
            raise serializers.ValidationError("segments must be a non-empty list.")

        cleaned_segments = []
        for index, segment in enumerate(data):
            if not isinstance(segment, list):
                raise serializers.ValidationError(
                    f"Segment {index + 1} must be a list of points."
                )
            cleaned_points = []
            for point in segment:
                cleaned_points.append(self.point_field.to_internal_value(point))
            if len(cleaned_points) >= 2:
                cleaned_segments.append(cleaned_points)

        if not cleaned_segments:
            raise serializers.ValidationError(
                "Provide at least one segment with two or more points."
            )

        return cleaned_segments

    def to_representation(self, value):
        if not isinstance(value, list):
            return []
        return [
            [self.point_field.to_representation(point) for point in segment]
            for segment in value
        ]


class TrailProposalSerializer(serializers.ModelSerializer):
    segments = SegmentsField(write_only=True)
    start = LatLngField(write_only=True)
    expected_time_h = serializers.FloatField(required=False, allow_null=True)
    total_points = serializers.IntegerField(read_only=True)
    status = serializers.CharField(source="approval_state", read_only=True)
    submitted_at = serializers.DateTimeField(read_only=True)
    photos = serializers.SerializerMethodField()

    class Meta:
        model = Trail
        fields = [
            "id",
            "name",
            "difficulty",
            "distance_km",
            "elev_gain_m",
            "expected_time_h",
            "description",
            "start",
            "segments",
            "total_points",
            "status",
            "submitted_at",
            "photos",
        ]
        read_only_fields = [
            "distance_km",
            "total_points",
            "status",
            "submitted_at",
            "photos",
        ]

    def get_photos(self, obj: Trail) -> list[dict[str, Any]]:
        """Return all photos for the trail submission"""
        photos = obj.photos.all()
        return TrailPhotoSerializer(
            photos, many=True, context=self.context
        ).data

    def validate_expected_time_h(self, value: float | None) -> float:
        if value is None:
            return 0.0
        try:
            value = float(value)
        except (TypeError, ValueError):
            raise serializers.ValidationError("expected_time_h must be a number.")
        if value < 0:
            raise serializers.ValidationError("expected_time_h cannot be negative.")
        return value

    def validate_elev_gain_m(self, value: int | None) -> int:
        if value is None:
            return 0
        try:
            value = int(value)
        except (TypeError, ValueError):
            raise serializers.ValidationError("elevation_gain_m must be an integer.")
        if value < 0:
            raise serializers.ValidationError("elevation_gain_m cannot be negative.")
        return value

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        attrs = super().validate(attrs)
        segments = attrs.pop("segments", None)
        if not segments:
            raise serializers.ValidationError({
                "segments": "Provide at least one segment."
            })

        try:
            prepared_route = prepare_route(segments)
        except ValueError as exc:
            raise serializers.ValidationError({"segments": str(exc)})

        attrs.pop("start", None)

        expected_time_h = attrs.pop("expected_time_h", 0.0) or 0.0

        attrs["route_path"] = prepared_route.segments
        attrs["distance_km"] = round(prepared_route.total_distance_km, 2)
        attrs["duration_mins"] = int(round(max(0.0, float(expected_time_h)) * 60))
        attrs["approval_state"] = "pending"
        self._prepared_route: PreparedRoute | None = prepared_route
        return attrs

    def create(self, validated_data: dict[str, Any]) -> Trail:
        from .services.geolookup import reverse_geocode

        name = validated_data["name"].strip()
        slug_candidate = slugify(name) or f"trail-{uuid.uuid4().hex[:8]}"
        slug = slug_candidate
        index = 1
        while Trail.objects.filter(slug=slug).exists():
            slug = f"{slug_candidate}-{index}"  # pragma: no cover - rare collision handling
            index += 1

        request = self.context.get("request")
        user = getattr(request, "user", None)
        # Ensure any submitted_by passed through validated data does not conflict with explicit argument
        validated_data.pop("submitted_by", None)

        route_kwargs: dict[str, Any] = {}
        prepared = getattr(self, "_prepared_route", None)
        if isinstance(prepared, PreparedRoute):
            route_kwargs["route_geometry"] = prepared.geometry
            if prepared.start_point:
                route_kwargs["latitude"] = prepared.start_point["lat"]
                route_kwargs["longitude"] = prepared.start_point["lng"]

                # Perform reverse geocoding to get city and country
                location = reverse_geocode(
                    prepared.start_point["lat"], prepared.start_point["lng"]
                )
                if location.get("city"):
                    route_kwargs["city"] = location["city"]
                if location.get("country"):
                    route_kwargs["country"] = location["country"]

        trail = Trail.objects.create(
            slug=slug,
            submitted_by=user
            if user and getattr(user, "is_authenticated", False)
            else None,
            **validated_data,
            **route_kwargs,
        )
        return trail

    def to_representation(self, instance: Trail) -> dict[str, Any]:
        data = super().to_representation(instance)
        segments = SegmentsField().to_representation(instance.route_path)
        data["segments"] = segments
        data["start"] = self._serialise_start(segments)
        data["expected_time_h"] = round((instance.duration_mins or 0) / 60, 2)
        data["status"] = instance.approval_state
        data["submitted_at"] = (
            instance.submitted_at.isoformat() if instance.submitted_at else None
        )
        data["total_points"] = sum(len(segment) for segment in segments)
        data["distance_km"] = instance.distance_km
        return data

    def _serialise_start(
        self, segments: list[list[dict[str, float]]]
    ) -> dict[str, float]:
        for segment in segments:
            if segment:
                point = segment[0]
                return {"lat": float(point["lat"]), "lng": float(point["lng"])}
        return {"lat": 0.0, "lng": 0.0}


class TrailFitRequestSerializer(serializers.Serializer):
    segments = SegmentsField()

    def validate_segments(
        self, value: list[list[dict[str, float]]]
    ) -> list[list[dict[str, float]]]:
        if not value:
            raise serializers.ValidationError("Provide at least one segment to fit.")
        if all(len(segment) < 2 for segment in value):
            raise serializers.ValidationError(
                "Each segment must contain at least two points."
            )
        return value


class TrailFitResponseSerializer(serializers.Serializer):
    segments = SegmentsField()
    total_points = serializers.IntegerField()
    total_distance_km = serializers.FloatField()
    start = LatLngField()
