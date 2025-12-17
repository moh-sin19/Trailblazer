import io
import shutil
from pathlib import Path
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from PIL import Image
from rest_framework.test import APIClient
from rest_framework.test import APITestCase

from django.utils import timezone

from accounts.models import UserProfile
from accounts.services import update_user_stats
from trails.models import Trail, TrailCompletion

User = get_user_model()


def create_image_file(name: str = "avatar.png", size: tuple[int, int] = (128, 128), color: tuple[int, int, int] = (255, 0, 0)) -> SimpleUploadedFile:
    buffer = io.BytesIO()
    image = Image.new("RGB", size, color=color)
    image.save(buffer, format="PNG")
    return SimpleUploadedFile(name, buffer.getvalue(), content_type="image/png")


@override_settings(MEDIA_ROOT=Path("/tmp/test-media"))
class ProfileApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            username="testuser",
            email="test@example.com",
            password="securePass123",
        )
        self.profile = self.user.profile
        self.url = "/api/profile/me/"
        media_root = Path(settings.MEDIA_ROOT)
        if media_root.exists():
            shutil.rmtree(media_root)
        media_root.mkdir(parents=True, exist_ok=True)

    def test_retrieve_current_profile(self):
        self.client.force_authenticate(self.user)
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["display_name"], self.profile.display_name)
        self.assertEqual(response.data["username"], self.user.username)
        self.assertEqual(response.data["experience"], self.profile.experience)
        self.assertEqual(response.data["email"], self.user.email)

    def test_update_profile_fields(self):
        self.client.force_authenticate(self.user)
        payload = {
            "display_name": "Trail Hero",
            "bio": "Loves exploring new tracks across NSW.",
            "experience": UserProfile.Experience.INTERMEDIATE,
        }
        response = self.client.patch(self.url, payload, format="json")
        self.assertEqual(response.status_code, 200)
        self.profile.refresh_from_db()
        self.assertEqual(self.profile.display_name, payload["display_name"])
        self.assertEqual(self.profile.bio, payload["bio"])
        self.assertEqual(self.profile.experience, payload["experience"])

    def test_update_profile_validates_fields(self):
        self.client.force_authenticate(self.user)
        payload = {
            "display_name": "ab",
            "bio": "x" * 600,
            "experience": "guru",
        }
        response = self.client.patch(self.url, payload, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("display_name", response.data)
        self.assertIn("bio", response.data)
        self.assertIn("experience", response.data)

    def test_avatar_upload_replaces_existing(self):
        self.client.force_authenticate(self.user)
        first_avatar = create_image_file("first.png", size=(64, 64))
        response = self.client.patch(self.url, {"avatar": first_avatar}, format="multipart")
        self.assertEqual(response.status_code, 200)
        self.profile.refresh_from_db()
        first_path = Path(self.profile.avatar.path)
        self.assertTrue(first_path.exists())

        new_avatar = create_image_file("second.png", size=(96, 96), color=(0, 255, 0))
        response = self.client.patch(self.url, {"avatar": new_avatar}, format="multipart")
        self.assertEqual(response.status_code, 200)
        self.profile.refresh_from_db()
        self.assertTrue(Path(self.profile.avatar.path).exists())
        self.assertFalse(first_path.exists())

    def test_avatar_size_limit(self):
        self.client.force_authenticate(self.user)
        # Generate a large noisy image to exceed 5MB
        buffer = io.BytesIO()
        size = 2048
        while True:
            big_image = Image.effect_noise((size, size), 100).convert("RGB")
            buffer.seek(0)
            buffer.truncate(0)
            big_image.save(buffer, format="PNG")
            if buffer.tell() > 5 * 1024 * 1024:
                break
            size += 512
        upload = SimpleUploadedFile("huge.png", buffer.getvalue(), content_type="image/png")
        response = self.client.patch(self.url, {"avatar": upload}, format="multipart")
        self.assertEqual(response.status_code, 400)
        self.assertIn("avatar", response.data)


class PublicProfileAnalyticsTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="analyticsfan",
            email="analytics@example.com",
            password="pass1234",
        )
        now = timezone.now()

        self.easy_trail = Trail.objects.create(
            slug="analytics-easy",
            name="Analytics Easy Trail",
            difficulty="easy",
            distance_km=4.5,
            duration_mins=180,
            elev_gain_m=200,
            latitude=-33.86,
            longitude=151.21,
            city="Sydney",
            country="Australia",
            approval_state="approved",
            route_path=[],
        )

        self.hard_trail = Trail.objects.create(
            slug="analytics-hard",
            name="Analytics Hard Trail",
            difficulty="hard",
            distance_km=12.0,
            duration_mins=360,
            elev_gain_m=900,
            latitude=-33.70,
            longitude=150.30,
            city="Katoomba",
            country="Australia",
            approval_state="approved",
            route_path=[],
        )

        # Create trail completions in different months
        completion_recent = TrailCompletion.objects.create(
            trail=self.easy_trail,
            user=self.user,
        )
        completion_recent.completed_at = now
        completion_recent.save(update_fields=["completed_at"])

        completion_past = TrailCompletion.objects.create(
            trail=self.hard_trail,
            user=self.user,
        )
        completion_past.completed_at = now - timedelta(days=40)
        completion_past.save(update_fields=["completed_at"])

        update_user_stats(self.user)

    def test_public_profile_includes_distance_and_analytics(self):
        response = self.client.get(f"/api/profiles/{self.user.username}/")
        self.assertEqual(response.status_code, 200)

        payload = response.json()
        stats = payload["stats"]
        analytics = payload["analytics"]

        total_distance = self.easy_trail.distance_km + self.hard_trail.distance_km

        self.assertAlmostEqual(stats["distance_hiked_km"], total_distance)
        self.assertEqual(stats["trails_completed"], 2)

        distance_summary = analytics["distance"]
        self.assertAlmostEqual(distance_summary["total_km"], total_distance)
        self.assertAlmostEqual(distance_summary["longest_trail_km"], self.hard_trail.distance_km)
        self.assertEqual(distance_summary["completed_trails"], 2)
        self.assertAlmostEqual(
            distance_summary["average_per_trail_km"],
            total_distance / 2,
        )

        breakdown = analytics["difficulty_breakdown"]
        self.assertEqual(len(breakdown), 2)
        easy_entry = next(item for item in breakdown if item["difficulty"] == "easy")
        hard_entry = next(item for item in breakdown if item["difficulty"] == "hard")
        self.assertEqual(easy_entry["count"], 1)
        self.assertAlmostEqual(easy_entry["distance_km"], self.easy_trail.distance_km)
        self.assertEqual(hard_entry["count"], 1)
        self.assertAlmostEqual(hard_entry["distance_km"], self.hard_trail.distance_km)

        monthly_progress = analytics["monthly_progress"]
        self.assertGreaterEqual(len(monthly_progress), 1)
        months = [entry["month"] for entry in monthly_progress]
        self.assertTrue(all(isinstance(month, str) for month in months))
