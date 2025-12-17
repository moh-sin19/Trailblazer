from __future__ import annotations

from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from ..models import Trail
from ..serializers import (
    TrailFitRequestSerializer,
    TrailFitResponseSerializer,
    TrailProposalSerializer,
)
from ..services.graphhopper import GraphhopperClient, GraphhopperError
from ..services.route_processing import compute_total_distance_km, first_point


class TrailSubmissionViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    queryset = Trail.objects.filter(submitted_by__isnull=False).order_by(
        "-submitted_at"
    )
    serializer_class = TrailProposalSerializer
    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser, MultiPartParser, FormParser]
    http_method_names = ["get", "post", "patch", "delete"]
    lookup_field = "id"

    def get_queryset(self):
        """Return trails submitted by the current user, or all submissions for admins"""
        if self.request.user.is_staff:
            return self.queryset
        return self.queryset.filter(submitted_by=self.request.user)

    def create(self, request, *args, **kwargs):
        import json

        # Handle multipart form data by parsing JSON fields
        data = request.data.copy()
        if "segments" in data and isinstance(data["segments"], str):
            try:
                data["segments"] = json.loads(data["segments"])
            except (json.JSONDecodeError, TypeError):
                pass
        if "start" in data and isinstance(data["start"], str):
            try:
                data["start"] = json.loads(data["start"])
            except (json.JSONDecodeError, TypeError):
                pass

        serializer = self.get_serializer(data=data)
        try:
            serializer.is_valid(raise_exception=True)
        except serializers.ValidationError as exc:
            return Response(exc.detail, status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.perform_create(serializer)
        headers = self.get_success_headers(serializer.data)
        return Response(
            serializer.data, status=status.HTTP_201_CREATED, headers=headers
        )

    def perform_create(self, serializer):
        from ..models import TrailPhoto

        user = getattr(self.request, "user", None)
        trail = serializer.save(
            submitted_by=user
            if user and getattr(user, "is_authenticated", False)
            else None
        )

        # Handle photo uploads
        photos = self.request.FILES.getlist("photos")
        if photos and user and getattr(user, "is_authenticated", False):
            for index, photo in enumerate(photos):
                TrailPhoto.objects.create(
                    trail=trail,
                    uploader=user,
                    image=photo,
                    is_primary=(index == 0),  # First photo is primary
                )

        if user and getattr(user, "is_authenticated", False):
            from accounts.services import evaluate_badges_for_user

            evaluate_badges_for_user(user)

    def update(self, request, *args, **kwargs):
        """Update a trail submission (only if not approved)"""
        trail = self.get_object()

        # Check if trail is approved
        if trail.approval_state == "approved":
            return Response(
                {"detail": "Cannot edit an approved trail."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Check ownership (already enforced by get_queryset, but double-check)
        if trail.submitted_by != request.user and not request.user.is_staff:
            return Response(
                {"detail": "You don't have permission to edit this trail."},
                status=status.HTTP_403_FORBIDDEN,
            )

        serializer = self.get_serializer(trail, data=request.data, partial=True)
        try:
            serializer.is_valid(raise_exception=True)
        except serializers.ValidationError as exc:
            return Response(exc.detail, status=status.HTTP_422_UNPROCESSABLE_ENTITY)

        self.perform_update(serializer)
        return Response(serializer.data, status=status.HTTP_200_OK)

    def perform_update(self, serializer):
        """Save the updated trail"""
        from django.utils import timezone
        from ..models import TrailPhoto

        trail = serializer.save()

        # Handle photo uploads
        photos = self.request.FILES.getlist("photos")
        user = getattr(self.request, "user", None)
        if photos and user and getattr(user, "is_authenticated", False):
            # Get count of existing photos to determine if new ones should be primary
            existing_photo_count = TrailPhoto.objects.filter(trail=trail).count()

            for index, photo in enumerate(photos):
                TrailPhoto.objects.create(
                    trail=trail,
                    uploader=user,
                    image=photo,
                    is_primary=(
                        existing_photo_count == 0 and index == 0
                    ),  # First photo is primary only if no existing photos
                )

    def destroy(self, request, *args, **kwargs):
        """Delete a trail submission (only if not approved)"""
        trail = self.get_object()

        # Check if trail is approved
        if trail.approval_state == "approved":
            return Response(
                {"detail": "Cannot delete an approved trail."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Check ownership (already enforced by get_queryset, but double-check)
        if trail.submitted_by != request.user and not request.user.is_staff:
            return Response(
                {"detail": "You don't have permission to delete this trail."},
                status=status.HTTP_403_FORBIDDEN,
            )

        self.perform_destroy(trail)
        return Response(
            {"detail": "Trail submission deleted successfully."},
            status=status.HTTP_200_OK,
        )

    @action(
        detail=True,
        methods=["delete"],
        permission_classes=[IsAuthenticated],
        url_path="photos/(?P<photo_id>[0-9]+)",
    )
    def delete_photo(self, request, pk=None, photo_id=None, **kwargs) -> Response:
        """Delete a photo from a trail submission"""
        from ..models import TrailPhoto

        trail = self.get_object()
        user = request.user

        # Check if trail is approved
        if trail.approval_state == "approved":
            return Response(
                {"detail": "Cannot delete photos from an approved trail."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Check ownership
        if trail.submitted_by != user and not user.is_staff:
            return Response(
                {
                    "detail": "You don't have permission to delete photos from this trail."
                },
                status=status.HTTP_403_FORBIDDEN,
            )

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

    @action(detail=False, methods=["post"], url_path="fit-route")
    def fit_route(self, request, *args, **kwargs):
        request_serializer = TrailFitRequestSerializer(data=request.data)
        try:
            request_serializer.is_valid(raise_exception=True)
        except serializers.ValidationError as exc:
            return Response(exc.detail, status=status.HTTP_422_UNPROCESSABLE_ENTITY)

        client = GraphhopperClient()
        if not client.is_configured():
            return Response(
                {"detail": "Graphhopper routing is not configured."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        segments = request_serializer.validated_data["segments"]
        try:
            fitted_segments = client.fit_segments(segments)
        except GraphhopperError as exc:
            return Response(
                {"detail": str(exc)},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        total_points = sum(len(segment) for segment in fitted_segments)
        total_distance = round(compute_total_distance_km(fitted_segments), 3)
        start_point = first_point(fitted_segments) or first_point(segments)

        response_serializer = TrailFitResponseSerializer(
            data={
                "segments": fitted_segments,
                "total_points": total_points,
                "total_distance_km": total_distance,
                "start": start_point,
            }
        )
        response_serializer.is_valid(raise_exception=True)
        return Response(response_serializer.data, status=status.HTTP_200_OK)


__all__ = ["TrailSubmissionViewSet"]
