"""Services for badge evaluation and stats management"""

from typing import Any, Dict, List
from django.contrib.auth import get_user_model
from django.db.models import Count, Q, Sum, Max, Value
from django.db.models.functions import Coalesce, TruncMonth

from .models import Badge, BadgeAward, UserStats

User = get_user_model()


def get_or_create_user_stats(user: User) -> UserStats:
    """Get or create UserStats for a user"""
    stats, created = UserStats.objects.get_or_create(user=user)
    stats = update_user_stats(user)
    return stats


def update_user_stats(user: User) -> UserStats:
    """Recalculate and update all stats for a user"""
    from trails.models import Trail, Comment, TrailCompletion, Bookmark  # Avoid circular import

    stats, _ = UserStats.objects.get_or_create(user=user)

    submissions = Trail.objects.filter(submitted_by=user)
    stats.trails_created = submissions.count()

    # Count comments by this user
    stats.comments_posted = Comment.objects.filter(author=user).count()

    completions = TrailCompletion.objects.filter(user=user)
    stats.trails_completed = completions.count()
    distance_total = (
        completions.aggregate(total=Coalesce(Sum("trail__distance_km"), Value(0.0)))[
            "total"
        ]
        or 0.0
    )
    stats.distance_hiked_km = float(distance_total)

    # Count bookmarked trails by this user
    stats.trails_bookmarked = Bookmark.objects.filter(user=user).count()

    stats.save()
    return stats


def evaluate_badges_for_user(user: User) -> List[Badge]:
    """
    Check which badges a user has earned and award them.
    Returns list of newly awarded badges.
    """
    stats = get_or_create_user_stats(user)

    # Get all badges
    all_badges = Badge.objects.all()

    # Get badges already awarded to this user
    awarded_badge_ids = set(
        BadgeAward.objects.filter(user=user).values_list("badge_id", flat=True)
    )

    newly_awarded = []

    for badge in all_badges:
        if badge.id in awarded_badge_ids:
            continue  # Already has this badge

        # Check if user meets the criterion
        stat_value = getattr(stats, badge.criterion, 0)
        if stat_value >= badge.threshold:
            # Award the badge
            BadgeAward.objects.create(user=user, badge=badge)
            newly_awarded.append(badge)

    return newly_awarded


def get_user_badge_progress(user: User) -> dict:
    """
    Get badge progress for a user.
    Returns dict with 'awarded' and 'in_progress' lists.
    """
    stats = get_or_create_user_stats(user)

    # Get all badges
    all_badges = Badge.objects.prefetch_related("awards").all()

    # Get awarded badges with their award dates
    awarded_badge_awards = BadgeAward.objects.filter(user=user).select_related("badge")
    awarded_badges_map = {award.badge_id: award for award in awarded_badge_awards}

    awarded = []
    in_progress = []

    for badge in all_badges:
        stat_value = getattr(stats, badge.criterion, 0)

        if badge.id in awarded_badges_map:
            # Badge is awarded
            award = awarded_badges_map[badge.id]
            awarded.append({
                "id": badge.id,
                "name": badge.name,
                "description": badge.description,
                "icon": badge.icon,
                "awarded": True,
                "awarded_at": award.awarded_at.isoformat(),
                "progress": None,
            })
        else:
            # Badge not yet earned
            percent = (
                min(100, int((stat_value / badge.threshold) * 100))
                if badge.threshold > 0
                else 0
            )
            in_progress.append({
                "id": badge.id,
                "name": badge.name,
                "description": badge.description,
                "icon": badge.icon,
                "awarded": False,
                "awarded_at": None,
                "progress": {
                    "current": stat_value,
                    "threshold": badge.threshold,
                    "percent": percent,
                },
            })

    return {
        "awarded": awarded,
        "in_progress": in_progress,
    }


def get_user_trail_analytics(user: User) -> Dict[str, Any]:
    """Compute analytics for a user's completed trails."""
    from trails.models import TrailCompletion  # Avoid circular import

    completions = TrailCompletion.objects.filter(user=user)
    completion_count = completions.count()

    aggregates = completions.aggregate(
        total_distance=Coalesce(Sum("trail__distance_km"), Value(0.0)),
        longest_trail=Coalesce(Max("trail__distance_km"), Value(0.0)),
    )
    total_distance = float(aggregates["total_distance"] or 0.0)
    longest_trail = float(aggregates["longest_trail"] or 0.0)
    average_distance = (
        float(total_distance / completion_count) if completion_count else 0.0
    )

    difficulty_breakdown_qs = completions.values("trail__difficulty").annotate(
        count=Count("id"),
        distance=Coalesce(Sum("trail__distance_km"), Value(0.0)),
    )
    difficulty_order = {"easy": 0, "moderate": 1, "hard": 2}
    difficulty_breakdown = sorted(
        [
            {
                "difficulty": entry["trail__difficulty"] or "unknown",
                "count": entry["count"],
                "distance_km": float(entry["distance"] or 0.0),
            }
            for entry in difficulty_breakdown_qs
        ],
        key=lambda item: difficulty_order.get(item["difficulty"], 99),
    )

    monthly_progress: List[Dict[str, Any]] = []
    for entry in (
        completions.annotate(month=TruncMonth("completed_at"))
        .values("month")
        .order_by("month")
        .annotate(
            count=Count("id"),
            distance=Coalesce(Sum("trail__distance_km"), Value(0.0)),
        )
    ):
        month = entry["month"]
        if not month:
            continue
        monthly_progress.append({
            "month": month.date().isoformat(),
            "count": entry["count"],
            "distance_km": float(entry["distance"] or 0.0),
        })

    return {
        "distance": {
            "total_km": total_distance,
            "average_per_trail_km": average_distance,
            "longest_trail_km": longest_trail,
            "completed_trails": completion_count,
        },
        "difficulty_breakdown": difficulty_breakdown,
        "monthly_progress": monthly_progress,
    }
