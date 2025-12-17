from __future__ import annotations

from dataclasses import dataclass
from math import floor
from typing import Dict, Iterable, List, Optional, Tuple

from django.db import IntegrityError, transaction
from django.db.models import (
    BooleanField,
    Case,
    Count,
    Exists,
    IntegerField,
    Max,
    Min,
    OuterRef,
    Q,
    QuerySet,
    Value,
    When,
)
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.datastructures import MultiValueDict
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import APIException
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated, IsAuthenticatedOrReadOnly
from rest_framework.response import Response

from ..models import Bookmark, Comment, CommentReaction, Trail, TrailCategory, TrailCompletion, TrailPhoto, TrailView
from ..serializers import CommentSerializer, TrailSerializer, TrailCategorySerializer, TrailPhotoSerializer
from .common import sync_trail_stats
from ..gis_compat import GIS_AVAILABLE

if GIS_AVAILABLE:
    from django.contrib.gis.geos import Polygon
else:  # pragma: no cover - exercised when GIS stack missing (CI/test envs)

    class _PolygonStub:
        @staticmethod
        def from_bbox(bbox):
            return bbox

    Polygon = _PolygonStub  # type: ignore


class QueryParameterError(APIException):
    status_code = 422
    default_detail = "Invalid query parameter supplied."
    default_code = "invalid_query"

    def __init__(self, detail, code=None):
        super().__init__(detail=detail, code=code)


class InvalidRangeError(APIException):
    status_code = 400
    default_detail = "Minimum value cannot exceed maximum value."
    default_code = "invalid_range"


class PayloadTooLargeError(APIException):
    status_code = 413
    default_detail = "Requested payload exceeds configured limits."
    default_code = "payload_too_large"


class TrailPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 50

    def get_paginated_response(self, data):
        return Response({
            "results": data,
            "total_count": self.page.paginator.count,
            "next": self.get_next_link(),
            "previous": self.get_previous_link(),
        })


@dataclass
class ParsedFilters:
    query: Optional[str] = None
    difficulty: Optional[str] = None
    distance_min: Optional[float] = None
    distance_max: Optional[float] = None
    category_ids: Optional[List[int]] = None
    city: Optional[str] = None
    country: Optional[str] = None


class TrailViewSet(viewsets.ModelViewSet):
    serializer_class = TrailSerializer
    pagination_class = TrailPagination
    lookup_field = "slug"
    lookup_value_regex = "[^/]+"
    permission_classes = [IsAuthenticatedOrReadOnly]

    def get_queryset(self) -> QuerySet[Trail]:
        queryset = (
            Trail.objects.filter(approval_state="approved")
            .select_related("submitted_by")
            .prefetch_related("categories")
            .order_by("name")
        )
        request = getattr(self, "request", None)
        user = getattr(request, "user", None) if request else None

        if user and getattr(user, "is_authenticated", False):
            completion_exists = TrailCompletion.objects.filter(
                trail=OuterRef("pk"),
                user=user,
            )
            queryset = queryset.annotate(viewer_has_completed=Exists(completion_exists))
        else:
            queryset = queryset.annotate(
                viewer_has_completed=Value(False, output_field=BooleanField())
            )
        return queryset

    # Filtering -----------------------------------------------------------------
    def filter_queryset(self, queryset: QuerySet[Trail]) -> QuerySet[Trail]:
        queryset = super().filter_queryset(queryset)
        if not hasattr(self, "request"):
            return queryset
        filters = self._parse_filters(self.request.query_params)

        if filters.query:
            queryset = queryset.filter(
                Q(name__icontains=filters.query)
                | Q(description__icontains=filters.query)
                | Q(city__icontains=filters.query)
                | Q(country__icontains=filters.query)
            )

        if filters.difficulty:
            queryset = queryset.filter(difficulty=filters.difficulty)

        if filters.distance_min is not None:
            queryset = queryset.filter(distance_km__gte=filters.distance_min)

        if filters.distance_max is not None:
            queryset = queryset.filter(distance_km__lte=filters.distance_max)

        if filters.city:
            queryset = queryset.filter(city__iexact=filters.city)

        if filters.country:
            queryset = queryset.filter(country__iexact=filters.country)

        if filters.category_ids:
            queryset = self._filter_by_categories(queryset, filters.category_ids)

        return queryset.distinct()

    def _parse_filters(self, params: MultiValueDict) -> ParsedFilters:
        errors: Dict[str, List[str]] = {}

        def add_error(field: str, message: str) -> None:
            errors.setdefault(field, []).append(message)

        query = params.get("q")
        if query is not None:
            query = query.strip()
            if len(query) > 120:
                add_error("q", "Must be 120 characters or fewer.")
            elif not query:
                query = None

        difficulty_raw = params.get("difficulty")
        difficulty_value: Optional[str] = None
        if difficulty_raw:
            difficulty_normalised = difficulty_raw.strip().lower()
            if difficulty_normalised in {"all", ""}:
                difficulty_value = None
            elif difficulty_normalised in {"easy", "moderate", "hard"}:
                difficulty_value = difficulty_normalised
            else:
                add_error("difficulty", "Must be one of Easy, Moderate, or Hard.")

        distance_min = self._parse_optional_float(
            params.get("distance_km_min"),
            "distance_km_min",
            0,
            2000,
            errors,
        )
        distance_max = self._parse_optional_float(
            params.get("distance_km_max"),
            "distance_km_max",
            0,
            2000,
            errors,
        )
        if (
            distance_min is not None
            and distance_max is not None
            and distance_min > distance_max
        ):
            raise InvalidRangeError({
                "distance": "distance_km_min cannot exceed distance_km_max."
            })

        category_ids = self._parse_category_ids(params, errors)

        city = self._parse_optional_string(params.get("city"), "city", errors)
        country = self._parse_optional_string(params.get("country"), "country", errors)

        if errors:
            raise QueryParameterError(errors)

        return ParsedFilters(
            query=query,
            difficulty=difficulty_value,
            distance_min=distance_min,
            distance_max=distance_max,
            category_ids=category_ids,
            city=city,
            country=country,
        )

    def _parse_optional_float(
        self,
        value: Optional[str],
        field: str,
        minimum: float,
        maximum: float,
        errors: Dict[str, List[str]],
    ) -> Optional[float]:
        if value is None or value == "":
            return None
        try:
            number = float(value)
        except ValueError:
            errors.setdefault(field, []).append("Must be a valid number.")
            return None
        if number < minimum or number > maximum:
            errors.setdefault(field, []).append(
                f"Must be between {minimum:g} and {maximum:g}."
            )
            return None
        return number

    def _parse_optional_string(
        self,
        value: Optional[str],
        field: str,
        errors: Dict[str, List[str]],
    ) -> Optional[str]:
        if value is None:
            return None
        trimmed = value.strip()
        if not trimmed:
            return None
        if len(trimmed) > 80:
            errors.setdefault(field, []).append("Must be 80 characters or fewer.")
            return None
        return trimmed

    def _parse_category_ids(
        self, params: MultiValueDict, errors: Dict[str, List[str]]
    ) -> Optional[List[int]]:
        raw_values: List[str] = []
        if "category_ids[]" in params:
            raw_values.extend(params.getlist("category_ids[]"))
        if "category_ids" in params:
            raw_values.extend(params.getlist("category_ids"))
        if not raw_values:
            return None

        parsed: List[int] = []
        for entry in raw_values:
            for part in entry.split(","):
                part = part.strip()
                if not part:
                    continue
                try:
                    parsed_id = int(part)
                except ValueError:
                    errors.setdefault("category_ids", []).append(
                        "Must contain integers."
                    )
                    continue
                if parsed_id <= 0:
                    errors.setdefault("category_ids", []).append(
                        "Ids must be positive integers."
                    )
                    continue
                parsed.append(parsed_id)

        unique_ids = list(dict.fromkeys(parsed))
        if len(unique_ids) > 10:
            raise PayloadTooLargeError({
                "category_ids": "A maximum of 10 categories may be supplied."
            })

        return unique_ids or None

    def _filter_by_categories(
        self, queryset: QuerySet[Trail], category_ids: Iterable[int]
    ) -> QuerySet[Trail]:
        category_ids = list(category_ids)
        if not category_ids:
            return queryset
        return (
            queryset.filter(categories__id__in=category_ids)
            .annotate(
                matched_categories=Count(
                    "categories",
                    filter=Q(categories__id__in=category_ids),
                    distinct=True,
                )
            )
            .filter(matched_categories=len(category_ids))
        )

    # Comments ------------------------------------------------------------------
    @action(detail=True, methods=["get"], url_path="comments")
    def list_comments(self, request, slug=None) -> Response:
        trail = self.get_object()
        sort = request.query_params.get("sort", "newest").lower()
        try:
            page = max(int(request.query_params.get("page", 1)), 1)
        except ValueError:
            return Response(
                {"detail": "Invalid page value."},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )
        try:
            page_size = int(request.query_params.get("page_size", 20))
        except ValueError:
            return Response(
                {"detail": "Invalid page size."},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )
        if page_size <= 0 or page_size > 50:
            return Response(
                {"detail": "page_size must be between 1 and 50."},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        base_queryset = (
            trail.comments.filter(parent__isnull=True, is_deleted=False)
            .select_related("author")
            .prefetch_related("replies__author", "replies__reactions", "reactions")
            .annotate(
                helpful_count=Count(
                    "reactions",
                    filter=Q(reactions__kind=CommentReaction.LIKE),
                    distinct=True,
                ),
                has_rating=Case(
                    When(rating__isnull=False, then=1),
                    default=0,
                    output_field=IntegerField(),
                ),
            )
        )

        if sort == "helpful":
            base_queryset = base_queryset.order_by(
                "-has_rating", "-helpful_count", "-created_at"
            )
        else:
            base_queryset = base_queryset.order_by("-created_at")

        total_count = base_queryset.count()
        offset = (page - 1) * page_size
        comments = list(base_queryset[offset : offset + page_size])

        serializer = CommentSerializer(
            comments, many=True, context={"request": request}
        )
        return Response({
            "results": serializer.data,
            "page": page,
            "page_size": page_size,
            "total_count": total_count,
        })

    @list_comments.mapping.post
    def create_comment(self, request, slug=None) -> Response:
        trail = self.get_object()
        if not request.user or not request.user.is_authenticated:
            return Response(status=status.HTTP_403_FORBIDDEN)

        data = request.data.copy()
        parent_id = data.get("parent")
        parent = None
        if parent_id:
            parent = get_object_or_404(Comment, pk=parent_id, trail=trail)
        serializer = CommentSerializer(data=data, context={"request": request})
        try:
            serializer.is_valid(raise_exception=True)
        except serializers.ValidationError as exc:
            return Response(exc.detail, status=status.HTTP_422_UNPROCESSABLE_ENTITY)

        try:
            with transaction.atomic():
                comment = serializer.save(trail=trail, parent=parent)
                sync_trail_stats(trail, delta_comments=1, new_rating=comment.rating)
        except IntegrityError:
            return Response(
                {"detail": "You have already rated this trail."},
                status=status.HTTP_409_CONFLICT,
            )

        output = CommentSerializer(comment, context={"request": request})
        return Response(output.data, status=status.HTTP_201_CREATED)

    # Trail completion ----------------------------------------------------------
    @action(
        detail=True,
        methods=["post"],
        permission_classes=[IsAuthenticated],
        url_path="complete",
    )
    def mark_complete(self, request, slug=None) -> Response:
        """Mark a trail as completed by the current user"""
        trail = self.get_object()
        user = request.user

        # Check if already completed
        completion, created = TrailCompletion.objects.get_or_create(
            trail=trail, user=user, defaults={"completed_at": timezone.now()}
        )

        if not created:
            return Response(
                {"detail": "Trail already marked as completed."},
                status=status.HTTP_200_OK,
            )

        # Update user stats
        from accounts.services import update_user_stats

        stats = update_user_stats(user)

        # Check for badge awards
        from accounts.models import Badge, BadgeAward

        badges = Badge.objects.filter(criterion="trails_completed")
        for badge in badges:
            if stats.trails_completed >= badge.threshold:
                BadgeAward.objects.get_or_create(user=user, badge=badge)

        return Response(
            {
                "detail": "Trail marked as completed.",
                "completed_at": completion.completed_at.isoformat(),
            },
            status=status.HTTP_201_CREATED,
        )

    @mark_complete.mapping.delete
    def unmark_complete(self, request, slug=None) -> Response:
        """Remove trail completion for the current user"""
        trail = self.get_object()
        user = request.user

        try:
            completion = TrailCompletion.objects.get(trail=trail, user=user)
            completion.delete()

            # Update user stats
            from accounts.services import update_user_stats

            update_user_stats(user)

            return Response(
                {"detail": "Trail completion removed."}, status=status.HTTP_200_OK
            )
        except TrailCompletion.DoesNotExist:
            return Response(
                {"detail": "Trail was not marked as completed."},
                status=status.HTTP_404_NOT_FOUND,
            )

    # Trail bookmarks -----------------------------------------------------------
    @action(
        detail=True,
        methods=["post"],
        permission_classes=[IsAuthenticated],
        url_path="bookmark",
    )
    def bookmark(self, request, slug=None) -> Response:
        """Toggle bookmark/save for a trail"""
        trail = self.get_object()
        user = request.user

        # Try to get existing bookmark
        try:
            bookmark = Bookmark.objects.get(trail=trail, user=user)
            # Already bookmarked - toggle off
            bookmark.delete()
            bookmarked = False

            # Decrement save_count
            from django.db.models import F

            Trail.objects.filter(pk=trail.pk).update(save_count=F("save_count") - 1)
            trail.refresh_from_db(fields=["save_count"])

        except Bookmark.DoesNotExist:
            # Not bookmarked - toggle on
            Bookmark.objects.create(trail=trail, user=user)
            bookmarked = True

            # Increment save_count
            from django.db.models import F

            Trail.objects.filter(pk=trail.pk).update(save_count=F("save_count") + 1)
            trail.refresh_from_db(fields=["save_count"])

        # Update user stats
        from accounts.services import update_user_stats

        update_user_stats(user)

        return Response(
            {
                "bookmarked": bookmarked,
                "total_saves": trail.save_count,
            },
            status=status.HTTP_200_OK,
        )

    # Trail view tracking --------------------------------------------------------
    @action(
        detail=True,
        methods=["post"],
        permission_classes=[],  # Allow both authenticated and anonymous users
        url_path="track-view",
    )
    def track_view(self, request, slug=None) -> Response:
        """Track a view of a trail with deduplication by user or IP address"""
        trail = self.get_object()
        user = request.user if request.user.is_authenticated else None

        # Get IP address from request
        x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
        if x_forwarded_for:
            ip_address = x_forwarded_for.split(',')[0].strip()
        else:
            ip_address = request.META.get('REMOTE_ADDR')

        # Deduplication logic: only count one view per user/IP per 24 hours
        time_threshold = timezone.now() - timezone.timedelta(hours=24)

        # Check if this user/IP has viewed this trail recently
        if user:
            # For authenticated users, check by user
            recent_view = TrailView.objects.filter(
                trail=trail,
                user=user,
                viewed_at__gte=time_threshold
            ).exists()
        else:
            # For anonymous users, check by IP
            recent_view = TrailView.objects.filter(
                trail=trail,
                ip_address=ip_address,
                viewed_at__gte=time_threshold
            ).exists()

        # Only create a new view record if this is a new unique view
        if not recent_view:
            TrailView.objects.create(
                trail=trail,
                user=user,
                ip_address=ip_address
            )

            # Atomically increment view count
            from django.db.models import F
            Trail.objects.filter(pk=trail.pk).update(view_count=F('view_count') + 1)
            trail.refresh_from_db()

        return Response(
            {
                "view_count": trail.view_count,
                "counted": not recent_view
            },
            status=status.HTTP_200_OK,
        )

    # Trail photos ---------------------------------------------------------------
    @action(detail=True, methods=["get"], url_path="photos")
    def list_photos(self, request, slug=None) -> Response:
        """List all photos for a trail"""
        trail = self.get_object()
        photos = trail.photos.all().select_related("uploader")
        serializer = TrailPhotoSerializer(
            photos, many=True, context={"request": request}
        )
        return Response(serializer.data, status=status.HTTP_200_OK)

    @list_photos.mapping.post
    def upload_photo(self, request, slug=None) -> Response:
        """Upload a new photo for a trail"""
        if not request.user or not request.user.is_authenticated:
            return Response(status=status.HTTP_403_FORBIDDEN)

        trail = self.get_object()

        # Prepare data with trail reference
        data = request.data.copy()
        data["trail"] = trail.id

        serializer = TrailPhotoSerializer(data=data, context={"request": request})
        try:
            serializer.is_valid(raise_exception=True)
        except serializers.ValidationError as exc:
            return Response(exc.detail, status=status.HTTP_422_UNPROCESSABLE_ENTITY)

        try:
            with transaction.atomic():
                photo = serializer.save(trail=trail)
        except IntegrityError as exc:
            return Response(
                {"detail": "Error saving photo. Only one primary photo allowed per trail."},
                status=status.HTTP_409_CONFLICT,
            )

        output = TrailPhotoSerializer(photo, context={"request": request})
        return Response(output.data, status=status.HTTP_201_CREATED)

    @action(
        detail=True,
        methods=["delete"],
        permission_classes=[IsAuthenticated],
        url_path="photos/(?P<photo_id>[0-9]+)",
    )
    def delete_photo(self, request, slug=None, photo_id=None) -> Response:
        """Delete a specific photo"""
        trail = self.get_object()
        user = request.user

        try:
            photo = TrailPhoto.objects.get(id=photo_id, trail=trail)
        except TrailPhoto.DoesNotExist:
            return Response(
                {"detail": "Photo not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Only uploader or staff can delete
        if photo.uploader != user and not user.is_staff:
            return Response(
                {"detail": "You do not have permission to delete this photo."},
                status=status.HTTP_403_FORBIDDEN,
            )

        photo.delete()
        return Response(
            {"detail": "Photo deleted successfully."},
            status=status.HTTP_200_OK,
        )

    @action(
        detail=True,
        methods=["patch"],
        permission_classes=[IsAuthenticated],
        url_path="photos/(?P<photo_id>[0-9]+)",
    )
    def update_photo(self, request, slug=None, photo_id=None) -> Response:
        """Update photo caption or set as primary"""
        trail = self.get_object()
        user = request.user

        try:
            photo = TrailPhoto.objects.get(id=photo_id, trail=trail)
        except TrailPhoto.DoesNotExist:
            return Response(
                {"detail": "Photo not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Only uploader or staff can update
        if photo.uploader != user and not user.is_staff:
            return Response(
                {"detail": "You do not have permission to update this photo."},
                status=status.HTTP_403_FORBIDDEN,
            )

        serializer = TrailPhotoSerializer(
            photo, data=request.data, partial=True, context={"request": request}
        )
        try:
            serializer.is_valid(raise_exception=True)
        except serializers.ValidationError as exc:
            return Response(exc.detail, status=status.HTTP_422_UNPROCESSABLE_ENTITY)

        try:
            with transaction.atomic():
                updated_photo = serializer.save()
        except IntegrityError:
            return Response(
                {"detail": "Only one primary photo allowed per trail."},
                status=status.HTTP_409_CONFLICT,
            )

        output = TrailPhotoSerializer(updated_photo, context={"request": request})
        return Response(output.data, status=status.HTTP_200_OK)

    # Map results ----------------------------------------------------------------
    @action(detail=False, methods=["get"], url_path="map")
    def map_results(self, request):
        queryset = self.filter_queryset(self.get_queryset())
        south, west, north, east = self._parse_bbox(request.query_params.get("bbox"))
        zoom = self._parse_zoom(request.query_params.get("zoom"))
        cluster = self._parse_bool(request.query_params.get("cluster"), default=True)
        max_markers = self._parse_max_markers(request.query_params.get("max_markers"))

        # Create a bounding box polygon for spatial query
        # PostGIS expects (longitude, latitude) order for SRID 4326
        bbox_polygon = None
        if GIS_AVAILABLE:
            bbox_polygon = Polygon.from_bbox((west, south, east, north))

        # Filter trails based on spatial data when GIS is available, otherwise fall back to
        # simple latitude/longitude bounding.
        if GIS_AVAILABLE and bbox_polygon is not None:
            trails = queryset.filter(
                Q(route_geometry__isnull=False, route_geometry__intersects=bbox_polygon)
                | Q(
                    route_geometry__isnull=True,
                    latitude__isnull=False,
                    longitude__isnull=False,
                    latitude__gte=south,
                    latitude__lte=north,
                    longitude__gte=west,
                    longitude__lte=east,
                )
            )
        else:
            trails = queryset.filter(
                latitude__isnull=False,
                longitude__isnull=False,
                latitude__gte=south,
                latitude__lte=north,
                longitude__gte=west,
                longitude__lte=east,
            )

        total_in_bbox = trails.count()

        if cluster:
            features = self._build_clusters(trails, zoom, max_markers)
        else:
            # if total_in_bbox > max_markers:
            #    raise PayloadTooLargeError({
            #        "max_markers": (
            #            f"Marker count {total_in_bbox} exceeds limit of {max_markers} when clustering is disabled."
            #        )
            #    })
            features = [self._trail_feature(trail) for trail in trails]

        bounds = self._compute_bounds(features, (south, west, north, east))

        return Response({
            "features": features,
            "map_bounds": {
                "south": bounds[0],
                "west": bounds[1],
                "north": bounds[2],
                "east": bounds[3],
            },
            "total_in_bbox": total_in_bbox,
        })

    def _parse_bbox(self, bbox: Optional[str]) -> Tuple[float, float, float, float]:
        if not bbox:
            raise QueryParameterError({
                "bbox": "Bounding box must be provided as south,west,north,east."
            })
        parts = [part.strip() for part in bbox.split(",") if part.strip()]
        if len(parts) != 4:
            raise QueryParameterError({
                "bbox": "Bounding box must contain four comma-separated numbers."
            })
        try:
            south, west, north, east = [float(part) for part in parts]
        except ValueError:
            raise QueryParameterError({"bbox": "Bounding box values must be numeric."})
        if not (-90 <= south <= 90 and -90 <= north <= 90):
            raise QueryParameterError({
                "bbox": "Latitude bounds must be between -90 and 90."
            })
        # if not (-180 <= west <= 180 and -180 <= east <= 180):
        #    raise QueryParameterError({
        #        "bbox": "Longitude bounds must be between -180 and 180."
        #    })
        if south > north:
            raise InvalidRangeError({
                "bbox": "South latitude cannot exceed north latitude."
            })
        if west > east:
            raise InvalidRangeError({
                "bbox": "West longitude cannot exceed east longitude."
            })
        return south, west, north, east

    def _parse_zoom(self, zoom: Optional[str]) -> int:
        if zoom is None or zoom == "":
            return 10
        try:
            zoom_level = int(zoom)
        except ValueError:
            raise QueryParameterError({
                "zoom": "Zoom must be an integer between 0 and 22."
            })
        if zoom_level < 0 or zoom_level > 22:
            raise QueryParameterError({"zoom": "Zoom must be between 0 and 22."})
        return zoom_level

    def _parse_bool(self, value: Optional[str], default: bool) -> bool:
        if value is None:
            return default
        value_lower = value.strip().lower()
        if value_lower in {"1", "true", "yes", "on"}:
            return True
        if value_lower in {"0", "false", "no", "off"}:
            return False
        raise QueryParameterError({"cluster": "Cluster must be a boolean value."})

    def _parse_max_markers(self, value: Optional[str]) -> int:
        default_limit = 500
        if value is None or value == "":
            return default_limit
        try:
            parsed = int(value)
        except ValueError:
            raise QueryParameterError({"max_markers": "Must be an integer."})
        if parsed <= 0 or parsed > default_limit:
            raise QueryParameterError({
                "max_markers": f"Must be between 1 and {default_limit}."
            })
        return parsed

    def _build_clusters(
        self, trails: QuerySet[Trail], zoom: int, max_markers: int
    ) -> List[Dict[str, object]]:
        bucket_size = self._bucket_size_for_zoom(zoom)
        buckets: Dict[Tuple[int, int], Dict[str, object]] = {}

        for trail in trails:
            lat = trail.latitude
            lng = trail.longitude
            if lat is None or lng is None:
                continue
            key = (int(floor(lat / bucket_size)), int(floor(lng / bucket_size)))
            bucket = buckets.setdefault(
                key,
                {
                    "lat_sum": 0.0,
                    "lng_sum": 0.0,
                    "count": 0,
                    "trails": [],
                },
            )
            bucket["lat_sum"] += lat
            bucket["lng_sum"] += lng
            bucket["count"] += 1
            bucket["trails"].append(trail)

        features: List[Dict[str, object]] = []
        for idx, bucket in enumerate(buckets.values()):
            count = int(bucket["count"])
            if count == 0:
                continue
            avg_lat = bucket["lat_sum"] / count
            avg_lng = bucket["lng_sum"] / count
            trails_in_bucket = bucket["trails"]
            if count == 1:
                features.append(self._trail_feature(trails_in_bucket[0]))
            else:
                features.append({
                    "id": f"cluster-{idx}",
                    "lat": avg_lat,
                    "lng": avg_lng,
                    "name": f"{count} trails",
                    "is_cluster": True,
                    "cluster_count": count,
                })

        # Limit cluster count if necessary
        if len(features) > max_markers:
            features.sort(
                key=lambda feature: feature.get("cluster_count", 1), reverse=True
            )
            features = features[:max_markers]

        return features

    def _trail_feature(self, trail: Trail) -> Dict[str, object]:
        segments = self._serialise_route(trail)
        # Get the first point from the first segment
        start = segments[0][0] if segments and segments[0] else None
        if start is None and trail.latitude is not None and trail.longitude is not None:
            start = {"lat": float(trail.latitude), "lng": float(trail.longitude)}

        lat = (
            trail.latitude
            if trail.latitude is not None
            else (start["lat"] if start else None)
        )
        lng = (
            trail.longitude
            if trail.longitude is not None
            else (start["lng"] if start else None)
        )

        return {
            "id": str(trail.pk),
            "slug": trail.slug,
            "lat": lat,
            "lng": lng,
            "name": trail.name,
            "is_cluster": False,
            "cluster_count": 1,
            "difficulty": trail.get_difficulty_display(),
            "distance_km": trail.distance_km,
            "segments": segments,
            "start": start,
        }

    def _bucket_size_for_zoom(self, zoom: int) -> float:
        # Basic heuristic: halve the bucket size every two zoom levels.
        base_size = 4.0
        steps = max(0, zoom - 4) // 2
        bucket = base_size / (2**steps)
        return max(bucket, 0.05)

    def _compute_bounds(
        self,
        features: List[Dict[str, object]],
        fallback: Tuple[float, float, float, float],
    ) -> Tuple[float, float, float, float]:
        if not features:
            return fallback
        lats = [float(feature["lat"]) for feature in features]
        lngs = [float(feature["lng"]) for feature in features]
        return min(lats), min(lngs), max(lats), max(lngs)

    def _serialise_route(self, trail: Trail) -> List[List[Dict[str, float]]]:
        """Serialize route_path to list of segments.

        Returns list of segments, where each segment is a list of {lat, lng} points.
        """
        if not trail.route_path:
            return []

        segments: List[List[Dict[str, float]]] = []
        for segment in trail.route_path:
            if not isinstance(segment, list):
                continue
            coords: List[Dict[str, float]] = []
            for item in segment:
                if not isinstance(item, dict):
                    continue
                lat = item.get("lat")
                lng = item.get("lng")
                if lat is None or lng is None:
                    continue
                coords.append({"lat": float(lat), "lng": float(lng)})
            if coords:  # Only add non-empty segments
                segments.append(coords)
        return segments

    # Filter metadata ------------------------------------------------------------
    @action(detail=False, methods=["get"], url_path="filters")
    def filter_options(self, request):
        queryset = self.get_queryset()

        distance_stats = queryset.aggregate(
            min_distance=Min("distance_km"),
            max_distance=Max("distance_km"),
        )

        categories = TrailCategory.objects.order_by("name")
        category_payload = TrailCategorySerializer(categories, many=True).data

        cities = (
            queryset.exclude(city="")
            .values_list("city", flat=True)
            .distinct()
            .order_by("city")
        )
        countries = (
            queryset.exclude(country="")
            .values_list("country", flat=True)
            .distinct()
            .order_by("country")
        )

        return Response({
            "difficulties": [
                {"value": "easy", "label": "Easy"},
                {"value": "moderate", "label": "Moderate"},
                {"value": "hard", "label": "Hard"},
            ],
            "distance_range": {
                "min": distance_stats["min_distance"] or 0,
                "max": distance_stats["max_distance"] or 0,
            },
            "categories": category_payload,
            "cities": list(cities),
            "countries": list(countries),
        })


__all__ = ["TrailViewSet"]
