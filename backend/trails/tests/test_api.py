from __future__ import annotations

from typing import Dict, List, Optional

from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import UserStats
from trails.models import Trail, TrailCategory, TrailCompletion


class TrailAPITestCase(APITestCase):
    maxDiff = None

    def setUp(self) -> None:
        self.coastal = TrailCategory.objects.create(name="Coastal", slug="coastal")
        self.mountain = TrailCategory.objects.create(name="Mountain", slug="mountain")
        self.urban = TrailCategory.objects.create(name="Urban", slug="urban")

        self.user = get_user_model().objects.create_user(
            username="alice",
            email="alice@example.com",
            password="pass1234",
        )
        self.easy_trail = self._create_trail(
            slug="easy-coastal",
            name="Bondi Boardwalk",
            difficulty="easy",
            distance_km=5.2,
            latitude=-33.89,
            longitude=151.27,
            city="Sydney",
            country="Australia",
            categories=[self.coastal],
        )

        self.moderate_trail = self._create_trail(
            slug="moderate-mountain",
            name="Blue Mountains Loop",
            difficulty="moderate",
            distance_km=12.4,
            latitude=-33.72,
            longitude=150.31,
            city="Katoomba",
            country="Australia",
            categories=[self.mountain],
        )

        self.hard_combo_trail = self._create_trail(
            slug="hard-combo",
            name="Coastal Summit Challenge",
            difficulty="hard",
            distance_km=18.9,
            latitude=-33.80,
            longitude=151.10,
            city="Sydney",
            country="Australia",
            categories=[self.coastal, self.mountain],
        )

        # Pending trails should be hidden from public endpoints
        self._create_trail(
            slug="pending-trail",
            name="Hidden Gem",
            difficulty="easy",
            distance_km=4.0,
            latitude=-33.90,
            longitude=151.30,
            city="Sydney",
            country="Australia",
            approval_state="pending",
            categories=[self.urban],
        )

    # ------------------------------------------------------------------ helpers
    def _create_trail(
        self,
        *,
        slug: str,
        name: str,
        difficulty: str,
        distance_km: float,
        latitude: float,
        longitude: float,
        city: str,
        country: str,
        categories: List[TrailCategory],
        approval_state: str = "approved",
        route_path: Optional[List[Dict[str, float]]] = None,
    ) -> Trail:
        trail = Trail.objects.create(
            slug=slug,
            name=name,
            description=f"Trail description for {name}",
            difficulty=difficulty,
            distance_km=distance_km,
            duration_mins=int(distance_km * 45),
            elev_gain_m=int(distance_km * 10),
            latitude=latitude,
            longitude=longitude,
            city=city,
            country=country,
            approval_state=approval_state,
            rating_avg=4.2,
            rating_count=120,
        )
        trail.categories.set(categories)
        if route_path is None:
            # route_path is a list of segments, each segment is a list of points
            route_path = [
                [
                    {"lat": latitude, "lng": longitude},
                    {"lat": latitude + 0.01, "lng": longitude + 0.01},
                    {"lat": latitude + 0.02, "lng": longitude + 0.015},
                ]
            ]
        trail.route_path = route_path
        trail.save(update_fields=["route_path"])
        return trail

    def _get(self, path: str, params: Dict[str, str] | None = None):
        return self.client.get(path, params or {}, format="json")

    def _post(self, path: str, payload: Dict[str, object] | None = None):
        return self.client.post(path, payload or {}, format="json")

    def _delete(self, path: str):
        return self.client.delete(path, format="json")

    # --------------------------------------------------------------- list tests
    def test_list_filters_by_difficulty(self):
        response = self._get("/api/trails/", {"difficulty": "Easy"})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = response.json()
        self.assertEqual(payload["total_count"], 1)
        self.assertEqual(payload["results"][0]["slug"], "easy-coastal")

    def test_list_filters_by_distance_range(self):
        response = self._get(
            "/api/trails/",
            {"distance_km_min": "10", "distance_km_max": "20"},
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        slugs = sorted(item["slug"] for item in response.json()["results"])
        self.assertEqual(slugs, ["hard-combo", "moderate-mountain"])

    def test_list_filters_by_city_and_country(self):
        response = self._get(
            "/api/trails/",
            {"city": "Sydney", "country": "Australia"},
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        slugs = sorted(item["slug"] for item in response.json()["results"])
        self.assertEqual(slugs, ["easy-coastal", "hard-combo"])

    def test_list_filters_by_category_intersection(self):
        params = {"category_ids": f"{self.coastal.id},{self.mountain.id}"}
        response = self._get("/api/trails/", params)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = response.json()
        self.assertEqual(payload["total_count"], 1)
        self.assertEqual(payload["results"][0]["slug"], "hard-combo")

    def test_list_filters_by_query(self):
        response = self._get("/api/trails/", {"q": "blue"})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = response.json()
        self.assertEqual(payload["total_count"], 1)
        self.assertEqual(payload["results"][0]["slug"], "moderate-mountain")

    def test_invalid_difficulty_returns_422(self):
        response = self._get("/api/trails/", {"difficulty": "Extreme"})
        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn("difficulty", response.json())

    def test_invalid_distance_range_returns_400(self):
        response = self._get(
            "/api/trails/",
            {"distance_km_min": "30", "distance_km_max": "5"},
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("distance", response.json())

    def test_category_limit_enforced(self):
        too_many = {"category_ids": ",".join(str(i) for i in range(1, 15))}
        response = self._get("/api/trails/", too_many)
        self.assertEqual(response.status_code, status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)

    # --------------------------------------------------------- completion tests
    def test_detail_includes_completion_status_for_viewer(self):
        self.client.force_authenticate(self.user)
        url = f"/api/trails/{self.easy_trail.slug}/"

        initial = self._get(url)
        self.assertEqual(initial.status_code, status.HTTP_200_OK)
        self.assertFalse(initial.json()["viewer_has_completed"])

        TrailCompletion.objects.create(trail=self.easy_trail, user=self.user)

        after = self._get(url)
        self.assertEqual(after.status_code, status.HTTP_200_OK)
        self.assertTrue(after.json()["viewer_has_completed"])

    def test_mark_complete_updates_stats_and_flag(self):
        self.client.force_authenticate(self.user)
        url = f"/api/trails/{self.easy_trail.slug}/complete/"

        response = self._post(url)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        stats = UserStats.objects.get(user=self.user)
        stats.refresh_from_db()
        self.assertEqual(stats.trails_completed, 1)
        self.assertAlmostEqual(stats.distance_hiked_km, self.easy_trail.distance_km)
        self.assertTrue(
            TrailCompletion.objects.filter(
                trail=self.easy_trail, user=self.user
            ).exists()
        )

        detail = self._get(f"/api/trails/{self.easy_trail.slug}/")
        self.assertEqual(detail.status_code, status.HTTP_200_OK)
        self.assertTrue(detail.json()["viewer_has_completed"])

    def test_duplicate_mark_complete_does_not_double_count(self):
        self.client.force_authenticate(self.user)
        url = f"/api/trails/{self.easy_trail.slug}/complete/"

        first = self._post(url)
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        second = self._post(url)
        self.assertEqual(second.status_code, status.HTTP_200_OK)

        stats = UserStats.objects.get(user=self.user)
        self.assertEqual(stats.trails_completed, 1)
        self.assertAlmostEqual(stats.distance_hiked_km, self.easy_trail.distance_km)
        self.assertEqual(
            TrailCompletion.objects.filter(
                trail=self.easy_trail, user=self.user
            ).count(),
            1,
        )

    def test_unmark_complete_rolls_back_stats(self):
        self.client.force_authenticate(self.user)
        url = f"/api/trails/{self.easy_trail.slug}/complete/"

        self._post(url)
        delete = self._delete(url)
        self.assertEqual(delete.status_code, status.HTTP_200_OK)

        stats = UserStats.objects.get(user=self.user)
        stats.refresh_from_db()
        self.assertEqual(stats.trails_completed, 0)
        self.assertAlmostEqual(stats.distance_hiked_km, 0.0)
        self.assertFalse(
            TrailCompletion.objects.filter(
                trail=self.easy_trail, user=self.user
            ).exists()
        )

    # --------------------------------------------------------------- map tests
    def test_map_results_clusters_data(self):
        params = {
            "bbox": "-34.2,150.0,-33.0,151.5",
            "zoom": "8",
            "cluster": "true",
        }
        response = self._get("/api/trails/map/", params)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = response.json()
        self.assertEqual(payload["total_in_bbox"], 3)
        self.assertTrue(payload["features"])
        # Ensure at least one cluster or marker present with expected shape
        first = payload["features"][0]
        self.assertIn("lat", first)
        self.assertIn("lng", first)
        self.assertIn("is_cluster", first)

    def test_map_results_include_route_geometry_for_solo_features(self):
        params = {
            "bbox": "-34.2,150.0,-33.0,151.5",
            "zoom": "12",
            "cluster": "false",
            "max_markers": "10",
        }
        response = self._get("/api/trails/map/", params)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = response.json()
        self.assertEqual(payload["total_in_bbox"], 3)
        self.assertTrue(payload["features"][0]["segments"])
        self.assertGreaterEqual(len(payload["features"][0]["segments"]), 1)
        self.assertIn("start", payload["features"][0])

    def test_trail_detail_includes_route_path(self):
        trail = self.easy_trail
        response = self._get(f"/api/trails/{trail.slug}/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = response.json()
        self.assertTrue(payload["segments"])
        self.assertGreaterEqual(len(payload["segments"]), 1)
        # First segment should have at least one point
        self.assertGreaterEqual(len(payload["segments"][0]), 1)
        self.assertEqual(
            payload["start"], {"lat": trail.latitude, "lng": trail.longitude}
        )

    # def test_map_respects_marker_limit_when_cluster_disabled(self):
    #    params = {
    #        "bbox": "-34.2,150.0,-33.0,151.5",
    #        "zoom": "10",
    #        "cluster": "false",
    #        "max_markers": "2",
    #    }
    #    response = self._get("/api/trails/map/", params)
    #    self.assertEqual(response.status_code, status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)

    # ----------------------------------------------------------- filter summary
    def test_filter_options_endpoint(self):
        response = self._get("/api/trails/filters/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = response.json()
        self.assertEqual(
            {d["value"] for d in payload["difficulties"]}, {"easy", "moderate", "hard"}
        )
        self.assertEqual(len(payload["categories"]), 3)
        self.assertIn("Sydney", payload["cities"])
        self.assertIn("Australia", payload["countries"])
