"""Management command to seed default badges"""
from django.core.management.base import BaseCommand
from accounts.models import Badge


class Command(BaseCommand):
    help = "Seed default badges for the achievement system"

    def handle(self, *args, **options):
        badges_data = [
            # Trails Created badges
            {
                "name": "First Steps",
                "description": "Created your first trail",
                "icon": "🥾",
                "criterion": "trails_created",
                "threshold": 1,
            },
            {
                "name": "Trail Mapper",
                "description": "Created 5 trails",
                "icon": "🗺️",
                "criterion": "trails_created",
                "threshold": 5,
            },
            {
                "name": "Trail Blazer",
                "description": "Created 10 trails",
                "icon": "🔥",
                "criterion": "trails_created",
                "threshold": 10,
            },
            # Comments badges
            {
                "name": "Conversationalist",
                "description": "Posted 10 comments",
                "icon": "💬",
                "criterion": "comments_posted",
                "threshold": 10,
            },
            {
                "name": "Community Voice",
                "description": "Posted 50 comments",
                "icon": "📣",
                "criterion": "comments_posted",
                "threshold": 50,
            },
            # Completed trails badges
            {
                "name": "Explorer",
                "description": "Completed 5 trails",
                "icon": "🌄",
                "criterion": "trails_completed",
                "threshold": 5,
            },
            {
                "name": "Adventurer",
                "description": "Completed 25 trails",
                "icon": "🏔️",
                "criterion": "trails_completed",
                "threshold": 25,
            },
        ]

        created_count = 0
        updated_count = 0

        for badge_data in badges_data:
            badge, created = Badge.objects.update_or_create(
                name=badge_data["name"],
                defaults={
                    "description": badge_data["description"],
                    "icon": badge_data["icon"],
                    "criterion": badge_data["criterion"],
                    "threshold": badge_data["threshold"],
                },
            )
            if created:
                created_count += 1
                self.stdout.write(self.style.SUCCESS(f"Created badge: {badge.name}"))
            else:
                updated_count += 1
                self.stdout.write(f"Updated badge: {badge.name}")

        self.stdout.write(
            self.style.SUCCESS(
                f"\nBadge seeding complete: {created_count} created, {updated_count} updated"
            )
        )
