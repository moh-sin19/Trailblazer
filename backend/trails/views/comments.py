from __future__ import annotations

from django.db import transaction

from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated, IsAuthenticatedOrReadOnly
from rest_framework.response import Response

from ..models import Comment, CommentReaction
from ..serializers import CommentSerializer
from .common import sync_trail_stats


class CommentViewSet(
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    queryset = Comment.objects.select_related("author", "trail").prefetch_related(
        "reactions"
    )
    serializer_class = CommentSerializer
    permission_classes = [IsAuthenticated]

    def update(self, request, *args, **kwargs):
        comment = self.get_object()
        if not self._can_modify(request.user, comment):
            return Response(status=status.HTTP_403_FORBIDDEN)
        old_rating = comment.rating
        partial = kwargs.pop("partial", False)
        serializer = self.get_serializer(comment, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            updated = serializer.save()
            sync_trail_stats(
                updated.trail, old_rating=old_rating, new_rating=updated.rating
            )
        return Response(self.get_serializer(updated).data)

    def destroy(self, request, *args, **kwargs):
        comment = self.get_object()
        if not self._can_modify(request.user, comment):
            return Response(status=status.HTTP_403_FORBIDDEN)
        old_rating = comment.rating
        with transaction.atomic():
            comment.is_deleted = True
            comment.body = ""
            comment.rating = None
            comment.save(update_fields=["is_deleted", "body", "rating", "updated_at"])
            sync_trail_stats(
                comment.trail, delta_comments=-1, old_rating=old_rating, new_rating=None
            )
        return Response(status=status.HTTP_204_NO_CONTENT)

    def _can_modify(self, user, comment: Comment) -> bool:
        return bool(
            user
            and user.is_authenticated
            and (user.is_staff or user.id == comment.author_id)
        )

    @action(
        detail=True,
        methods=["post"],
        permission_classes=[IsAuthenticated],
        url_path="reaction",
    )
    def toggle_reaction(self, request, pk=None):
        comment = self.get_object()
        kind = request.data.get("kind", CommentReaction.LIKE)
        if kind != CommentReaction.LIKE:
            return Response(
                {"detail": "Unsupported reaction."}, status=status.HTTP_400_BAD_REQUEST
            )

        reaction, created = CommentReaction.objects.get_or_create(
            comment=comment,
            user=request.user,
            defaults={"kind": kind},
        )
        if not created:
            reaction.delete()
            viewer_reaction = None
        else:
            viewer_reaction = kind

        helpful_count = comment.reactions.filter(kind=CommentReaction.LIKE).count()
        return Response({
            "helpful_count": helpful_count,
            "viewer_reaction": viewer_reaction,
        })

    def get_permissions(self):
        if self.action in {"retrieve"}:
            return [IsAuthenticatedOrReadOnly()]
        return super().get_permissions()


__all__ = ["CommentViewSet"]
