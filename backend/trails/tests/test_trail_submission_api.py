from __future__ import annotations

from math import asin, cos, radians, sin, sqrt

from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from trails.models import Trail


class TrailSubmissionAPITests(APITestCase):
    def setUp(self) -> None:
        self.user = get_user_model().objects.create_user(
            username="alice",
            email="alice@example.com",
            password="Secr3tpass!",
        )
        self.url = "/api/trail-submissions/"

    def test_authentication_required(self):
        response = self.client.post(self.url, self._payload(), format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(Trail.objects.count(), 0)

    def test_submits_trail_with_segments(self):
        self.client.force_authenticate(self.user)
        payload = self._payload()
        payload["distance_km"] = 999  # Should be ignored in favour of server-side calculation.
        payload["start"] = {"lat": 0, "lng": 0}  # Should be normalised to first segment point.

        response = self.client.post(self.url, payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        body = response.json()
        self.assertEqual(body["name"], payload["name"])
        self.assertEqual(body["difficulty"], payload["difficulty"])
        self.assertEqual(body["total_points"], 5)

        expected_distance = round(self._expected_distance(), 2)
        self.assertAlmostEqual(body["distance_km"], expected_distance, places=2)
        self.assertEqual(body["start"], {"lat": -33.86, "lng": 151.21})

        trail = Trail.objects.get()
        self.assertEqual(trail.submitted_by, self.user)
        self.assertEqual(len(trail.route_path), 2)
        self.assertAlmostEqual(trail.distance_km, expected_distance, places=2)
        self.assertEqual(sum(len(segment) for segment in trail.route_path), 5)
        self.assertEqual(trail.approval_state, "pending")
        self.assertIsNotNone(trail.route_geometry)
        self.assertAlmostEqual(trail.latitude or 0, -33.86, places=2)
        self.assertAlmostEqual(trail.longitude or 0, 151.21, places=2)

    def test_rejects_segments_with_insufficient_points(self):
        self.client.force_authenticate(self.user)
        payload = self._payload()
        payload["segments"] = [[{"lat": -33.86, "lng": 151.21}]]

        response = self.client.post(self.url, payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn("segments", response.json())

    def _payload(self) -> dict:
        return {
            "name": "Ridge Line Traverse",
            "difficulty": "moderate",
            "distance_km": 0,
            "elev_gain_m": 450,
            "expected_time_h": 4.5,
            "description": "Spectacular ridge line with harbour views.",
            "start": {"lat": -33.86, "lng": 151.21},
            "segments": [
                [
                    {"lat": -33.86, "lng": 151.21},
                    {"lat": -33.861, "lng": 151.215},
                    {"lat": -33.8625, "lng": 151.22},
                ],
                [
                    {"lat": -33.8625, "lng": 151.22},
                    {"lat": -33.863, "lng": 151.225},
                ],
                [
                    {"lat": -33.8635, "lng": 151.23},
                ],  # This should be discarded server-side.
            ],
        }

    def _expected_distance(self) -> float:
        segments = self._payload()["segments"][:2]
        total = 0.0
        for segment in segments:
            for index in range(1, len(segment)):
                total += self._haversine(segment[index - 1], segment[index])
        return total

    def _haversine(self, a: dict, b: dict) -> float:
        lat1, lng1 = radians(a["lat"]), radians(a["lng"])
        lat2, lng2 = radians(b["lat"]), radians(b["lng"])
        dlat = lat2 - lat1
        dlng = lng2 - lng1
        h = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlng / 2) ** 2
        return 2 * 6371 * asin(min(1.0, sqrt(h)))
