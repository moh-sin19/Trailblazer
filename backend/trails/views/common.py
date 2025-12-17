from __future__ import annotations

from typing import Any, Optional

from django.db.models import F

from ..models import Trail


def sync_trail_stats(
    trail: Trail,
    *,
    delta_comments: int = 0,
    old_rating: Optional[int] = None,
    new_rating: Optional[int] = None,
) -> None:
    updates: dict[str, Any] = {}
    if delta_comments:
        updates["comment_count"] = F("comment_count") + delta_comments
    if old_rating is None and new_rating is not None:
        updates["rating_count"] = F("rating_count") + 1
        updates["rating_sum"] = F("rating_sum") + new_rating
    elif old_rating is not None and new_rating is None:
        updates["rating_count"] = F("rating_count") - 1
        updates["rating_sum"] = F("rating_sum") - old_rating
    elif old_rating is not None and new_rating is not None and old_rating != new_rating:
        updates["rating_sum"] = F("rating_sum") + (new_rating - old_rating)

    if updates:
        Trail.objects.filter(pk=trail.pk).update(**updates)
        trail.refresh_from_db(fields=list(updates.keys()))

        # Update rating_avg after refreshing from db
        if trail.rating_count > 0:
            trail.rating_avg = round(trail.rating_sum / trail.rating_count, 2)
        else:
            trail.rating_avg = 0.0
        trail.save(update_fields=["rating_avg"])

